import test from "node:test";
import assert from "node:assert/strict";
import { verifyAssertion, derToRaw, bytesToB64u, b64uToBytes } from "../lib/webauthn.js";

const RP = "abcdefghijklmnopabcdefghijklmnop", ORIGIN = `chrome-extension://${RP}`;
const sha = async (d) => new Uint8Array(await crypto.subtle.digest("SHA-256", d));
const utf8 = (s) => new TextEncoder().encode(s);

// raw r||s -> DER (seperti yang dikirim autentikator sungguhan)
function rawToDer(raw) {
  const enc = (x) => { let i = 0; while (i < 31 && x[i] === 0) i++; let v = x.slice(i); if (v[0] & 0x80) v = new Uint8Array([0, ...v]); return [0x02, v.length, ...v]; };
  const body = [...enc(raw.slice(0, 32)), ...enc(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

async function make({ flags = 0x05, rpId = RP, hashOf = null, challenge = "tantangan-abc", origin = ORIGIN, type = "webauthn.get" } = {}) {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const spki = bytesToB64u(await crypto.subtle.exportKey("spki", kp.publicKey));
  const authData = new Uint8Array([...(await sha(utf8(hashOf ?? rpId))), flags, 0, 0, 0, 1]);
  const clientDataJSON = utf8(JSON.stringify({ type, challenge, origin }));
  const signed = new Uint8Array([...authData, ...(await sha(clientDataJSON))]);
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, signed));
  return { spki, kp, assertion: { authenticatorData: bytesToB64u(authData), clientDataJSON: bytesToB64u(clientDataJSON), signature: bytesToB64u(rawToDer(raw)) } };
}
const check = (m, over = {}) => verifyAssertion({ publicKeySpki: m.spki, rpId: RP, origin: ORIGIN, challenge: "tantangan-abc", assertion: m.assertion, ...over });

test("assertion sah (kehadiran + sidik jari) diterima", async () => { assert.deepEqual(await check(await make()), { ok: true }); });

test("tanpa verifikasi pengguna (UV) ditolak, walau tanda tangan sah", async () => {
  const r = await check(await make({ flags: 0x01 })); assert.equal(r.ok, false); assert.match(r.error, /verifikasi pengguna/);
});
test("tanpa kehadiran pengguna (UP) ditolak", async () => { assert.equal((await check(await make({ flags: 0x04 }))).ok, false); });
test("tantangan salah / lama ditolak (anti replay)", async () => { assert.equal((await check(await make(), { challenge: "tantangan-lain" })).ok, false); });
test("origin salah ditolak", async () => { assert.equal((await check(await make({ origin: "https://evil.com" }))).ok, false); });
test("bentuk Chrome untuk halaman ekstensi: rpIdHash = SHA-256 dari origin lengkap, diterima", async () => {
  assert.deepEqual(await check(await make({ hashOf: ORIGIN })), { ok: true });
});
test("hash dari origin lain tetap ditolak", async () => { assert.equal((await check(await make({ hashOf: "chrome-extension://orang-lain" }))).ok, false); });
test("rpId salah ditolak", async () => { assert.equal((await check(await make({ rpId: "situs-lain" }))).ok, false); });
test("tipe clientData salah (webauthn.create) ditolak", async () => { assert.equal((await check(await make({ type: "webauthn.create" }))).ok, false); });

test("kunci publik lain ditolak (tanda tangan bukan dari kunci terdaftar)", async () => {
  const a = await make(), b = await make();
  assert.equal((await check(a, { publicKeySpki: b.spki })).ok, false);
});

test("tanda tangan dirusak satu bit ditolak", async () => {
  const m = await make(); const sig = b64uToBytes(m.assertion.signature); sig[sig.length - 3] ^= 1;
  m.assertion.signature = bytesToB64u(sig); assert.equal((await check(m)).ok, false);
});
test("authData dirusak ditolak", async () => {
  const m = await make(); const ad = b64uToBytes(m.assertion.authenticatorData); ad[36] ^= 1;
  m.assertion.authenticatorData = bytesToB64u(ad); assert.equal((await check(m)).ok, false);
});
test("masukan sampah tidak membuat error, hanya ditolak", async () => {
  const m = await make();
  for (const bad of [{ signature: "" }, { signature: "AAAA" }, { authenticatorData: "AA" }, { clientDataJSON: "bukan-json" }]) {
    const r = await check({ ...m, assertion: { ...m.assertion, ...bad } }); assert.equal(r.ok, false);
  }
});
test("derToRaw: buang nol di depan dan lengkapi ke 32 byte", () => {
  const r = new Uint8Array(32).fill(1), s = new Uint8Array(32).fill(0xff);
  const raw = derToRaw(rawToDer(new Uint8Array([...r, ...s]))); assert.equal(raw.length, 64); assert.deepEqual([...raw.slice(0, 32)], [...r]); assert.deepEqual([...raw.slice(32)], [...s]);
  assert.throws(() => derToRaw(new Uint8Array([1, 2, 3])));
});
