import test from "node:test";
import assert from "node:assert/strict";
import { Vault, lockoutDelay, makeRecoveryCode, normalizeCode, validatePassword, makeRecord, checkRecord, MAX_FREE_TRIES } from "../lib/auth.js";

const memStore = () => {
  const data = {};
  return { data, get: async (keys) => Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, structuredClone(data[k])])), set: async (o) => Object.assign(data, structuredClone(o)) };
};

test("hash: password benar lolos, salah ditolak, salt acak", async () => {
  const a = await makeRecord("rahasia-123"), b = await makeRecord("rahasia-123");
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  assert.ok(await checkRecord("rahasia-123", a));
  assert.ok(!(await checkRecord("rahasia-124", a)));
  assert.ok(!(await checkRecord("", a)));
  assert.ok(!(await checkRecord("x", null)));
});

test("password asli tidak pernah tersimpan", async () => {
  const s = memStore(), v = new Vault(s);
  const r = await v.setInitialPassword("sangat-rahasia-99");
  assert.ok(r.ok);
  const dump = JSON.stringify(s.data);
  assert.ok(!dump.includes("sangat-rahasia-99"));
  assert.ok(!dump.includes(r.recoveryCode));
  assert.ok(!dump.includes(normalizeCode(r.recoveryCode)));
});

test("validasi password", () => {
  assert.ok(validatePassword("pendek"));
  assert.ok(validatePassword("aaaaaaaaaa"));
  assert.ok(validatePassword("x".repeat(129)));
  assert.equal(validatePassword("abcd1234"), null);
  assert.equal(validatePassword("pass word dengan spasi & simbol ✓"), null);
});

test("kode pemulihan: format, unik, tanpa karakter ambigu", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const c = makeRecoveryCode();
    assert.match(c, /^[A-HJKMNP-Z2-9]{4}(-[A-HJKMNP-Z2-9]{4}){4}$/);
    seen.add(c);
  }
  assert.equal(seen.size, 200);
  assert.equal(normalizeCode("abcd-efgh jk23"), "ABCDEFGHJK23");
});

test("pembatasan percobaan: 5 gratis lalu 30s, 60s, 2m, ... maks 15m", () => {
  for (let i = 0; i < MAX_FREE_TRIES; i++) assert.equal(lockoutDelay(i), 0);
  assert.equal(lockoutDelay(5), 30_000);
  assert.equal(lockoutDelay(6), 60_000);
  assert.equal(lockoutDelay(7), 120_000);
  assert.equal(lockoutDelay(50), 15 * 60_000);
});

test("unlock: salah berulang memicu tunggu, benar saat ditunda tetap ditolak, setelah waktu lewat boleh", async () => {
  const v = new Vault(memStore());
  await v.setInitialPassword("benar-benar-1");
  let t = 1_000_000;
  for (let i = 1; i <= 4; i++) { const r = await v.tryUnlock("salah", t); assert.equal(r.ok, false); assert.equal(r.retryIn, 0); }
  const fifth = await v.tryUnlock("salah", t);
  assert.equal(fifth.retryIn, 30_000);
  const during = await v.tryUnlock("benar-benar-1", t + 1000);   // password benar tapi masih ditunda
  assert.equal(during.ok, false);
  assert.ok(during.throttled && during.retryIn > 28_000);
  const after = await v.tryUnlock("benar-benar-1", t + 31_000);
  assert.equal(after.ok, true);
  const again = await v.tryUnlock("salah", t + 32_000);          // hitungan direset setelah berhasil
  assert.equal(again.retryIn, 0);
});

test("ganti password butuh password lama", async () => {
  const v = new Vault(memStore());
  await v.setInitialPassword("password-lama-1");
  assert.equal((await v.changePassword("salah-salah", "password-baru-1")).ok, false);
  assert.equal((await v.changePassword("password-lama-1", "pendek")).ok, false);
  assert.equal((await v.changePassword("password-lama-1", "password-baru-1")).ok, true);
  assert.equal((await v.tryUnlock("password-lama-1")).ok, false);
  assert.equal((await v.tryUnlock("password-baru-1")).ok, true);
});

test("setInitialPassword hanya sekali (tidak bisa menimpa password yang ada)", async () => {
  const v = new Vault(memStore());
  assert.ok((await v.setInitialPassword("pertama-aja-1")).ok);
  const r = await v.setInitialPassword("penyerang-2");
  assert.equal(r.ok, false);
  assert.equal((await v.tryUnlock("pertama-aja-1")).ok, true);
});

test("pemulihan: kode benar pasang password baru, kode lama hangus, kode baru dibuat", async () => {
  const v = new Vault(memStore());
  const { recoveryCode } = await v.setInitialPassword("lupa-nanti-1");
  assert.equal((await v.recover("AAAA-AAAA-AAAA-AAAA-AAAA", "password-baru-2")).ok, false);
  const ok = await v.recover(recoveryCode.toLowerCase().replaceAll("-", " "), "password-baru-2");  // toleran huruf kecil/spasi
  assert.ok(ok.ok);
  assert.notEqual(ok.recoveryCode, recoveryCode);
  assert.equal((await v.tryUnlock("password-baru-2")).ok, true);
  assert.equal((await v.tryUnlock("lupa-nanti-1")).ok, false);
  assert.equal((await v.recover(recoveryCode, "password-baru-3")).ok, false);   // kode lama sudah tidak berlaku
});

test("pemulihan ikut dibatasi percobaannya (tidak bisa ditebak cepat)", async () => {
  const v = new Vault(memStore());
  await v.setInitialPassword("amankan-ini-1");
  let t = 5_000_000, last;
  for (let i = 0; i < 5; i++) last = await v.recover("ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ", "password-baru-4", t);
  assert.equal(last.retryIn, 30_000);
  assert.ok((await v.recover("ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ", "password-baru-4", t + 1)).throttled);
});

test("buat ulang kode pemulihan: kode lama mati", async () => {
  const v = new Vault(memStore());
  const first = await v.setInitialPassword("kode-baru-uji-1");
  assert.equal((await v.regenerateRecovery("salah-ya-ini")).ok, false);
  const second = await v.regenerateRecovery("kode-baru-uji-1");
  assert.ok(second.ok && second.recoveryCode !== first.recoveryCode);
  assert.equal((await v.recover(first.recoveryCode, "password-baru-5")).ok, false);
  assert.equal((await v.recover(second.recoveryCode, "password-baru-5")).ok, true);
});

test("pengaturan: bawaan, nilai tak valid ditolak, aturan situs dirapikan", async () => {
  const v = new Vault(memStore());
  assert.deepEqual(await v.getSettings(), { autoLockMin: 5, lockOnScreenLock: true, siteLocks: [], lang: "en", panicMinimize: true, panicClipboard: true });
  await v.setSettings({ autoLockMin: 15, lockOnScreenLock: false, lang: "en", panicClipboard: false });
  let s = await v.getSettings();
  assert.deepEqual([s.autoLockMin, s.lockOnScreenLock, s.lang, s.panicClipboard], [15, false, "en", false]);
  await v.setSettings({ autoLockMin: 7, lockOnScreenLock: "ya", lang: "fr", panicMinimize: "x" });   // semua tidak valid, diabaikan
  s = await v.getSettings();
  assert.deepEqual([s.autoLockMin, s.lockOnScreenLock, s.lang, s.panicMinimize], [15, false, "en", true]);
  await v.setSettings({ siteLocks: [{ host: "https://www.Mail.Google.com/inbox", minutes: 15 }, { host: "mail.google.com", minutes: 5 }, { host: "bukan host!", minutes: 5 }, { host: "bank.co.id", minutes: 99 }] });
  assert.deepEqual((await v.getSettings()).siteLocks, [{ host: "mail.google.com", minutes: 15 }, { host: "bank.co.id", minutes: 15 }]);
});

test("catatan percobaan gagal: terisi, ada jumlah belum dilihat, bisa ditandai dan dihapus, dibatasi 50", async () => {
  const v = new Vault(memStore());
  await v.setInitialPassword("catat-ini-aja-1");
  const t = 9_000_000;
  await v.tryUnlock("salah1", t); await v.recover("AAAA-AAAA-AAAA-AAAA-AAAA", "password-xyz-1", t + 1000);
  await v.failAttempt(t + 2000, "biometric");
  let a = await v.getAttempts();
  assert.deepEqual(a.log.map((e) => e.k), ["password", "recovery", "biometric"]);
  assert.equal(a.unseen, 3);
  assert.equal(a.log[0].t, t);
  await v.markSeen();
  a = await v.getAttempts();
  assert.equal(a.unseen, 0); assert.equal(a.log.length, 3);
  await v.clearLog();
  assert.deepEqual(await v.getAttempts(), { log: [], unseen: 0 });
  for (let i = 0; i < 70; i++) await v.failAttempt(t + 10_000 + i, "password");
  a = await v.getAttempts();
  assert.equal(a.log.length, 50); assert.equal(a.unseen, 50);
});

test("percobaan berhasil tidak masuk catatan gagal, dan mereset penundaan", async () => {
  const v = new Vault(memStore());
  await v.setInitialPassword("berhasil-ya-1");
  for (let i = 0; i < 5; i++) await v.tryUnlock("salah", 1_000 + i);
  assert.ok((await v.gate(2_000)).throttled);
  await v.clearFails();
  assert.equal(await v.gate(2_000), null);
  assert.equal((await v.getAttempts()).log.length, 5);
});

test("tryUnlock tanpa password terpasang", async () => {
  const v = new Vault(memStore());
  assert.equal((await v.tryUnlock("apa saja")).ok, false);
  assert.equal(await v.hasPassword(), false);
});
