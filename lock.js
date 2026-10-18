// Halaman kunci. Dipakai di 3 tempat: jendela popup (mode=window), tab pengganti halaman chrome:// (mode=tab), dan popup toolbar (mode=popup).
// Dengan ?site=host, halaman ini membuka satu situs yang dikunci per situs (browser sendiri sudah terbuka).
import { makeT, applyI18n } from "./lib/i18n.js";
import { attachMeter } from "./strength.js";
import { bytesToB64u, b64uToBytes } from "./lib/webauthn.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const mode = params.get("mode") || "tab";
const site = params.get("site") || null;
const tabScope = params.get("tab") ? Number(params.get("tab")) : null;
const tabLock = params.get("tabLock") === "1";                  // dibenamkan di tab yang dikunci sendiri (id tab diketahui oleh service worker)
const embed = mode === "embed";                                  // di dalam iframe di atas halaman yang terkunci     // ?tab=ID: buka satu tab yang dikunci sendiri
const send = (msg) => chrome.runtime.sendMessage(msg);
let T = makeT("id"), state = null, timer = null;

document.body.dataset.mode = mode;
if (embed) document.documentElement.classList.add("embed");
if (mode === "popup") { document.documentElement.style.width = "380px"; document.querySelector(".page").style.padding = "10px"; }
attachMeter($("np1"));
$("foot").innerHTML = `<a href="https://faquloh.site" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none"><b>madebyuloh</b></a> · v${chrome.runtime.getManifest().version}`;

function setMsg(el, text, kind = "err") { el.textContent = text; el.className = "msg " + (text ? kind : ""); }
function shake() { const c = $("card"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake"); c.classList.add("bad"); setTimeout(() => c.classList.remove("bad"), 1200); }
const fmt = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const pwError = (r) => (r.code ? T("pw." + r.code) : r.error);

function heading() {
  $("title").textContent = tabScope != null ? T("lock.tab.title") : site ? T("lock.site.title") : T("lock.title");
  $("sub").textContent = tabScope != null ? T("lock.tab.sub") : site ? T("lock.site.sub", { host: site }) : T("lock.sub");
}

/** Hitung mundur saat terlalu banyak percobaan salah. */
function throttle(ms, msgEl, inputs, buttons) {
  clearInterval(timer);
  const until = Date.now() + ms;
  inputs.forEach((i) => (i.disabled = true)); buttons.forEach((b) => (b.disabled = true));
  const tick = () => {
    const left = until - Date.now();
    if (left <= 0) { clearInterval(timer); inputs.forEach((i) => (i.disabled = false)); buttons.forEach((b) => (b.disabled = false)); setMsg(msgEl, ""); inputs[0].focus(); return; }
    setMsg(msgEl, T("lock.throttle", { t: fmt(left) }));
  };
  tick(); timer = setInterval(tick, 500);
}

/** Gembok terbuka + kilau hijau, lalu bereskan layar kunci. */
async function celebrate() {
  const icon = $("icon"), card = $("card");
  icon.src = "icons/open128.png"; icon.classList.add("pop"); card.classList.add("ok");
  $("title").textContent = T("lock.opened"); $("sub").textContent = "";
  await new Promise((r) => setTimeout(r, matchMedia("(prefers-reduced-motion: reduce)").matches ? 150 : 700));
  await send({ type: "finishUnlock" });
}
function afterUnlock() {
  if (mode === "popup") location.replace("popup.html");
  else if (mode === "window") window.close();
  // mode tab: service worker mengembalikan tab ke halaman asalnya
}
async function unlocked() {
  $("pw").value = "";
  if (embed) { setMsg($("msg"), T("lock.opened") + " ✓", "ok"); return; }    // layar kunci di halaman menghilang sendiri begitu service worker membuka
  $("unlockForm").classList.add("hidden"); await celebrate(); afterUnlock();
}

async function init() {
  state = await send({ type: "getState" });
  T = makeT(state.lang); document.documentElement.lang = state.lang;
  applyI18n(document, T); heading();
  if (!state.hasPassword) {
    $("title").textContent = T("lock.none.title"); $("sub").textContent = T("lock.none.sub");
    $("unlockForm").classList.add("hidden");
    const b = document.createElement("button");
    b.className = "btn"; b.textContent = T("lock.none.btn"); b.onclick = () => chrome.runtime.openOptionsPage();
    $("card").insertBefore(b, $("foot")); return;
  }
  const needs = site || tabScope != null || tabLock ? true : state.locked;     // mode situs: butuh dibuka walau browser terbuka
  if (!needs) {
    $("title").textContent = T("lock.already.title"); $("sub").textContent = T("lock.already.sub");
    $("unlockForm").classList.add("hidden");
    if (mode === "popup") location.replace("popup.html");
    return;
  }
  if (state.bio) {
    $("bio").classList.remove("hidden");
    if (mode === "window") setTimeout(() => $("bio").click(), 350);    // jendela kunci langsung minta sidik jari
  }
  if (params.get("recover") === "1") $("forgot").click();            // dibuka dari tombol "Lupa password?" di layar kunci halaman
  else $("pw").focus();
  if (embed) {
    // iframe baru benar-benar fokus setelah skrip konten memanggil frame.focus(); pastikan kotak password yang menerima ketikan
    addEventListener("focus", () => { if (!$("unlockForm").classList.contains("hidden") && !$("pw").disabled && document.activeElement !== $("pw")) $("pw").focus(); });
    parent.postMessage("bl-ready", "*");
  }                    // beri tahu skrip konten bahwa iframe berhasil dimuat (bukan diblokir CSP)
}

// ---- buka kunci ----
$("eye").onclick = () => {
  const show = $("pw").type === "password";
  $("pw").type = show ? "text" : "password";
  $("eye").setAttribute("aria-pressed", String(show));
  $("eye").setAttribute("aria-label", show ? T("lock.hide") : T("lock.show"));
};

$("unlockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("pw").value;
  if (!pw) { setMsg($("msg"), T("lock.empty")); return; }
  $("go").disabled = true; setMsg($("msg"), T("lock.checking"), "ok");
  const r = await send({ type: "unlock", password: pw, defer: true, site, tab: tabScope, tabLock });
  $("go").disabled = false;
  if (r.ok) { await unlocked(); return; }
  $("pw").value = ""; shake();
  if (r.retryIn) throttle(r.retryIn, $("msg"), [$("pw")], [$("go"), $("bio")]);
  else { setMsg($("msg"), r.triesLeft ? T("lock.wrongLeft", { n: r.triesLeft }) : T("lock.wrong")); $("pw").focus(); }
});

// ---- Touch ID / sidik jari ----
$("bio").addEventListener("click", async () => {
  setMsg($("msg"), "");
  const c = await send({ type: "bioChallenge" });
  if (!c.ok) { if (c.retryIn) throttle(c.retryIn, $("msg"), [$("pw")], [$("go"), $("bio")]); return; }
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: {
      challenge: b64uToBytes(c.challenge), rpId: c.rpId, timeout: 60_000, userVerification: "required",
      allowCredentials: [{ type: "public-key", id: b64uToBytes(c.credId), transports: ["internal"] }],
    } });
  } catch { setMsg($("msg"), T("lock.bioFail")); return; }       // dibatalkan pengguna: tidak dihitung percobaan gagal
  const r = await send({
    type: "bioUnlock", credId: bytesToB64u(cred.rawId), site, tab: tabScope, tabLock, defer: true,
    assertion: { authenticatorData: bytesToB64u(cred.response.authenticatorData), clientDataJSON: bytesToB64u(cred.response.clientDataJSON), signature: bytesToB64u(cred.response.signature) },
  });
  if (r.ok) { await unlocked(); return; }
  shake();
  if (r.retryIn) throttle(r.retryIn, $("msg"), [$("pw")], [$("go"), $("bio")]); else setMsg($("msg"), T("lock.bioFail"));
});

// ---- lupa password ----
$("forgot").onclick = () => {
  if (embed) { send({ type: "openLockWindow", site, tab: tabLock, recover: true }); return; }   // pemulihan butuh layar yang tidak hilang saat terbuka, jadi pakai jendela
  $("unlockForm").classList.add("hidden"); $("recoverForm").classList.remove("hidden"); $("sub").textContent = T("rec.sub"); $("rcode").focus(); };
$("back").onclick = () => { $("recoverForm").classList.add("hidden"); $("unlockForm").classList.remove("hidden"); heading(); $("pw").focus(); };

$("recoverForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!$("rcode").value.trim()) return setMsg($("rmsg"), T("rec.needcode"));
  if ($("np1").value !== $("np2").value) return setMsg($("rmsg"), T("rec.mismatch"));
  $("rgo").disabled = true; setMsg($("rmsg"), T("lock.checking"), "ok");
  const r = await send({ type: "recover", code: $("rcode").value, password: $("np1").value });
  $("rgo").disabled = false;
  if (r.ok) {
    $("recoverForm").classList.add("hidden");
    $("title").textContent = T("rec.done.title"); $("sub").textContent = "";
    $("codeText").textContent = r.recoveryCode; $("newCode").classList.remove("hidden");
    return;
  }
  shake();
  if (r.retryIn) return throttle(r.retryIn, $("rmsg"), [$("rcode"), $("np1"), $("np2")], [$("rgo")]);
  setMsg($("rmsg"), r.code ? pwError(r) : T("rec.bad"));
});

$("copy").onclick = async () => { try { await navigator.clipboard.writeText($("codeText").textContent); $("copy").textContent = T("rec.copied"); } catch { $("copy").textContent = T("rec.copyfail"); } };
$("done").onclick = async () => { $("codeText").textContent = ""; await send({ type: "finishUnlock" }); afterUnlock(); };

init();
