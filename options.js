import { makeT, applyI18n } from "./lib/i18n.js";
import { attachMeter } from "./strength.js";
import { normalizeHost, SITE_MINUTES } from "./lib/sites.js";
import { bytesToB64u } from "./lib/webauthn.js";

const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
let T = makeT("en"), lang = "en", settings = null;
["s1", "c1"].forEach((id) => attachMeter($(id)));
$("foot").innerHTML = `<a href="https://faquloh.site" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none"><b>madebyuloh</b></a> · v${chrome.runtime.getManifest().version}`;

function setMsg(el, text, kind = "err") { el.textContent = text; el.className = "msg " + (text ? kind : ""); }
const show = (id) => $(id).classList.remove("hidden");
const hide = (id) => $(id).classList.add("hidden");
const fmt = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const explain = (r, fallback) => (r.retryIn ? T("lock.throttle", { t: fmt(r.retryIn) }) : r.code ? T("pw." + r.code) : fallback);
const flash = (el, text) => { setMsg(el, text, "ok"); setTimeout(() => setMsg(el, ""), 1800); };

document.querySelectorAll(".eye").forEach((b) => (b.onclick = () => {
  const input = b.previousElementSibling; const showIt = input.type === "password";
  input.type = showIt ? "text" : "password";
  b.setAttribute("aria-label", showIt ? T("lock.hide") : T("lock.show"));
}));

// ---------- render ----------
function fillSelects() {
  const auto = $("auto"); auto.innerHTML = "";
  for (const n of [0, 1, 5, 10, 15, 30, 60]) {
    const o = document.createElement("option"); o.value = String(n);
    o.textContent = n === 0 ? T("o.auto.never") : n === 60 ? T("o.auto.hour") : T("o.auto.min", { n }); auto.appendChild(o);
  }
  const sm = $("siteMin"); sm.innerHTML = "";
  for (const n of SITE_MINUTES) { const o = document.createElement("option"); o.value = String(n); o.textContent = n === 0 ? T("o.sites.never") : T("o.sites.min", { n }); if (n === 15) o.selected = true; sm.appendChild(o); }
}

function renderSites() {
  const ul = $("siteList"); ul.innerHTML = "";
  if (!settings.siteLocks.length) { const li = document.createElement("li"); li.className = "muted"; li.textContent = T("o.sites.empty"); ul.appendChild(li); return; }
  for (const r of settings.siteLocks) {
    const li = document.createElement("li"); li.className = "item";
    const left = document.createElement("div");
    const b = document.createElement("b"); b.textContent = r.host;
    const s = document.createElement("small"); s.textContent = r.minutes === 0 ? T("o.sites.never") : T("o.sites.min", { n: r.minutes });
    left.append(b, s);
    const rm = document.createElement("button"); rm.type = "button"; rm.textContent = T("o.sites.remove");
    rm.onclick = async () => { settings = await send({ type: "setSettings", patch: { siteLocks: settings.siteLocks.filter((x) => x.host !== r.host) } }); renderSites(); };
    li.append(left, rm); ul.appendChild(li);
  }
}

async function renderLog() {
  const { log, unseen } = await send({ type: "getAttempts" });
  const ul = $("logList"); ul.innerHTML = "";
  $("alert").classList.toggle("hidden", !unseen);
  $("alertText").textContent = unseen ? T("o.log.unseen", { n: unseen }) : "";
  if (!log.length) { const li = document.createElement("li"); li.className = "muted"; li.textContent = T("o.log.empty"); ul.appendChild(li); hide("logClear"); return; }
  show("logClear");
  for (const e of [...log].reverse().slice(0, 15)) {
    const li = document.createElement("li"); li.className = "item";
    const d = document.createElement("div"); const b = document.createElement("b");
    b.textContent = new Date(e.t).toLocaleString(lang === "en" ? "en-US" : "id-ID", { dateStyle: "medium", timeStyle: "short" });
    const s = document.createElement("small"); s.textContent = T("o.log." + e.k);
    d.append(b, s); li.append(d); ul.appendChild(li);
  }
}

async function renderBio(state) {
  const supported = !!window.PublicKeyCredential && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false));
  $("bioEnable").classList.toggle("hidden", state.bio); $("bioDisable").classList.toggle("hidden", !state.bio);
  if (state.bio) setMsg($("bioMsg"), T("o.bio.on"), "ok");
  else if (!supported) { setMsg($("bioMsg"), T("o.bio.unsupported")); $("bioEnable").disabled = true; }
  else { setMsg($("bioMsg"), T("o.bio.off"), "ok"); $("bioEnable").disabled = false; }
}

async function render() {
  const st = await send({ type: "getState" });
  lang = st.lang; T = makeT(lang); document.documentElement.lang = lang; document.title = T("o.title");
  applyI18n(document, T); fillSelects();
  hide("setup"); hide("codeBox"); hide("main");
  if (!st.hasPassword) {
    $("badge").textContent = T("o.badge.off"); $("badge").classList.add("off"); $("sub").textContent = T("o.sub.off");
    show("setup"); $("s1").focus(); return;
  }
  if (st.locked) { location.replace("lock.html?mode=tab"); return; }   // pengaturan hanya saat terbuka
  $("badge").textContent = T("o.badge.on"); $("badge").classList.remove("off"); $("sub").textContent = T("o.sub.on");
  settings = await send({ type: "getSettings" });
  $("auto").value = String(settings.autoLockMin); $("onScreen").checked = settings.lockOnScreenLock;
  $("panicMin").checked = settings.panicMinimize; $("panicClip").checked = settings.panicClipboard; $("lang").value = settings.lang;
  renderSites(); await renderLog(); await renderBio(st);
  show("main");
}

function showCode(code, next) {
  hide("setup"); hide("main");
  $("codeText").textContent = code; $("saved").checked = false; $("codeDone").disabled = true; $("copy").textContent = T("rec.copy");
  show("codeBox");
  $("codeDone").onclick = () => { $("codeText").textContent = ""; next(); };
}

// ---------- buat password ----------
$("setup").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("s1").value !== $("s2").value) return setMsg($("smsg"), T("o.setup.mismatch"));
  const r = await send({ type: "setInitialPassword", password: $("s1").value });
  if (!r.ok) return setMsg($("smsg"), r.error === "already-set" ? T("o.setup.already") : explain(r, r.error));
  $("s1").value = $("s2").value = ""; setMsg($("smsg"), "");
  showCode(r.recoveryCode, render);
});
$("saved").onchange = () => ($("codeDone").disabled = !$("saved").checked);
$("copy").onclick = async () => { try { await navigator.clipboard.writeText($("codeText").textContent); $("copy").textContent = T("rec.copied"); } catch { $("copy").textContent = T("rec.copyfail"); } };

// ---------- pengaturan umum ----------
async function save(patch, msgEl = $("amsg")) {
  const r = await send({ type: "setSettings", patch });
  if (r.error) return setMsg(msgEl, T("o.savefail"));
  settings = r; flash(msgEl, T("o.saved")); return r;
}
$("auto").onchange = () => save({ autoLockMin: Number($("auto").value) });
$("onScreen").onchange = () => save({ lockOnScreenLock: $("onScreen").checked });
$("panicMin").onchange = () => save({ panicMinimize: $("panicMin").checked });
$("panicClip").onchange = () => save({ panicClipboard: $("panicClip").checked });
$("lang").onchange = async () => { await save({ lang: $("lang").value }); await render(); };
$("lockNow").onclick = () => send({ type: "lockNow" });   // service worker mengalihkan tab ini ke layar kunci
$("panicTest").onclick = () => send({ type: "panic" });

// ---------- kunci per situs ----------
$("siteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const host = normalizeHost($("siteHost").value);
  if (!host) return setMsg($("siteMsg"), T("o.sites.bad"));
  const minutes = Number($("siteMin").value);
  const next = [...settings.siteLocks.filter((r) => r.host !== host), { host, minutes }];
  const r = await send({ type: "setSettings", patch: { siteLocks: next } });
  if (r.error) return setMsg($("siteMsg"), T("o.savefail"));
  settings = r; $("siteHost").value = ""; setMsg($("siteMsg"), ""); renderSites();
});

// ---------- catatan percobaan gagal ----------
$("alertSeen").onclick = async () => { await send({ type: "markSeen" }); await renderLog(); };
$("logClear").onclick = async () => { await send({ type: "clearLog" }); await renderLog(); };

// ---------- Touch ID ----------
$("bioEnable").onclick = async () => {
  setMsg($("bioMsg"), "");
  try {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: "Browser Lock", id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "owner", displayName: "Browser Lock" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }], attestation: "none", timeout: 60_000,
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
    } });
    if (cred.response.getPublicKeyAlgorithm() !== -7) throw new Error("alg");
    const r = await send({ type: "bioRegister", credId: bytesToB64u(cred.rawId), publicKey: bytesToB64u(cred.response.getPublicKey()) });
    if (!r.ok) throw new Error(r.error);
    await render(); flash($("bioMsg"), T("o.bio.enabled"));
  } catch { setMsg($("bioMsg"), T("o.bio.cancel")); }
};
$("bioDisable").onclick = async () => { await send({ type: "bioRemove" }); await render(); };

// ---------- ganti password / kode pemulihan baru ----------
$("change").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("c1").value !== $("c2").value) return setMsg($("cmsg"), T("o.chg.mismatch"));
  const r = await send({ type: "changePassword", current: $("c0").value, next: $("c1").value });
  if (r.ok) { $("c0").value = $("c1").value = $("c2").value = ""; return flash($("cmsg"), T("o.chg.done")); }
  setMsg($("cmsg"), explain(r, T("o.chg.wrongcur")));
});
$("regen").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await send({ type: "regenerateRecovery", password: $("r0").value });
  if (r.ok) { $("r0").value = ""; setMsg($("rmsg"), ""); return showCode(r.recoveryCode, render); }
  setMsg($("rmsg"), explain(r, T("o.regen.wrong")));
});

render();
