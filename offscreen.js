// Dokumen tak terlihat untuk mengosongkan clipboard (service worker tidak punya akses clipboard).
chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg?.type !== "offscreen-clear") return false;
  const t = document.getElementById("t");
  t.value = " "; t.select();
  let ok = false; try { ok = document.execCommand("copy"); } catch { /* abaikan */ }
  reply({ ok });
  return false;
});
