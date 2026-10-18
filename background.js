// Service worker Browser Lock. Semua status disimpan di storage (service worker boleh mati kapan saja).
//  - storage.local   : hash password, kode pemulihan, pengaturan, catatan gagal, kunci publik Touch ID
//  - storage.session : "unlocked", izin buka per situs, tantangan Touch ID (hilang saat Chrome ditutup => selalu terkunci saat dibuka lagi)
import { Vault } from "./lib/auth.js";
import { isSiteLocked, expiryFor, matchRule, normalizeLink } from "./lib/sites.js";
import { verifyAssertion, bytesToB64u } from "./lib/webauthn.js";
import { makeT } from "./lib/i18n.js";

const vault = new Vault({ get: (k) => chrome.storage.local.get(k), set: (o) => chrome.storage.local.set(o) });
const LOCK_PAGE = chrome.runtime.getURL("lock.html");
const EXT_ORIGIN = chrome.runtime.getURL("");
const EXT_ID = chrome.runtime.id;

const sess = {
  get: async (key) => (await chrome.storage.session.get(key))[key],
  set: (key, value) => chrome.storage.session.set({ [key]: value }),
};
// Pembaruan daftar di storage.session harus berurutan. Tanpa ini dua tab yang dialihkan hampir bersamaan saling menimpa
// (baca-ubah-tulis bersamaan), sehingga catatan asal salah satu tab hilang dan tab itu ditutup, bukan dikembalikan.
let chain = Promise.resolve();
function updateMap(key, fn) {
  const run = chain.then(async () => { const m = (await sess.get(key)) || {}; const r = await fn(m); await sess.set(key, m); return r; });
  chain = run.catch(() => {});
  return run;
}
const takeAll = (key) => updateMap(key, (m) => { const copy = { ...m }; for (const k of Object.keys(m)) delete m[k]; return copy; });
const clearMap = (key) => updateMap(key, (m) => { for (const k of Object.keys(m)) delete m[k]; });

const isLockPage = (url) => !!url && url.startsWith(LOCK_PAGE);
const isUnlocked = async () => !!(await sess.get("unlocked"));
const isLocked = async () => (await vault.hasPassword()) && !(await isUnlocked());

// ---------- status per halaman ----------
/** Tab ini terkunci sendiri, entah karena id tabnya, atau karena linknya sama dengan link yang dikunci (walau tab lamanya sudah ditutup). */
async function tabLockedFor(tabId, url) {
  if (tabId != null && ((await sess.get("lockedTabs")) || {})[tabId]) return true;
  const link = normalizeLink(url);
  return !!link && !!((await sess.get("lockedLinks")) || {})[link];
}

/** Apakah halaman (URL) ini harus tertutup sekarang: karena browser terkunci, atau karena aturan kunci per situs. */
async function pageState(url, tabId) {
  if (await isLocked()) return { locked: true, site: null, tab: false };
  if (!(await vault.hasPassword())) return { locked: false, site: null, tab: false };
  if (await tabLockedFor(tabId, url)) return { locked: true, site: null, tab: true };   // satu tab / satu link dikunci sendiri
  const { siteLocks } = await vault.getSettings();
  const rule = isSiteLocked(url, siteLocks, (await sess.get("siteOk")) || {});
  return rule ? { locked: true, site: rule.host, tab: false } : { locked: false, site: null, tab: false };
}

// ---------- tab ----------
/** Tab yang tidak bisa ditutup overlay (chrome://, Web Store, halaman ekstensi, file:// tanpa izin) dialihkan ke halaman kunci. */
async function redirectToLockPage(tab, { tabScope = false } = {}) {
  const url = tab.url || tab.pendingUrl || "";
  if (!tab.id || isLockPage(url)) return;
  // URL kosong = tab baru yang belum selesai dibuat (Chrome baru dibuka): anggap Tab Baru, supaya tab ini tidak ditutup (dan jendelanya hilang) setelah unlock
  await updateMap("redirected", (m) => { if (!m[tab.id]) m[tab.id] = url || "chrome://newtab/"; });
  try { await chrome.tabs.update(tab.id, { url: `${LOCK_PAGE}?mode=tab${tabScope ? `&tab=${tab.id}` : ""}` }); } catch { /* tab sudah tertutup */ }
}

/**
 * Minta skrip konten di tab menghitung ulang statusnya ("refresh"). Tidak ada jawaban = tab itu tidak bisa ditutup overlay.
 * Saat browser terkunci, tab seperti itu dialihkan ke halaman kunci.
 */
async function refreshTab(tab, { redirect = false, tabScope = false } = {}) {
  if (!tab.id || isLockPage(tab.url || tab.pendingUrl)) return;
  try { await chrome.tabs.sendMessage(tab.id, { type: "refresh" }, { frameId: 0 }); }
  catch {
    if (!redirect) return;
    // Saat Chrome baru dibuka, tab pulihan masih memuat / belum dimuat. Skrip konten halaman web akan menutup dirinya sendiri begitu
    // jalan (document_start), jadi jangan dialihkan (tab hilang state-nya). onUpdated mengalihkan lagi kalau ternyata halaman tak bisa ditutup.
    const url = tab.url || tab.pendingUrl || "";
    if (/^(https?|ftp):/.test(url) && tab.status !== "complete") return;
    await redirectToLockPage(tab, { tabScope });
  }
}

async function refreshAll({ redirect = false } = {}) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((t) => (isLockPage(t.url) ? null : refreshTab(t, { redirect }))));
}

async function lockNow({ openWindow = false } = {}) {
  if (!(await vault.hasPassword())) return;
  await sess.set("unlocked", false);
  await clearMap("siteOk");               // setelah dibuka lagi, kunci per situs berlaku dari awal
  await refreshAll({ redirect: true });
  if (openWindow) await openLockWindow();
}

async function closeLockWindow() {
  const id = await sess.get("lockWin");
  await chrome.storage.session.remove(["lockWin", "lockWinKey"]);
  if (id) { try { await chrome.windows.remove(id); } catch { /* sudah tertutup */ } }
}

/** Tandai terbuka dan buka tutup di semua tab. */
async function markUnlocked() { await sess.set("unlocked", true); await clearMap("lockedTabs"); await clearMap("lockedLinks"); await refreshAll(); }   // buka kunci browser = pemilik terbukti, kunci per tab ikut dilepas

/** Bereskan layar kunci: kembalikan tab yang tadi dialihkan, tutup jendela kunci. Dipisah supaya kode pemulihan sempat dibaca. */
async function finishUnlockUi() {
  const map = await takeAll("redirected");
  await Promise.all(Object.entries(map).map(([id, url]) => chrome.tabs.update(Number(id), { url }).catch(() => {})));
  await closeLockWindow();
  const left = (await chrome.tabs.query({})).filter((t) => isLockPage(t.url) && t.url.includes("mode=tab"));
  // sisa tanpa catatan asal ditutup, kecuali itu satu-satunya tab di jendelanya (menutupnya menutup jendela): jadikan Tab Baru
  const all = await chrome.tabs.query({});
  await Promise.all(left.map((t) => (all.some((o) => o.windowId === t.windowId && !left.includes(o))
    ? chrome.tabs.remove(t.id) : chrome.tabs.update(t.id, { url: "chrome://newtab/" })).catch(() => {})));
}

/** Kunci SATU tab saja. Tab lain tidak disentuh. */
async function lockTab(tabId) {
  if (!(await vault.hasPassword()) || (await isLocked())) return false;
  let tab; try { tab = await chrome.tabs.get(tabId); } catch { return false; }
  await updateMap("lockedTabs", (m) => { m[tabId] = true; });
  const link = normalizeLink(tab.url || tab.pendingUrl);
  if (link) await updateMap("lockedLinks", (m) => { m[link] = true; });   // link ini tetap terkunci walau tabnya ditutup
  await refreshTab(tab, { redirect: true, tabScope: true });
  return true;
}

/** Buka satu tab yang dikunci sendiri; kembalikan halaman asalnya kalau tadi dialihkan. */
async function unlockTab(tabId) {
  await updateMap("lockedTabs", (m) => { delete m[tabId]; });
  const orig = await updateMap("redirected", (m) => { const o = m[tabId]; delete m[tabId]; return o; });
  let url = orig; if (!url) { try { url = (await chrome.tabs.get(tabId)).url; } catch { /* tab sudah hilang */ } }
  const link = normalizeLink(url);
  if (link) await updateMap("lockedLinks", (m) => { delete m[link]; });   // membuka satu tab melepas kunci link itu
  await refreshAll();
  if (orig) await chrome.tabs.update(tabId, { url: orig }).catch(() => {});
  else await chrome.tabs.sendMessage(tabId, { type: "refresh" }, { frameId: 0 }).catch(() => {});
  await closeLockWindow();
}

/** Buka satu situs yang dikunci per situs (browser sendiri sudah terbuka). */
async function unlockSite(host) {
  const { siteLocks } = await vault.getSettings();
  const rule = siteLocks.find((r) => r.host === host);
  if (!rule) return false;
  await updateMap("siteOk", (m) => { m[rule.host] = expiryFor(rule); });
  await refreshAll();
  await closeLockWindow();
  return true;
}

async function openLockWindow(site = null, tabId = null, tabUrl = "", recover = false) {
  const locked = await isLocked();
  let key = "browser", q = "?mode=window";
  if (!locked) {
    if (tabId != null && (await tabLockedFor(tabId, tabUrl))) { key = `tab:${tabId}`; q = `?mode=window&tab=${tabId}`; }
    else if (site && (await vault.getSettings()).siteLocks.some((r) => r.host === site)) { key = `site:${site}`; q = `?mode=window&site=${encodeURIComponent(site)}`; }
    else return;
  }
  const id = await sess.get("lockWin");
  if (id && (await sess.get("lockWinKey")) === key) { try { await chrome.windows.update(id, { focused: true, drawAttention: true }); return; } catch { /* jendela lama hilang */ } }
  if (id) await closeLockWindow();
  if (recover) q += "&recover=1";
  const w = await chrome.windows.create({ url: LOCK_PAGE + q, type: "popup", width: 440, height: 660, focused: true });
  await sess.set("lockWin", w.id); await sess.set("lockWinKey", key);
}

/** Saat Chrome baru dibuka jendela utama kadang belum ada; membuat popup lebih dulu membuatnya tersembunyi / gagal. Tunggu sebentar. */
async function openLockWindowWhenReady() {
  for (let i = 0; i < 10 && !(await chrome.windows.getAll({ windowTypes: ["normal"] })).length; i++) await new Promise((r) => setTimeout(r, 300));
  try { await openLockWindow(); } catch { await new Promise((r) => setTimeout(r, 500)); await openLockWindow().catch(() => {}); }
}

// ---------- catatan percobaan gagal + lencana ----------
async function updateBadge() {
  const { unseen } = await vault.getAttempts();
  await chrome.action.setBadgeText({ text: unseen ? String(Math.min(unseen, 99)) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#d6364a" });
}

// ---------- tombol panik ----------
async function clearClipboard() {
  try { await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["CLIPBOARD"], justification: "Kosongkan clipboard saat tombol panik ditekan" }); }
  catch (e) { if (!String(e).includes("single offscreen")) throw e; }
  try { await chrome.runtime.sendMessage({ type: "offscreen-clear" }); } finally { try { await chrome.offscreen.closeDocument(); } catch { /* sudah tertutup */ } }
}
async function panic() {
  if (!(await vault.hasPassword())) return;
  await lockNow();
  const s = await vault.getSettings();
  if (s.panicMinimize) for (const w of await chrome.windows.getAll()) { try { await chrome.windows.update(w.id, { state: "minimized" }); } catch { /* abaikan */ } }
  if (s.panicClipboard) await clearClipboard().catch(() => {});
}

// ---------- kunci otomatis + kunci per situs berkala ----------
async function applyIdleSettings() {
  const { autoLockMin } = await vault.getSettings();
  chrome.idle.setDetectionInterval(autoLockMin > 0 ? Math.max(15, autoLockMin * 60) : 600);
}
chrome.idle.onStateChanged.addListener(async (state) => {
  const s = await vault.getSettings();
  if (state === "idle" && s.autoLockMin > 0) await lockNow();
  if (state === "locked" && s.lockOnScreenLock) await lockNow();
});

chrome.alarms.get("sitecheck").then((a) => { if (!a) chrome.alarms.create("sitecheck", { periodInMinutes: 1 }); });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "sitecheck" || (await isLocked())) return;
  const { siteLocks } = await vault.getSettings();
  if (!siteLocks.length) return;
  const ok = (await sess.get("siteOk")) || {};
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.filter((t) => isSiteLocked(t.url, siteLocks, ok)).map((t) => refreshTab(t)));   // kadaluarsa => tertutup lagi
});

// ---------- kejadian ----------
chrome.runtime.onInstalled.addListener(async (d) => {
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  if (d.reason === "install" && !(await vault.hasPassword())) chrome.runtime.openOptionsPage();
  applyIdleSettings(); updateBadge();
});

// Sesi browser baru = storage.session kosong (penanda "booted" belum ada). Tidak bergantung pada onStartup,
// jadi tetap benar juga setelah ekstensi dimuat ulang atau diperbarui (status terbuka ikut hilang => terkunci).
let booting = null;
function bootCheck() {
  return (booting ||= (async () => {
    if (await sess.get("booted")) return;
    await sess.set("booted", true);
    if (await isLocked()) { await refreshAll({ redirect: true }); await openLockWindowWhenReady(); }   // Chrome baru dibuka: minta password langsung
  })());
}
chrome.runtime.onStartup.addListener(() => { applyIdleSettings(); bootCheck(); updateBadge(); });

// tab baru / berpindah halaman saat terkunci: pastikan tertutup
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" && !info.url) return;
  if (await isLocked()) { await refreshTab({ ...tab, id: tabId }, { redirect: true }); return; }
  // link yang pernah dikunci dibuka lagi di tab baru: tertutup juga (halaman chrome:// dialihkan ke layar kunci khusus tab itu)
  if (await tabLockedFor(tabId, tab.url || tab.pendingUrl)) await refreshTab({ ...tab, id: tabId }, { redirect: true, tabScope: true });
});
chrome.tabs.onCreated.addListener(async (tab) => {
  if (await isLocked()) await refreshTab(tab, { redirect: true });
  else if (await tabLockedFor(tab.id, tab.pendingUrl || tab.url)) await refreshTab(tab, { redirect: true, tabScope: true });
});
chrome.windows.onRemoved.addListener(async (id) => { if ((await sess.get("lockWin")) === id) await chrome.storage.session.remove(["lockWin", "lockWinKey"]); });

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd === "lock-now") lockNow();
  else if (cmd === "panic") panic();
  else if (cmd === "lock-tab") { const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); if (t) lockTab(t.id); }
});
chrome.tabs.onRemoved.addListener(async (tabId) => {   // bersihkan catatan tab yang sudah ditutup
  for (const key of ["lockedTabs", "redirected"]) await updateMap(key, (m) => { delete m[tabId]; });
});

applyIdleSettings(); bootCheck(); updateBadge();

// ---------- pesan ----------
// Aksi sensitif hanya dari halaman ekstensi ini (jendela kunci, popup, opsi). Skrip konten di halaman web hanya boleh tanya status.
const fromExtensionPage = (sender) => sender.id === EXT_ID && !!sender.url && sender.url.startsWith(EXT_ORIGIN);
const goodB64u = (s, max) => typeof s === "string" && s.length > 0 && s.length <= max && /^[A-Za-z0-9_-]+$/.test(s);

/** Setelah password / sidik jari / kode pemulihan benar: buka sesuai konteks (browser atau satu situs). */
async function completeUnlock({ site, tab, defer }) {
  if (tab != null && !(await isLocked())) { await unlockTab(Number(tab)); return; }
  if (site && !(await isLocked())) { await unlockSite(site); return; }
  await markUnlocked();
  if (defer) setTimeout(async () => { if (await isUnlocked()) await finishUnlockUi(); }, 1800);   // jaga-jaga layar kunci tidak memanggil finishUnlock
  else await finishUnlockUi();
}

const handlers = {
  async lockTab({ tabId }) { return { ok: await lockTab(Number(tabId)) }; },
  async getState(_msg, sender) {
    const settings = await vault.getSettings();
    const T = makeT(settings.lang);
    const st = sender.tab ? await pageState(sender.tab.url, sender.tab.id) : { locked: false, site: null, tab: false };
    return {
      hasPassword: await vault.hasPassword(), locked: await isLocked(), version: chrome.runtime.getManifest().version,
      lang: settings.lang, bio: !!(await vault.getBio()),   // lang dipakai skrip konten untuk format jam/tanggal
      pageLocked: st.locked, site: st.site, tabLocked: st.tab,   // untuk skrip konten: tab ini harus tertutup?
      ui: { lang: settings.lang, title: T("ov.title"), sub: T("ov.sub"), btn: T("ov.btn"), hint: T("ov.hint"), siteTitle: T("ov.site.title"), siteSub: T("ov.site.sub"), tabTitle: T("ov.tab.title"), tabSub: T("ov.tab.sub") },
    };
  },
  async openLockWindow({ site, tab, recover }, sender) { await openLockWindow(typeof site === "string" ? site : null, tab && sender.tab ? sender.tab.id : null, sender.tab ? sender.tab.url : "", recover === true); return { ok: true }; },

  async unlock({ password, defer, site, tab, tabLock }, sender) {
    if (tab == null && tabLock && sender.tab) tab = sender.tab.id;     // dibenamkan di tab itu sendiri: tab yang dibuka = tab pengirim
    const r = await vault.tryUnlock(password);
    if (!r.ok && !r.throttled) await updateBadge();
    if (r.ok) await completeUnlock({ site, tab, defer });
    return r;
  },
  async lockNow() { await lockNow(); return { ok: true }; },
  async panic() { await panic(); return { ok: true }; },

  async setInitialPassword({ password }) {
    const r = await vault.setInitialPassword(password);
    if (r.ok) await sess.set("unlocked", true);   // baru dibuat: jangan langsung mengunci pemiliknya
    return r;
  },
  async recover({ code, password }) {
    const r = await vault.recover(code, password);
    if (!r.ok && !r.throttled) await updateBadge();
    if (r.ok) await markUnlocked();            // layar kunci dibiarkan dulu sampai kode pemulihan baru dibaca
    return r;
  },
  async finishUnlock() { if (await isUnlocked()) await finishUnlockUi(); return { ok: true }; },

  // ---- Touch ID / sidik jari (WebAuthn) ----
  async bioChallenge() {
    const bio = await vault.getBio();
    if (!bio) return { ok: false, error: "no-bio" };
    const blocked = await vault.gate();
    if (blocked) return blocked;
    const challenge = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
    await sess.set("bioCh", { challenge, exp: Date.now() + 120_000 });
    return { ok: true, challenge, credId: bio.credId, rpId: EXT_ID };
  },
  async bioUnlock({ credId, assertion, site, tab, tabLock, defer }, sender) {
    if (tab == null && tabLock && sender.tab) tab = sender.tab.id;
    const bio = await vault.getBio();
    if (!bio) return { ok: false, error: "no-bio" };
    const blocked = await vault.gate();
    if (blocked) return blocked;
    const ch = await sess.get("bioCh");
    await chrome.storage.session.remove("bioCh");          // tantangan sekali pakai (anti replay)
    let good = false;
    if (ch && ch.exp > Date.now() && credId === bio.credId && assertion && goodB64u(assertion.signature, 400) && goodB64u(assertion.authenticatorData, 400) && goodB64u(assertion.clientDataJSON, 2000)) {
      good = (await verifyAssertion({ publicKeySpki: bio.publicKey, rpId: EXT_ID, origin: `chrome-extension://${EXT_ID}`, challenge: ch.challenge, assertion })).ok;
    }
    if (!good) { const r = await vault.failAttempt(Date.now(), "biometric"); await updateBadge(); return r; }
    await vault.clearFails();
    await completeUnlock({ site, tab, defer });
    return { ok: true };
  },

  // ---- di bawah ini hanya boleh saat sudah terbuka ----
  async changePassword({ current, next }) { return vault.changePassword(current, next); },
  async regenerateRecovery({ password }) { return vault.regenerateRecovery(password); },
  async getSettings() { return vault.getSettings(); },
  async setSettings({ patch }) {
    const s = await vault.setSettings(patch);
    await applyIdleSettings();
    if (patch && Array.isArray(patch.siteLocks)) await refreshAll();   // aturan baru/dihapus langsung berlaku
    return s;
  },
  async getAttempts() { return vault.getAttempts(); },
  async markSeen() { await vault.markSeen(); await updateBadge(); return { ok: true }; },
  async clearLog() { await vault.clearLog(); await updateBadge(); return { ok: true }; },
  async bioRegister({ credId, publicKey }) {
    if (!goodB64u(credId, 1400) || !goodB64u(publicKey, 400)) return { ok: false, error: "invalid" };
    await vault.setBio({ credId, publicKey });
    return { ok: true };
  },
  async bioRemove() { await vault.removeBio(); return { ok: true }; },
};
const PUBLIC = new Set(["getState", "openLockWindow"]);
const NEEDS_UNLOCKED = new Set(["changePassword", "regenerateRecovery", "getSettings", "setSettings", "getAttempts", "markSeen", "clearLog", "bioRegister", "bioRemove"]);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "offscreen-clear") return false;   // pesan untuk dokumen offscreen, bukan untuk kita
  (async () => {
    const h = handlers[msg?.type];
    if (!h) return { ok: false, error: "unknown" };
    if (!PUBLIC.has(msg.type) && !fromExtensionPage(sender)) return { ok: false, error: "forbidden" };
    if (NEEDS_UNLOCKED.has(msg.type) && (await isLocked())) return { ok: false, error: "locked" };
    return h(msg, sender);
  })().then(sendResponse, (e) => sendResponse({ ok: false, error: String((e && e.message) || e) }));
  return true;   // jawaban async
});
