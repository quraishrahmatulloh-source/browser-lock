import { makeT, applyI18n } from "./lib/i18n.js";
const $ = (id) => document.getElementById(id);
const send = (msg) => chrome.runtime.sendMessage(msg);
$("foot").innerHTML = `<b>madebyuloh</b> · v${chrome.runtime.getManifest().version}`;

async function init() {
  const st = await send({ type: "getState" });
  const T = makeT(st.lang); document.documentElement.lang = st.lang; applyI18n(document, T);
  if (st.hasPassword && st.locked) { location.replace("lock.html?mode=popup"); return; }
  if (!st.hasPassword) {
    $("state").textContent = T("p.off"); $("state").classList.add("off");
    $("setupNote").classList.remove("hidden");
    $("settings").textContent = T("p.setup"); $("settings").classList.remove("line");
    return;
  }
  $("state").textContent = T("p.open");
  $("lockTab").classList.remove("hidden"); $("lock").classList.remove("hidden"); $("panic").classList.remove("hidden"); $("hint").classList.remove("hidden");
  const mac = /Mac/i.test(navigator.platform), mod = mac ? "⌘" : "Ctrl";
  const combo = (key, label) => `<span class="hintrow"><span class="kbd">${mod}</span> <span class="kbd">Shift</span> <span class="kbd">${key}</span> <b>${label}</b></span>`;
  $("hint").innerHTML = [combo("Y", T("p.hintTab")), combo("L", T("p.hintAll")), combo("K", T("p.hintPanic"))].join("");
  const a = await send({ type: "getAttempts" });
  if (a.unseen) { $("alert").classList.remove("hidden"); $("alertText").textContent = T("p.attempts", { n: a.unseen }); }
  $("seen").onclick = async () => { await send({ type: "markSeen" }); $("alert").classList.add("hidden"); };
}
$("lockTab").onclick = async () => {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (t) await send({ type: "lockTab", tabId: t.id });
  window.close();
};
$("lock").onclick = async () => { await send({ type: "lockNow" }); window.close(); };
$("panic").onclick = async () => { await send({ type: "panic" }); window.close(); };
$("settings").onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
init();
