// Halaman kunci. Dipakai di 3 tempat: jendela popup (mode=window), tab pengganti halaman chrome:// (mode=tab), dan popup toolbar (mode=popup).
const $ = (id) => document.getElementById(id);
const mode = new URLSearchParams(location.search).get("mode") || "tab";
const send = (msg) => chrome.runtime.sendMessage(msg);

let timer = null;
document.body.dataset.mode = mode;
if (mode === "popup") { document.documentElement.style.width = "380px"; document.querySelector(".page").style.padding = "10px"; }

$("foot").innerHTML = `<b>madebyuloh</b> · v${chrome.runtime.getManifest().version}`;

function setMsg(el, text, kind = "err") { el.textContent = text; el.className = "msg " + (text ? kind : ""); }
function shake() { const c = $("card"); c.classList.remove("shake"); void c.offsetWidth; c.classList.add("shake"); }

function fmt(ms) { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }

/** Hitung mundur saat terlalu banyak percobaan salah. */
function throttle(ms, msgEl, inputs, button) {
  clearInterval(timer);
  const until = Date.now() + ms;
  inputs.forEach((i) => (i.disabled = true)); button.disabled = true;
  const tick = () => {
    const left = until - Date.now();
    if (left <= 0) {
      clearInterval(timer); inputs.forEach((i) => (i.disabled = false)); button.disabled = false;
      setMsg(msgEl, ""); inputs[0].focus(); return;
    }
    setMsg(msgEl, `Terlalu banyak percobaan. Coba lagi dalam ${fmt(left)}.`);
  };
  tick(); timer = setInterval(tick, 500);
}

function afterUnlock() {
  if (mode === "popup") location.replace("popup.html");
  else if (mode === "window") window.close();
  // mode tab: service worker mengembalikan tab ke halaman asalnya
}

async function init() {
  const st = await send({ type: "getState" });
  if (!st.hasPassword) {
    $("title").textContent = "Belum ada password";
    $("sub").textContent = "Atur password dulu supaya Browser Lock aktif.";
    $("unlockForm").classList.add("hidden");
    const b = document.createElement("button");
    b.className = "btn"; b.textContent = "Atur password"; b.onclick = () => chrome.runtime.openOptionsPage();
    $("card").insertBefore(b, $("foot"));
    return;
  }
  if (!st.locked) {
    $("title").textContent = "Browser terbuka";
    $("sub").textContent = "Tidak ada yang perlu dibuka sekarang.";
    $("unlockForm").classList.add("hidden");
    if (mode === "popup") location.replace("popup.html");
    return;
  }
  $("pw").focus();
}

// ---- buka kunci ----
$("eye").onclick = () => {
  const show = $("pw").type === "password";
  $("pw").type = show ? "text" : "password";
  $("eye").setAttribute("aria-pressed", String(show));
  $("eye").setAttribute("aria-label", show ? "Sembunyikan password" : "Tampilkan password");
};

$("unlockForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pw = $("pw").value;
  if (!pw) { setMsg($("msg"), "Isi password dulu."); return; }
  $("go").disabled = true; setMsg($("msg"), "Memeriksa…", "ok");
  const r = await send({ type: "unlock", password: pw });
  $("go").disabled = false;
  if (r.ok) { $("pw").value = ""; setMsg($("msg"), "Terbuka ✓", "ok"); afterUnlock(); return; }
  $("pw").value = ""; shake();
  if (r.retryIn) throttle(r.retryIn, $("msg"), [$("pw")], $("go"));
  else {
    setMsg($("msg"), r.triesLeft ? `Password salah. ${r.triesLeft} percobaan lagi sebelum dikunci sementara.` : "Password salah.");
    $("pw").focus();
  }
});

// ---- lupa password ----
$("forgot").onclick = () => { $("unlockForm").classList.add("hidden"); $("recoverForm").classList.remove("hidden"); $("sub").textContent = "Pulihkan akses dengan kode pemulihan."; $("rcode").focus(); };
$("back").onclick = () => { $("recoverForm").classList.add("hidden"); $("unlockForm").classList.remove("hidden"); $("sub").textContent = "Masukkan password untuk membuka."; $("pw").focus(); };

$("recoverForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!$("rcode").value.trim()) return setMsg($("rmsg"), "Isi kode pemulihan.");
  if ($("np1").value !== $("np2").value) return setMsg($("rmsg"), "Dua password baru tidak sama.");
  $("rgo").disabled = true; setMsg($("rmsg"), "Memeriksa…", "ok");
  const r = await send({ type: "recover", code: $("rcode").value, password: $("np1").value });
  $("rgo").disabled = false;
  if (r.ok) {
    $("recoverForm").classList.add("hidden");
    $("title").textContent = "Terpulihkan";
    $("sub").textContent = "";
    $("codeText").textContent = r.recoveryCode;
    $("newCode").classList.remove("hidden");
    return;
  }
  shake();
  if (r.retryIn) return throttle(r.retryIn, $("rmsg"), [$("rcode"), $("np1"), $("np2")], $("rgo"));
  setMsg($("rmsg"), r.error && r.error.startsWith("Password") ? r.error : "Kode pemulihan salah.");
});

$("copy").onclick = async () => { try { await navigator.clipboard.writeText($("codeText").textContent); $("copy").textContent = "Tersalin ✓"; } catch { $("copy").textContent = "Salin manual"; } };
$("done").onclick = async () => { $("codeText").textContent = ""; await send({ type: "finishUnlock" }); afterUnlock(); };

init();
