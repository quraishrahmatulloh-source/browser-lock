import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHost, sanitizeRules, matchRule, isSiteLocked, expiryFor } from "../lib/sites.js";

test("normalizeHost: bersihkan URL jadi host", () => {
  assert.equal(normalizeHost("https://www.Mail.Google.com/inbox?x=1#a"), "mail.google.com");
  assert.equal(normalizeHost("  bank.co.id  "), "bank.co.id");
  assert.equal(normalizeHost("user:pw@example.com:8080/path"), "example.com");
  assert.equal(normalizeHost("127.0.0.1:8765"), "127.0.0.1");
  assert.equal(normalizeHost("example.com."), "example.com");
});

test("normalizeHost: tolak yang tidak valid", () => {
  for (const bad of ["", "   ", "bukan host!", "a..b", "-a.com", "a-.com", "javascript:alert(1)", "<script>", "x".repeat(300) + ".com", null, undefined]) assert.equal(normalizeHost(bad), null, String(bad));
});

test("sanitizeRules: buang duplikat/tidak valid, menit default 15, maksimal 50", () => {
  const r = sanitizeRules([{ host: "A.com", minutes: 5 }, { host: "a.com", minutes: 60 }, { host: "zzz zzz", minutes: 5 }, { host: "b.com", minutes: 7 }, { host: "c.com", minutes: 0 }, null, 5]);
  assert.deepEqual(r, [{ host: "a.com", minutes: 5 }, { host: "b.com", minutes: 15 }, { host: "c.com", minutes: 0 }]);
  assert.equal(sanitizeRules(Array.from({ length: 80 }, (_, i) => ({ host: `s${i}.com`, minutes: 5 }))).length, 50);
  assert.deepEqual(sanitizeRules("bukan array"), []);
});

test("matchRule: domain sama dan subdomain cocok, domain mirip tidak, hanya http(s)", () => {
  const rules = [{ host: "google.com", minutes: 5 }];
  assert.ok(matchRule("https://google.com/", rules));
  assert.ok(matchRule("https://mail.google.com/x", rules));
  assert.ok(matchRule("http://www.google.com", rules));
  assert.equal(matchRule("https://notgoogle.com", rules), null);     // bukan subdomain
  assert.equal(matchRule("https://google.com.evil.io", rules), null);
  assert.equal(matchRule("chrome://settings", rules), null);
  assert.equal(matchRule("file:///google.com", rules), null);
  assert.equal(matchRule("bukan url", rules), null);
});

test("isSiteLocked: terkunci sampai dibuka, kadaluarsa menurut menit, null = sampai Chrome ditutup", () => {
  const rules = [{ host: "bank.com", minutes: 15 }, { host: "mail.com", minutes: 0 }];
  const now = 1_000_000;
  assert.ok(isSiteLocked("https://bank.com/a", rules, {}, now));                       // belum pernah dibuka
  assert.equal(isSiteLocked("https://other.com", rules, {}, now), null);               // tidak ada aturan
  assert.equal(isSiteLocked("https://bank.com", rules, { "bank.com": now + 1000 }, now), null);   // masih berlaku
  assert.ok(isSiteLocked("https://bank.com", rules, { "bank.com": now - 1 }, now));    // kadaluarsa => terkunci lagi
  assert.equal(isSiteLocked("https://mail.com", rules, { "mail.com": null }, now), null);        // sampai Chrome ditutup
  assert.equal(expiryFor(rules[0], now), now + 15 * 60_000);
  assert.equal(expiryFor(rules[1], now), null);
});
