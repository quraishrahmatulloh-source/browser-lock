// Verifikasi tanda tangan WebAuthn (Touch ID / sidik jari) di service worker. Hanya ES256 (P-256), yang dipakai Touch ID.
// Logika murni, bisa dites di Node.
export const b64uToBytes = (s) => { const p = String(s).replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(p + "=".repeat((4 - (p.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
export const bytesToB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256 = async (data) => new Uint8Array(await crypto.subtle.digest("SHA-256", data));
const utf8 = (s) => new TextEncoder().encode(s);

/** ECDSA-Sig-Value (DER) -> r||s 64 byte, format yang diminta WebCrypto. Melempar kalau bentuknya salah. */
export function derToRaw(der) {
  const b = new Uint8Array(der); let i = 0;
  const need = (c) => { if (b[i++] !== c) throw new Error("DER tidak valid"); };
  need(0x30);
  let len = b[i++]; if (len & 0x80) { const n = len & 0x7f; len = 0; for (let k = 0; k < n; k++) len = (len << 8) | b[i++]; }
  if (i + len !== b.length) throw new Error("DER panjang salah");
  const readInt = () => {
    need(0x02); const l = b[i++]; let v = b.slice(i, i + l); i += l;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error("integer terlalu besar");
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  };
  const r = readInt(), s = readInt();
  if (i !== b.length) throw new Error("sisa byte");
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32); return raw;
}

/**
 * Periksa satu "assertion" dari navigator.credentials.get.
 * input: { publicKeySpki (b64u), rpId, origin, challenge (b64u yang kita keluarkan), assertion: { authenticatorData, clientDataJSON, signature } (b64u) }
 */
export async function verifyAssertion({ publicKeySpki, rpId, origin, challenge, assertion }) {
  try {
    const clientBytes = b64uToBytes(assertion.clientDataJSON);
    const client = JSON.parse(new TextDecoder().decode(clientBytes));
    if (client.type !== "webauthn.get") return { ok: false, error: "tipe salah" };
    if (client.challenge !== challenge) return { ok: false, error: "tantangan tidak cocok" };
    if (client.origin !== origin) return { ok: false, error: "origin salah" };

    const auth = b64uToBytes(assertion.authenticatorData);
    if (auth.length < 37) return { ok: false, error: "authData terlalu pendek" };
    // Untuk halaman ekstensi, Chrome mengisi rpIdHash dengan SHA-256 dari origin lengkap ("chrome-extension://<id>"),
    // bukan dari id saja (terukur di Chrome 155). Keduanya terikat ke ekstensi ini, jadi dua bentuk diterima.
    const got = auth.slice(0, 32), same = (w) => got.every((v, k) => v === w[k]);
    if (!same(await sha256(utf8(rpId))) && !same(await sha256(utf8(origin)))) return { ok: false, error: "rpId salah" };
    const flags = auth[32];
    if (!(flags & 0x01)) return { ok: false, error: "kehadiran pengguna tidak ada" };
    if (!(flags & 0x04)) return { ok: false, error: "verifikasi pengguna (sidik jari) tidak ada" };

    const signed = new Uint8Array([...auth, ...(await sha256(clientBytes))]);
    const key = await crypto.subtle.importKey("spki", b64uToBytes(publicKeySpki), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const good = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(b64uToBytes(assertion.signature)), signed);
    return good ? { ok: true } : { ok: false, error: "tanda tangan salah" };
  } catch (e) {
    return { ok: false, error: "assertion rusak" };
  }
}
