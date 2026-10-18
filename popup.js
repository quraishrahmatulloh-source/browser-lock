const $ = (id) => document.getElementById(id);
$("foot").innerHTML = `<b>madebyuloh</b> · v${chrome.runtime.getManifest().version}`;

async function init() {
  const st = await chrome.runtime.sendMessage({ type: "getState" });
  if (st.hasPassword && st.locked) { location.replace("lock.html?mode=popup"); return; }
  if (!st.hasPassword) {
    $("state").textContent = "Belum aktif"; $("state").classList.add("off");
    $("setupNote").classList.remove("hidden");
    $("settings").textContent = "Atur password"; $("settings").classList.remove("line");
  } else {
    $("state").textContent = "Terbuka";
    $("lock").classList.remove("hidden");
  }
}

$("lock").onclick = async () => { await chrome.runtime.sendMessage({ type: "lockNow" }); window.close(); };
$("settings").onclick = () => { chrome.runtime.openOptionsPage(); window.close(); };
init();
