// Logika password Browser Lock: hash PBKDF2, pembatasan percobaan, kode pemulihan.
// Tidak memanggil API chrome secara langsung (storage disuntik lewat konstruktor), jadi bisa dites di Node.

export const ITERATIONS = 250_000;
export const MAX_FREE_TRIES = 5;          // setelah ini setiap salah = tunggu makin lama
export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;

const enc = new TextEncoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(secret, salt, iter) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256));
}

/** Simpan hash + salt acak, tidak pernah password aslinya. */
export async function makeRecord(secret, iter = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toB64(salt), hash: toB64(await derive(secret, salt, iter)), iter };
}

/** Bandingkan dengan waktu konstan supaya tidak bocor lewat selisih waktu. */
export async function checkRecord(secret, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const got = await derive(secret, fromB64(rec.salt), rec.iter || ITERATIONS);
  const want = fromB64(rec.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

/** 0 untuk 5 percobaan pertama, lalu 30 dtk, 60 dtk, 2 mnt, ... maksimal 15 menit. */
export function lockoutDelay(failCount) {
  if (failCount < MAX_FREE_TRIES) return 0;
  return Math.min(15 * 60_000, 30_000 * 2 ** (failCount - MAX_FREE_TRIES));
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // tanpa I, L, O, 0, 1 supaya tidak ambigu (31 huruf)

/** Kode pemulihan 20 karakter (sekitar 99 bit), format XXXX-XXXX-XXXX-XXXX-XXXX. Seragam, tanpa bias modulo. */
export function makeRecoveryCode() {
  const out = [];
  const limit = 256 - (256 % ALPHABET.length);
  while (out.length < 20) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < limit && out.length < 20) out.push(ALPHABET[b % ALPHABET.length]);
    }
  }
  return out.join("").match(/.{4}/g).join("-");
}

export const normalizeCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Kode masalah: "short" | "long" | "repeat" | null. Teksnya diterjemahkan di UI (lib/i18n.js, kunci pw.*). */
export function passwordProblem(p) {
  if (typeof p !== "string" || p.length < MIN_PASSWORD) return "short";
  if (p.length > MAX_PASSWORD) return "long";
  if (/^(.)\1+$/.test(p)) return "repeat";
  return null;
}
const PW_TEXT = { short: `Password minimal ${MIN_PASSWORD} karakter.`, long: `Password maksimal ${MAX_PASSWORD} karakter.`, repeat: "Password tidak boleh satu karakter yang diulang." };
export function validatePassword(p) { const c = passwordProblem(p); return c ? PW_TEXT[c] : null; }

import { sanitizeRules } from "./sites.js";

export const DEFAULT_SETTINGS = { autoLockMin: 5, lockOnScreenLock: true, siteLocks: [], lang: "en", panicMinimize: true, panicClipboard: true };
export const LANGS = ["id", "en"];
export const MAX_LOG = 50;
export const AUTO_LOCK_CHOICES = [0, 1, 5, 10, 15, 30, 60];

/**
 * store: { get(keys) -> Promise<object>, set(object) -> Promise }
 * Data di storage: pw (hash password), rc (hash kode pemulihan), fails {count, nextAt}, settings.
 */
export class Vault {
  constructor(store) { this.store = store; }

  async #read() { return this.store.get(["pw", "rc", "fails", "settings", "log", "unseen", "bio"]); }

  async hasPassword() { return !!(await this.#read()).pw; }

  /** Cek pembatasan percobaan. Dipakai bersama untuk password dan kode pemulihan. */
  async gate(now = Date.now()) {
    const { fails } = await this.#read();
    if (fails && fails.nextAt > now) return { ok: false, retryIn: fails.nextAt - now, throttled: true };
    return null;
  }

  /** Catat satu percobaan gagal (kind: password | recovery | biometric) dan hitung penundaan berikutnya. */
  async failAttempt(now = Date.now(), kind = "password") {
    const { fails, log, unseen } = await this.#read();
    const count = (fails?.count || 0) + 1;
    const wait = lockoutDelay(count);
    const entry = { t: now, k: ["password", "recovery", "biometric"].includes(kind) ? kind : "password" };
    await this.store.set({ fails: { count, nextAt: wait ? now + wait : 0 }, log: [...(log || []), entry].slice(-MAX_LOG), unseen: Math.min(MAX_LOG, (unseen || 0) + 1) });
    return { ok: false, retryIn: wait, triesLeft: Math.max(0, MAX_FREE_TRIES - count) };
  }

  async clearFails() { await this.store.set({ fails: { count: 0, nextAt: 0 } }); }

  async getAttempts() { const { log, unseen } = await this.#read(); return { log: log || [], unseen: unseen || 0 }; }
  async markSeen() { await this.store.set({ unseen: 0 }); }
  async clearLog() { await this.store.set({ log: [], unseen: 0 }); }

  async getBio() { return (await this.#read()).bio || null; }
  async setBio(bio) { await this.store.set({ bio }); }
  async removeBio() { await this.store.set({ bio: null }); }

  async tryUnlock(password, now = Date.now()) {
    const { pw } = await this.#read();
    if (!pw) return { ok: false, error: "no-password" };
    const blocked = await this.gate(now);
    if (blocked) return blocked;
    if (await checkRecord(String(password ?? ""), pw)) { await this.clearFails(); return { ok: true }; }
    return this.failAttempt(now, "password");
  }

  /** Pertama kali (belum ada password). Mengembalikan kode pemulihan yang ditampilkan SEKALI. */
  async setInitialPassword(password) {
    if (await this.hasPassword()) return { ok: false, error: "already-set" };
    const bad = validatePassword(password);
    if (bad) return { ok: false, error: bad, code: passwordProblem(password) };
    const code = makeRecoveryCode();
    await this.store.set({ pw: await makeRecord(password), rc: await makeRecord(normalizeCode(code)), fails: { count: 0, nextAt: 0 } });
    return { ok: true, recoveryCode: code };
  }

  async changePassword(current, next, now = Date.now()) {
    const bad = validatePassword(next);
    if (bad) return { ok: false, error: bad, code: passwordProblem(next) };
    const res = await this.tryUnlock(current, now);
    if (!res.ok) return { ...res, error: res.error || "wrong-current" };
    await this.store.set({ pw: await makeRecord(next) });
    return { ok: true };
  }

  /** Buat kode pemulihan baru (kode lama langsung tidak berlaku). Butuh password. */
  async regenerateRecovery(password, now = Date.now()) {
    const res = await this.tryUnlock(password, now);
    if (!res.ok) return { ...res, error: res.error || "wrong-current" };
    const code = makeRecoveryCode();
    await this.store.set({ rc: await makeRecord(normalizeCode(code)) });
    return { ok: true, recoveryCode: code };
  }

  /** Lupa password: pakai kode pemulihan untuk memasang password baru. Kode lama dipakai habis, kode baru dibuat. */
  async recover(code, next, now = Date.now()) {
    const bad = validatePassword(next);
    if (bad) return { ok: false, error: bad, code: passwordProblem(next) };
    const { rc } = await this.#read();
    if (!rc) return { ok: false, error: "no-recovery" };
    const blocked = await this.gate(now);
    if (blocked) return blocked;
    if (!(await checkRecord(normalizeCode(code), rc))) return this.failAttempt(now, "recovery");
    const fresh = makeRecoveryCode();
    await this.store.set({ pw: await makeRecord(next), rc: await makeRecord(normalizeCode(fresh)), fails: { count: 0, nextAt: 0 } });
    return { ok: true, recoveryCode: fresh };
  }

  async getSettings() {
    const { settings } = await this.#read();
    return { ...DEFAULT_SETTINGS, ...(settings || {}) };
  }

  async setSettings(patch) {
    const cur = await this.getSettings();
    const next = { ...cur };
    if (patch && AUTO_LOCK_CHOICES.includes(patch.autoLockMin)) next.autoLockMin = patch.autoLockMin;
    if (patch && typeof patch.lockOnScreenLock === "boolean") next.lockOnScreenLock = patch.lockOnScreenLock;
    if (patch && typeof patch.panicMinimize === "boolean") next.panicMinimize = patch.panicMinimize;
    if (patch && typeof patch.panicClipboard === "boolean") next.panicClipboard = patch.panicClipboard;
    if (patch && LANGS.includes(patch.lang)) next.lang = patch.lang;
    if (patch && Array.isArray(patch.siteLocks)) next.siteLocks = sanitizeRules(patch.siteLocks);
    await this.store.set({ settings: next });
    return next;
  }
}
