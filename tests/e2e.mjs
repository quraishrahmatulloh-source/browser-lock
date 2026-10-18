// Uji end-to-end: menjalankan ekstensi asli di Chrome for Testing (headless) dan menggerakkannya lewat CDP.
// Pakai: CHROME_BIN="/path/ke/Google Chrome for Testing" node tests/e2e.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHROME = process.env.CHROME_BIN;
if (!CHROME) { console.error("Set CHROME_BIN ke Chrome for Testing"); process.exit(2); }
const PORT = 9350, SITE = 8765;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bl-e2e-"));
let pass = 0, fail = 0, chrome = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && extra ? "  -> " + extra : ""}`); };
async function until(fn, ms = 8000, step = 150) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t > ms) return null; await sleep(step); } }

// ---- situs uji ----
const site = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); res.end(`<!doctype html><title>Halaman Uji</title><h1 id="x">isi rahasia</h1><input id="q">`); }).listen(SITE);

// ---- CDP ----
const jget = async (p, init) => (await fetch(`http://127.0.0.1:${PORT}${p}`, init)).json();
const list = () => jget("/json/list");
async function conn(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const ctxs = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) pend.get(d.id)(d); if (d.method === "Runtime.executionContextCreated") ctxs.push(d.params.context); };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable");
  const ev = async (expression, contextId) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result.value; };
  return { send, ev, ctxs, close: () => ws.close() };
}
const target = (pred) => until(async () => (await list()).find((t) => t.type === "page" && pred(t)));
async function openTab(url) { const t = await jget(`/json/new?${url}`, { method: "PUT" }); return t; }

function launch() {
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-search-engine-choice-screen", `--load-extension=${EXT}`, "about:blank"], { stdio: "ignore" });
}
async function stop() { if (chrome) { chrome.kill("SIGTERM"); await sleep(1500); chrome = null; } }
// service worker milik Browser Lock (Chrome for Testing punya ekstensi bawaan lain yang juga bernama background.js)
async function ready() {
  return until(async () => {
    for (const t of (await list()).filter((x) => x.type === "service_worker" && x.url.endsWith("/background.js"))) {
      const c = await conn(t.webSocketDebuggerUrl);
      try { if ((await c.ev("chrome.runtime.getManifest().name")) === "Browser Lock") return t; } finally { c.close(); }
    }
  }, 15000);
}

// ---- helpers UI ----
const fill = (c, sel, v) => c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const submit = (c, sel) => c.ev(`document.querySelector(${JSON.stringify(sel)}).requestSubmit()`);
const text = (c, sel) => c.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent || ''`);
const visible = (c, sel) => c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display!=='none'})()`);
const send = (c, msg) => c.ev(`chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
const covered = (c) => c.ev(`({host: !!document.querySelector('[data-browser-lock]'), vis: getComputedStyle(document.documentElement).visibility, title: document.title})`);

// kirim pesan lewat tab halaman ekstensi baru (ditutup lagi setelahnya)
async function ext(extId, msg) {
  const t = await openTab(`chrome-extension://${extId}/popup.html`);
  await sleep(700);
  const c = await conn(t.webSocketDebuggerUrl);
  try { return await send(c, msg); } finally { c.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {}); }
}

async function main() {
  launch();
  const sw = await ready();
  ok("ekstensi termuat (service worker hidup)", !!sw);
  const extId = new URL(sw.url).host;

  // ---- 1. pemasangan pertama membuka halaman pengaturan, buat password ----
  const optT = await target((t) => t.url.includes(`${extId}/options.html`));
  ok("halaman pengaturan terbuka otomatis saat pertama dipasang", !!optT);
  const opt = await conn(optT.webSocketDebuggerUrl);
  ok("form buat password tampil", !!(await until(async () => visible(opt, "#setup"))));
  await fill(opt, "#s1", "pendek"); await fill(opt, "#s2", "pendek"); await submit(opt, "#setup");
  ok("password pendek ditolak", /minimal 8/.test(await until(async () => text(opt, "#smsg"))));
  await fill(opt, "#s1", "rahasia-satu-1"); await fill(opt, "#s2", "beda-sendiri-2"); await submit(opt, "#setup");
  ok("dua password tidak sama ditolak", /tidak sama/.test(await until(async () => text(opt, "#smsg"))));
  await fill(opt, "#s2", "rahasia-satu-1"); await submit(opt, "#setup");
  const code = await until(async () => { const t = await text(opt, "#codeText"); return /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/.test(t) ? t : null; });
  ok("kode pemulihan tampil dengan format benar", !!code, String(code));
  ok("tombol Lanjut mati sampai kotak 'sudah disimpan' dicentang", await opt.ev("document.getElementById('codeDone').disabled"));
  await opt.ev("(()=>{const c=document.getElementById('saved');c.checked=true;c.dispatchEvent(new Event('change'))})()");
  await opt.ev("document.getElementById('codeDone').click()");
  ok("pengaturan tampil setelah kode disimpan", !!(await until(async () => visible(opt, "#main"))));
  ok("kode pemulihan terhapus dari layar", (await text(opt, "#codeText")) === "");

  // ---- 2. halaman biasa tidak tertutup saat terbuka ----
  const pageT = await openTab(`http://127.0.0.1:${SITE}/`);
  const page = await conn(pageT.webSocketDebuggerUrl);
  await sleep(1200);
  let c = await covered(page);
  ok("halaman tidak tertutup saat sudah terbuka", !c.host && c.vis === "visible" && c.title === "Halaman Uji", JSON.stringify(c));

  // ---- 3. pengaturan tersimpan ----
  await opt.ev("(()=>{const s=document.getElementById('auto');s.value='15';s.dispatchEvent(new Event('change'))})()");
  await sleep(500);
  const st = await send(opt, { type: "getSettings" });
  ok("pengaturan auto-lock tersimpan (15 menit)", st.autoLockMin === 15 && st.lockOnScreenLock === true, JSON.stringify(st));

  // ---- 4. kunci sekarang ----
  await send(opt, { type: "lockNow" });
  c = await until(async () => { const r = await covered(page); return r.host ? r : null; });
  ok("halaman tertutup dan isinya disembunyikan saat terkunci", !!c && c.vis === "hidden" && c.title === "🔒 Terkunci", JSON.stringify(c));
  const bodyText = await page.ev("document.getElementById('x').innerText");
  ok("isi halaman tidak terlihat (visibility hidden)", (await page.ev("getComputedStyle(document.getElementById('x')).visibility")) === "hidden", bodyText);
  ok("halaman pengaturan dialihkan ke layar kunci", !!(await target((t) => t.url.includes(`${extId}/lock.html`))));

  // ---- 5. keamanan pesan: skrip konten tidak boleh membuka kunci ----
  await sleep(300);
  const iso = page.ctxs.find((x) => x.auxData?.type === "isolated" && x.origin.includes(extId));
  ok("konteks skrip konten ditemukan", !!iso);
  if (iso) {
    const forb = await page.ev(`chrome.runtime.sendMessage({type:'unlock',password:'rahasia-satu-1'})`, iso.id);
    ok("skrip konten DITOLAK saat mencoba unlock (forbidden)", forb && forb.ok === false && forb.error === "forbidden", JSON.stringify(forb));
    const forb2 = await page.ev(`chrome.runtime.sendMessage({type:'setSettings',patch:{autoLockMin:0}})`, iso.id);
    ok("skrip konten DITOLAK mengubah pengaturan", forb2 && forb2.error === "forbidden", JSON.stringify(forb2));
    const stt = await page.ev(`chrome.runtime.sendMessage({type:'getState'})`, iso.id);
    ok("skrip konten boleh tanya status, tanpa membocorkan hash", stt.locked === true && !JSON.stringify(stt).match(/hash|salt/), JSON.stringify(stt));
  }

  // ---- 6. tab chrome:// tidak bisa ditutup overlay: dialihkan ke halaman kunci ----
  const ntp = await openTab("chrome://newtab");
  const ntpLock = await target((t) => t.id === ntp.id && t.url.includes(`${extId}/lock.html`));
  ok("tab chrome://newtab dialihkan ke halaman kunci", !!ntpLock, (await list()).map((t) => t.url).join(" | "));

  // ---- 7. password salah, lalu benar ----
  const lockT = ntpLock || await target((t) => t.url.includes(`${extId}/lock.html`));
  const lock = await conn(lockT.webSocketDebuggerUrl);
  await fill(lock, "#pw", "salah-total"); await submit(lock, "#unlockForm");
  const m1 = await until(async () => { const t = await text(lock, "#msg"); return /salah/i.test(t) ? t : null; });
  ok("password salah ditolak dengan pesan sisa percobaan", /Password salah/.test(m1 || "") && /4 percobaan/.test(m1 || ""), m1);
  ok("halaman tetap tertutup setelah password salah", (await covered(page)).host === true);
  await fill(lock, "#pw", "rahasia-satu-1"); await submit(lock, "#unlockForm");
  c = await until(async () => { const r = await covered(page); return !r.host ? r : null; });
  ok("password benar membuka halaman (overlay hilang, judul kembali)", !!c && c.vis === "visible" && c.title === "Halaman Uji", JSON.stringify(c));
  const back = await until(async () => (await list()).find((t) => t.id === ntp.id && !t.url.includes("lock.html")));
  ok("tab chrome://newtab dikembalikan setelah unlock", !!back, back?.url);

  // ---- 8. lupa password: pemulihan ----
  await ext(extId, { type: "lockNow" });
  await until(async () => (await covered(page)).host);
  const lt = await target((t) => t.url.includes(`${extId}/lock.html`));
  const l2 = await conn(lt.webSocketDebuggerUrl);
  await l2.ev("document.getElementById('forgot').click()");
  await fill(l2, "#rcode", "AAAA-AAAA-AAAA-AAAA-AAAA"); await fill(l2, "#np1", "password-baru-77"); await fill(l2, "#np2", "password-baru-77"); await submit(l2, "#recoverForm");
  ok("kode pemulihan salah ditolak", /Kode pemulihan salah/.test((await until(async () => { const t = await text(l2, "#rmsg"); return /salah/.test(t) ? t : null; })) || ""));
  await fill(l2, "#rcode", code.toLowerCase()); await submit(l2, "#recoverForm");
  const code2 = await until(async () => { const t = await text(l2, "#codeText"); return /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/.test(t) ? t : null; });
  ok("pemulihan berhasil dan kode baru tampil, berbeda dari yang lama", !!code2 && code2 !== code, String(code2));
  ok("layar kunci TIDAK tertutup sebelum kode baru dibaca", (await list()).some((t) => t.url.includes("lock.html")));
  ok("halaman sudah terbuka setelah pemulihan", !(await covered(page)).host);
  await l2.ev("document.getElementById('done').click()");
  await ext(extId, { type: "lockNow" });
  await until(async () => (await covered(page)).host);
  const lt2 = await target((t) => t.url.includes(`${extId}/lock.html`));
  const l3 = await conn(lt2.webSocketDebuggerUrl);
  await fill(l3, "#pw", "rahasia-satu-1"); await submit(l3, "#unlockForm");
  ok("password lama tidak berlaku lagi setelah pemulihan", /salah/i.test((await until(async () => { const t = await text(l3, "#msg"); return /salah/i.test(t) ? t : null; })) || ""));

  // ---- 9. batas percobaan: 5 salah => ditunda; yang benar pun ditolak selama ditunda ----
  for (let i = 0; i < 4; i++) { await fill(l3, "#pw", "salah-" + i); await submit(l3, "#unlockForm"); await sleep(450); }
  const thr = await until(async () => { const t = await text(l3, "#msg"); return /Terlalu banyak/.test(t) ? t : null; });
  ok("setelah 5 salah muncul hitung mundur", /Terlalu banyak percobaan.*0:/.test(thr || ""), thr);
  ok("kolom password dimatikan selama ditunda", await l3.ev("document.getElementById('pw').disabled"));
  const direct = await send(l3, { type: "unlock", password: "password-baru-77" });
  ok("password BENAR pun ditolak selama ditunda (anti brute-force)", direct.ok === false && direct.throttled === true, JSON.stringify(direct));

  // ---- 10. Chrome ditutup lalu dibuka lagi: selalu terkunci, jendela kunci terbuka otomatis ----
  [l3, lock, l2, opt, page].forEach((x) => { try { x.close(); } catch {} });
  await stop();
  await sleep(31_000);   // tunggu penundaan 30 dtk habis
  launch();
  const sw2 = await ready();
  ok("ekstensi hidup lagi setelah Chrome dibuka ulang", !!sw2);
  const win = await target((t) => t.url.includes(`${extId}/lock.html?mode=window`), 15000);
  ok("jendela kunci terbuka otomatis saat Chrome dibuka", !!win, (await list()).map((t) => t.url).join(" | "));
  if (win) {
    const w = await conn(win.webSocketDebuggerUrl);
    const gs = await send(w, { type: "getState" });
    ok("status setelah restart: terkunci (sesi tidak bertahan)", gs.hasPassword && gs.locked, JSON.stringify(gs));
    await fill(w, "#pw", "password-baru-77"); await submit(w, "#unlockForm");
    const gone = await until(async () => !(await list()).some((t) => t.url.includes("lock.html?mode=window")), 8000);
    ok("jendela kunci menutup sendiri setelah password benar", !!gone);
  }
  await stop();
}

try { await main(); } catch (e) { fail++; console.log("FAIL (exception)", e.stack || e); }
await stop(); site.close(); fs.rmSync(profile, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
