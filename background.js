// Service worker Browser Lock. Semua status disimpan di storage (service worker boleh mati kapan saja).
//  - storage.local   : hash password, kode pemulihan, pengaturan, hitungan salah
//  - storage.session : "unlocked" (hilang otomatis saat Chrome ditutup => selalu terkunci saat dibuka lagi)
import { Vault } from "./lib/auth.js";

const vault = new Vault({ get: (k) => chrome.storage.local.get(k), set: (o) => chrome.storage.local.set(o) });
const LOCK_PAGE = chrome.runtime.getURL("lock.html");
const EXT_ORIGIN = chrome.runtime.getURL("");

const sess = {
  get: async (key) => (await chrome.storage.session.get(key))[key],
  set: (key, value) => chrome.storage.session.set({ [key]: value }),
};

const isUnlocked = async () => !!(await sess.get("unlocked"));
const isLocked = async () => (await vault.hasPassword()) && !(await isUnlocked());

// ---------- tab ----------
const isLockPage = (url) => !!url && url.startsWith(LOCK_PAGE);

/** Tab yang tidak bisa ditutup overlay (chrome://, Web Store, halaman ekstensi, file:// tanpa izin) dialihkan ke halaman kunci. */
async function redirectToLockPage(tab) {
  const url = tab.url || tab.pendingUrl || "";
  if (!tab.id || isLockPage(url)) return;
  const map = (await sess.get("redirected")) || {};
  if (url && !map[tab.id]) map[tab.id] = url;
  await sess.set("redirected", map);
  try { await chrome.tabs.update(tab.id, { url: `${LOCK_PAGE}?mode=tab` }); } catch { /* tab sudah tertutup */ }
}

/** Tanya skrip konten di tab apakah hidup. Kalau tidak ada jawaban, tab itu tidak bisa ditutup overlay. */
async function coverTab(tab, type) {
  if (!tab.id || isLockPage(tab.url || tab.pendingUrl)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type }, { frameId: 0 });
  } catch {
    if (type === "lock") await redirectToLockPage(tab);
  }
}

async function lockNow({ openWindow = false } = {}) {
  if (!(await vault.hasPassword())) return;
  await sess.set("unlocked", false);
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => coverTab(t, "lock")));
  if (openWindow) await openLockWindow();
}

async function closeLockWindow() {
  const id = await sess.get("lockWin");
  await chrome.storage.session.remove("lockWin");
  if (id) { try { await chrome.windows.remove(id); } catch { /* sudah tertutup */ } }
}

/** Tandai terbuka dan buka tutup di semua tab. */
async function markUnlocked() {
  await sess.set("unlocked", true);
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => (isLockPage(t.url) ? null : chrome.tabs.sendMessage(t.id, { type: "unlock" }, { frameId: 0 }).catch(() => {}))));
}

/** Bereskan layar kunci: kembalikan tab yang tadi dialihkan, tutup jendela kunci. Dipisah supaya kode pemulihan sempat dibaca. */
async function finishUnlockUi() {
  const map = (await sess.get("redirected")) || {};
  await sess.set("redirected", {});
  await Promise.all(Object.entries(map).map(([id, url]) => chrome.tabs.update(Number(id), { url }).catch(() => {})));
  await closeLockWindow();
  // tab halaman kunci yang tidak punya catatan asal: tutup supaya tidak tersisa
  const left = (await chrome.tabs.query({})).filter((t) => isLockPage(t.url) && t.url.includes("mode=tab"));
  await Promise.all(left.map((t) => chrome.tabs.remove(t.id).catch(() => {})));
}

async function openLockWindow() {
  if (!(await isLocked())) return;
  const id = await sess.get("lockWin");
  if (id) {
    try { await chrome.windows.update(id, { focused: true, drawAttention: true }); return; } catch { /* jendela lama sudah hilang */ }
  }
  const w = await chrome.windows.create({ url: `${LOCK_PAGE}?mode=window`, type: "popup", width: 440, height: 640, focused: true });
  await sess.set("lockWin", w.id);
}

// ---------- auto-lock ----------
async function applyIdleSettings() {
  const { autoLockMin } = await vault.getSettings();
  chrome.idle.setDetectionInterval(autoLockMin > 0 ? Math.max(15, autoLockMin * 60) : 600);
}

chrome.idle.onStateChanged.addListener(async (state) => {
  const s = await vault.getSettings();
  if (state === "idle" && s.autoLockMin > 0) await lockNow();
  if (state === "locked" && s.lockOnScreenLock) await lockNow();
});

// ---------- kejadian ----------
chrome.runtime.onInstalled.addListener(async (d) => {
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  if (d.reason === "install" && !(await vault.hasPassword())) chrome.runtime.openOptionsPage();
  applyIdleSettings();
});

// Sesi browser baru = storage.session kosong (penanda "booted" belum ada). Tidak bergantung pada onStartup,
// jadi tetap benar juga setelah ekstensi dimuat ulang atau diperbarui (status terbuka ikut hilang => terkunci).
let booting = null;
function bootCheck() {
  return (booting ||= (async () => {
    if (await sess.get("booted")) return;
    await sess.set("booted", true);
    if (await isLocked()) {   // Chrome baru dibuka: minta password langsung
      const tabs = await chrome.tabs.query({});
      await Promise.all(tabs.map((t) => coverTab(t, "lock")));
      await openLockWindow();
    }
  })());
}
chrome.runtime.onStartup.addListener(() => { applyIdleSettings(); bootCheck(); });

// tab baru / berpindah halaman saat terkunci: pastikan tertutup
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" && !info.url) return;
  if (await isLocked()) await coverTab({ ...tab, id: tabId }, "lock");
});
chrome.tabs.onCreated.addListener(async (tab) => { if (await isLocked()) await coverTab(tab, "lock"); });

chrome.windows.onRemoved.addListener(async (id) => { if ((await sess.get("lockWin")) === id) await chrome.storage.session.remove("lockWin"); });

chrome.commands.onCommand.addListener((cmd) => { if (cmd === "lock-now") lockNow(); });

applyIdleSettings();
bootCheck();

// ---------- pesan ----------
// Aksi sensitif hanya dari halaman ekstensi ini (jendela kunci, popup, opsi). Skrip konten di halaman web hanya boleh tanya status.
const fromExtensionPage = (sender) => sender.id === chrome.runtime.id && !!sender.url && sender.url.startsWith(EXT_ORIGIN);

const handlers = {
  async getState() {
    return { hasPassword: await vault.hasPassword(), locked: await isLocked(), version: chrome.runtime.getManifest().version };
  },
  async openLockWindow() { await openLockWindow(); return { ok: true }; },

  async unlock({ password, defer }) {
    const r = await vault.tryUnlock(password);
    if (r.ok) {
      await markUnlocked();
      if (defer) setTimeout(async () => { if (await isUnlocked()) await finishUnlockUi(); }, 1800);   // jaga-jaga layar kunci tidak memanggil finishUnlock; dilewati kalau sudah dikunci lagi
      else await finishUnlockUi();
    }
    return r;
  },
  async lockNow() { await lockNow(); return { ok: true }; },

  async setInitialPassword({ password }) {
    const r = await vault.setInitialPassword(password);
    if (r.ok) await sess.set("unlocked", true);   // baru dibuat: jangan langsung mengunci pemiliknya
    return r;
  },
  async recover({ code, password }) {
    const r = await vault.recover(code, password);
    if (r.ok) await markUnlocked();            // layar kunci dibiarkan dulu sampai kode pemulihan baru dibaca
    return r;
  },
  async finishUnlock() { if (await isUnlocked()) await finishUnlockUi(); return { ok: true }; },

  // di bawah ini hanya boleh saat sudah terbuka
  async changePassword({ current, next }) { return vault.changePassword(current, next); },
  async regenerateRecovery({ password }) { return vault.regenerateRecovery(password); },
  async getSettings() { return vault.getSettings(); },
  async setSettings({ patch }) { const s = await vault.setSettings(patch); await applyIdleSettings(); return s; },
};
const PUBLIC = new Set(["getState", "openLockWindow"]);
const NEEDS_UNLOCKED = new Set(["changePassword", "regenerateRecovery", "getSettings", "setSettings"]);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const h = handlers[msg?.type];
    if (!h) return { ok: false, error: "unknown" };
    if (!PUBLIC.has(msg.type) && !fromExtensionPage(sender)) return { ok: false, error: "forbidden" };
    if (NEEDS_UNLOCKED.has(msg.type) && (await isLocked())) return { ok: false, error: "locked" };
    return h(msg);
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;   // jawaban async
});
