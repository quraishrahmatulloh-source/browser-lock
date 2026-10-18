const $ = (id) => document.getElementById(id);
import { attachMeter } from "./strength.js";
const send = (msg) => chrome.runtime.sendMessage(msg);
["s1", "c1"].forEach((id) => attachMeter($(id)));
$("foot").innerHTML = `<b>madebyuloh</b> · v${chrome.runtime.getManifest().version}`;

function setMsg(el, text, kind = "err") { el.textContent = text; el.className = "msg " + (text ? kind : ""); }
const show = (id) => $(id).classList.remove("hidden");
const hide = (id) => $(id).classList.add("hidden");
const fmt = (ms) => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const explain = (r, fallback) => (r.retryIn ? `Terlalu banyak percobaan. Coba lagi dalam ${fmt(r.retryIn)}.` : fallback);

document.querySelectorAll(".eye").forEach((b) => (b.onclick = () => {
  const input = b.previousElementSibling; const showIt = input.type === "password";
  input.type = showIt ? "text" : "password";
  b.setAttribute("aria-label", showIt ? "Sembunyikan password" : "Tampilkan password");
}));

async function render() {
  const st = await send({ type: "getState" });
  hide("setup"); hide("codeBox"); hide("main");
  if (!st.hasPassword) {
    $("badge").textContent = "Belum aktif"; $("badge").classList.add("off");
    $("sub").textContent = "Atur password untuk mengaktifkan kunci.";
    show("setup"); $("s1").focus(); return;
  }
  if (st.locked) { location.replace("lock.html?mode=tab"); return; }   // pengaturan hanya saat terbuka
  $("badge").textContent = "Aktif"; $("badge").classList.remove("off");
  $("sub").textContent = "Chrome terkunci setiap dibuka.";
  const s = await send({ type: "getSettings" });
  $("auto").value = String(s.autoLockMin);
  $("onScreen").checked = s.lockOnScreenLock;
  show("main");
}

function showCode(code, next) {
  hide("setup"); hide("main");
  $("codeText").textContent = code;
  $("saved").checked = false; $("codeDone").disabled = true; $("copy").textContent = "Salin";
  show("codeBox");
  $("codeDone").onclick = () => { $("codeText").textContent = ""; next(); };
}

// ---- buat password ----
$("setup").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("s1").value !== $("s2").value) return setMsg($("smsg"), "Dua password tidak sama.");
  const r = await send({ type: "setInitialPassword", password: $("s1").value });
  if (!r.ok) return setMsg($("smsg"), r.error === "already-set" ? "Password sudah ada." : r.error);
  $("s1").value = $("s2").value = ""; setMsg($("smsg"), "");
  showCode(r.recoveryCode, render);
});

$("saved").onchange = () => ($("codeDone").disabled = !$("saved").checked);
$("copy").onclick = async () => { try { await navigator.clipboard.writeText($("codeText").textContent); $("copy").textContent = "Tersalin ✓"; } catch { $("copy").textContent = "Salin manual"; } };

// ---- pengaturan kunci otomatis ----
async function saveSettings() {
  const r = await send({ type: "setSettings", patch: { autoLockMin: Number($("auto").value), lockOnScreenLock: $("onScreen").checked } });
  if (r.error) return setMsg($("amsg"), "Gagal menyimpan.");
  setMsg($("amsg"), "Tersimpan ✓", "ok"); setTimeout(() => setMsg($("amsg"), ""), 1800);
}
$("auto").onchange = saveSettings;
$("onScreen").onchange = saveSettings;

// ---- ganti password ----
$("change").addEventListener("submit", async (e) => {
  e.preventDefault();
  if ($("c1").value !== $("c2").value) return setMsg($("cmsg"), "Dua password baru tidak sama.");
  const r = await send({ type: "changePassword", current: $("c0").value, next: $("c1").value });
  if (r.ok) { $("c0").value = $("c1").value = $("c2").value = ""; return setMsg($("cmsg"), "Password diganti ✓", "ok"); }
  setMsg($("cmsg"), explain(r, r.error && r.error.startsWith("Password") ? r.error : "Password sekarang salah."));
});

// ---- kode pemulihan baru ----
$("regen").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await send({ type: "regenerateRecovery", password: $("r0").value });
  if (r.ok) { $("r0").value = ""; setMsg($("rmsg"), ""); return showCode(r.recoveryCode, render); }
  setMsg($("rmsg"), explain(r, "Password salah."));
});

$("lockNow").onclick = () => send({ type: "lockNow" });   // service worker mengalihkan tab ini ke layar kunci

render();
