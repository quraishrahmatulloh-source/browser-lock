// Uji end-to-end: menjalankan ekstensi asli di Chrome for Testing (headless) dan menggerakkannya lewat CDP.
// Pakai: CHROME_BIN="/path/ke/Google Chrome for Testing" node tests/e2e.mjs
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EXT = process.env.EXT_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");   // EXT_DIR: uji isi ZIP yang sudah diekstrak
const CHROME = process.env.CHROME_BIN;
if (!CHROME) { console.error("Set CHROME_BIN ke Chrome for Testing"); process.exit(2); }
let PORT = 9350; const SITE = 8765;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "bl-e2e-"));
let pass = 0, fail = 0, chrome = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"} ${name}${!cond && extra ? "  -> " + extra : ""}`); };
async function until(fn, ms = 8000, step = 150) { const t = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch {} if (Date.now() - t > ms) return null; await sleep(step); } }

// ---- situs uji ----
const site = http.createServer((req, res) => { res.setHeader("content-type", "text/html"); if (req.url.startsWith("/csp")) res.setHeader("Content-Security-Policy", "frame-src 'none'; child-src 'none'"); res.end(`<!doctype html><title>Halaman Uji</title><h1 id="x">isi rahasia</h1><input id="q">`); }).listen(SITE);

// ---- CDP ----
const jget = async (p, init) => (await fetch(`http://127.0.0.1:${PORT}${p}`, init)).json();
const list = () => jget("/json/list");
async function conn(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pend = new Map(); const ctxs = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) pend.get(d.id)(d); if (d.method === "Runtime.executionContextCreated") ctxs.push(d.params.context); };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.delete(i)) r({ result: undefined, timeout: method }); }, 8000); });
  await send("Runtime.enable");
  const ev = async (expression, contextId) => { const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) }); if (!r.result) return undefined;   // konteks hilang karena halaman dialihkan (perilaku yang benar saat dikunci)
    if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result.value; };
  return { send, ev, ctxs, close: () => ws.close() };
}
const target = (pred) => until(async () => (await list()).find((t) => t.type === "page" && pred(t)));
async function openTab(url) { const t = await jget(`/json/new?${url}`, { method: "PUT" }); return t; }

function launch() {
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-search-engine-choice-screen", `--load-extension=${EXT}`, "about:blank"], { stdio: "ignore" });
}
async function stop() { if (chrome) { chrome.kill("SIGTERM"); await sleep(1500); chrome = null; } }
// service worker milik Browser Lock (Chrome for Testing punya ekstensi bawaan lain yang juga bernama background.js)
async function ready() {
  return until(async () => {
    for (const t of (await list()).filter((x) => x.type === "service_worker" && x.url.endsWith("/background.js"))) {
      const c = await conn(t.webSocketDebuggerUrl);
      try { if ((await c.ev("chrome.runtime.getManifest().name")) === "Browser Lock") return t; } finally { c.close(); }
    }
  }, 15000);
}

// ---- helpers UI ----
const fill = (c, sel, v) => c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});e.value=${JSON.stringify(v)};e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const submit = (c, sel) => c.ev(`document.querySelector(${JSON.stringify(sel)}).requestSubmit()`);
const text = (c, sel) => c.ev(`document.querySelector(${JSON.stringify(sel)})?.textContent || ''`);
const visible = (c, sel) => c.ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});return !!e && !e.classList.contains('hidden') && getComputedStyle(e).display!=='none'})()`);
const send = (c, msg) => c.ev(`chrome.runtime.sendMessage(${JSON.stringify(msg)})`);
const covered = async (c) => { for (let i = 0; i < 4; i++) { const r = await c.ev(`({host: !!document.querySelector('[data-browser-lock]'), vis: getComputedStyle(document.documentElement).visibility, title: document.title})`); if (r) return r; await sleep(300); } throw new Error("covered: halaman tidak menjawab"); };

// kirim pesan lewat tab halaman ekstensi baru (ditutup lagi setelahnya)
async function ext(extId, msg) {
  const t = await openTab(`chrome-extension://${extId}/popup.html`);
  // saat terkunci, tab baru dialihkan ke layar kunci: tunggu sampai alamatnya stabil sebelum mengirim pesan
  let last = "", same = 0;
  for (let i = 0; i < 40 && same < 3; i++) { await sleep(250); const cur = (await list()).find((x) => x.id === t.id); const u = cur ? cur.url : ""; same = u === last && u ? same + 1 : 0; last = u; }
  const c = await conn(t.webSocketDebuggerUrl);
  try { return await send(c, msg); } finally { c.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {}); }
}

// evaluasi ekspresi bebas lewat halaman ekstensi (mis. mencari id tab Chrome)
async function extEval(extId, expr) {
  const t = await openTab(`chrome-extension://${extId}/popup.html`);
  await sleep(1200);
  const c = await conn(t.webSocketDebuggerUrl);
  try { return await c.ev(expr); } finally { c.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${t.id}`).catch(() => {}); }
}
const chromeTabId = (extId, urlPattern) => extEval(extId, `chrome.tabs.query({ url: ${JSON.stringify(urlPattern)} }).then((t) => t[0] && t[0].id)`);

// ketik lewat input sungguhan ke frame yang sedang fokus (seperti pengguna), lalu Enter
async function typeInto(c, text) {
  await c.send("Page.bringToFront");
  await c.send("Input.insertText", { text });
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}
const blMode = (c) => c.ev("document.querySelector('[data-browser-lock]')?.getAttribute('data-bl-mode')");

// iframe lintas-origin tidak muncul di Page.getFrameTree; ia target terpisah di tingkat browser
async function browserTargets() {
  const v = await jget("/json/version"); const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  const res = await new Promise((r) => { ws.onmessage = (m) => r(JSON.parse(m.data)); ws.send(JSON.stringify({ id: 1, method: "Target.getTargets" })); });
  ws.close(); return res.result.targetInfos;
}

const noLockTabs = () => until(async () => !(await list()).some((t) => t.type === "page" && t.url.includes("/lock.html")), 8000);

async function main() {
  launch();
  const sw = await ready();
  ok("ekstensi termuat (service worker hidup)", !!sw);
  const extId = new URL(sw.url).host;

  // ---- 1. pemasangan pertama membuka halaman pengaturan, buat password ----
  const optT = await target((t) => t.url.includes(`${extId}/options.html`));
  ok("halaman pengaturan terbuka otomatis saat pertama dipasang", !!optT);
  const opt = await conn(optT.webSocketDebuggerUrl);
  ok("form buat password tampil", !!(await until(async () => visible(opt, "#setup"))));
  await fill(opt, "#s1", "pendek"); await fill(opt, "#s2", "pendek"); await submit(opt, "#setup");
  ok("password pendek ditolak", /minimal 8/.test(await until(async () => text(opt, "#smsg"))));
  await fill(opt, "#s1", "rahasia-satu-1"); await fill(opt, "#s2", "beda-sendiri-2"); await submit(opt, "#setup");
  ok("dua password tidak sama ditolak", /tidak sama/.test(await until(async () => text(opt, "#smsg"))));
  await fill(opt, "#s2", "rahasia-satu-1"); await submit(opt, "#setup");
  const code = await until(async () => { const t = await text(opt, "#codeText"); return /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/.test(t) ? t : null; });
  ok("kode pemulihan tampil dengan format benar", !!code, String(code));
  ok("tombol Lanjut mati sampai kotak 'sudah disimpan' dicentang", await opt.ev("document.getElementById('codeDone').disabled"));
  await opt.ev("(()=>{const c=document.getElementById('saved');c.checked=true;c.dispatchEvent(new Event('change'))})()");
  await opt.ev("document.getElementById('codeDone').click()");
  ok("pengaturan tampil setelah kode disimpan", !!(await until(async () => visible(opt, "#main"))));
  ok("kode pemulihan terhapus dari layar", (await text(opt, "#codeText")) === "");

  // ---- 2. halaman biasa tidak tertutup saat terbuka ----
  const pageT = await openTab(`http://127.0.0.1:${SITE}/`);
  const page = await conn(pageT.webSocketDebuggerUrl);
  await sleep(1200);
  let c = await covered(page);
  ok("halaman tidak tertutup saat sudah terbuka", !c.host && c.vis === "visible" && c.title === "Halaman Uji", JSON.stringify(c));

  // ---- 3. pengaturan tersimpan ----
  await opt.ev("(()=>{const s=document.getElementById('auto');s.value='15';s.dispatchEvent(new Event('change'))})()");
  await sleep(500);
  const st = await send(opt, { type: "getSettings" });
  ok("pengaturan auto-lock tersimpan (15 menit)", st.autoLockMin === 15 && st.lockOnScreenLock === true, JSON.stringify(st));

  // ---- 4. kunci sekarang ----
  await ext(extId, { type: "lockNow" });
  c = await until(async () => { const r = await covered(page); return r.host ? r : null; });
  ok("halaman tertutup dan isinya disembunyikan saat terkunci", !!c && c.vis === "hidden" && c.title === "🔒", JSON.stringify(c));
  const bodyText = await page.ev("document.getElementById('x').innerText");
  ok("isi halaman tidak terlihat (visibility hidden)", (await page.ev("getComputedStyle(document.getElementById('x')).visibility")) === "hidden", bodyText);
  ok("halaman pengaturan dialihkan ke layar kunci", !!(await target((t) => t.url.includes(`${extId}/lock.html`))));

  // ---- 5. keamanan pesan: skrip konten tidak boleh membuka kunci ----
  await sleep(300);
  const iso = page.ctxs.find((x) => x.auxData?.type === "isolated" && x.origin.includes(extId));
  ok("konteks skrip konten ditemukan", !!iso);
  if (iso) {
    const forb = await page.ev(`chrome.runtime.sendMessage({type:'unlock',password:'rahasia-satu-1'})`, iso.id);
    ok("skrip konten DITOLAK saat mencoba unlock (forbidden)", forb && forb.ok === false && forb.error === "forbidden", JSON.stringify(forb));
    const forb2 = await page.ev(`chrome.runtime.sendMessage({type:'setSettings',patch:{autoLockMin:0}})`, iso.id);
    ok("skrip konten DITOLAK mengubah pengaturan", forb2 && forb2.error === "forbidden", JSON.stringify(forb2));
    const stt = await page.ev(`chrome.runtime.sendMessage({type:'getState'})`, iso.id);
    ok("skrip konten boleh tanya status, tanpa membocorkan hash", stt.locked === true && !JSON.stringify(stt).match(/hash|salt/), JSON.stringify(stt));
  }

  // ---- 5b. password diketik LANGSUNG di halaman (iframe milik ekstensi), tanpa jendela popup ----
  const inl = await until(async () => ((await blMode(page)) === "inline" ? "inline" : null), 8000);
  ok("layar kunci memuat kotak password langsung di halaman (mode inline)", inl === "inline", String(await blMode(page)));
  ok("iframe milik ekstensi (chrome-extension://) ada di halaman", (await browserTargets()).some((t) => t.type === "iframe" && t.url.startsWith(`chrome-extension://${extId}/lock.html?mode=embed`)));
  await sleep(800);
  const winsBefore = (await list()).filter((t) => t.url.includes("mode=window")).length;
  await page.ev(`window.__keys = []; for (const t of ["keydown", "keypress", "keyup", "input", "beforeinput", "paste", "compositionupdate"]) { addEventListener(t, (e) => __keys.push(t + ":" + (e.key || e.data || "")), true); document.addEventListener(t, (e) => __keys.push("doc-" + t), true); } 1`);
  await typeInto(page, "salah-inline");
  await sleep(1000);
  ok("password salah di kotak inline tidak membuka", (await covered(page)).host === true);
  ok("pengintai di halaman TIDAK melihat satu ketikan pun (aman dari keylogger situs)", (await page.ev("JSON.stringify(window.__keys)")) === "[]", await page.ev("JSON.stringify(window.__keys)"));
  await typeInto(page, "rahasia-satu-1");
  c = await until(async () => { const r = await covered(page); return !r.host ? r : null; }, 8000);
  ok("password benar diketik langsung di halaman membuka tab", !!c && c.vis === "visible" && c.title === "Halaman Uji", JSON.stringify(c));
  ok("pengintai tetap tidak melihat ketikan password benar", (await page.ev("JSON.stringify(window.__keys)")) === "[]", await page.ev("JSON.stringify(window.__keys)"));
  ok("tidak ada jendela popup yang dibuka untuk memasukkan password", (await list()).filter((t) => t.url.includes("mode=window")).length === winsBefore);
  // kunci lagi untuk langkah berikutnya
  await ext(extId, { type: "lockNow" });
  await until(async () => (await covered(page)).host);
  // situs dengan CSP frame-src 'none': iframe ekstensi yang dipasang skrip konten TIDAK diblokir (terukur di Chrome 155)
  const cspT = await openTab(`http://127.0.0.1:${SITE}/csp`);
  const csp = await conn(cspT.webSocketDebuggerUrl);
  const fb = await until(async () => ((await blMode(csp)) === "inline" ? "inline" : null), 9000);
  ok("situs ber-CSP frame-src 'none' tetap memuat kotak password inline", fb === "inline", String(await blMode(csp)));
  ok("halaman CSP tetap tertutup", (await covered(csp)).vis === "hidden");
  csp.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${cspT.id}`).catch(() => {});
  // 'Lupa password?' dari layar kunci membuka jendela pemulihan
  await ext(extId, { type: "openLockWindow", recover: true });
  const recWin = await target((t) => t.url.includes("mode=window") && t.url.includes("recover=1"));
  ok("tombol lupa password membuka jendela dengan form pemulihan", !!recWin);
  if (recWin) { const rw = await conn(recWin.webSocketDebuggerUrl); ok("form pemulihan langsung terbuka", !!(await until(async () => visible(rw, "#recoverForm")))); rw.close(); }
  await fetch(`http://127.0.0.1:${PORT}/json/close/${recWin?.id}`).catch(() => {});

  // ---- 6. tab chrome:// tidak bisa ditutup overlay: dialihkan ke halaman kunci ----
  const ntp = await openTab("chrome://newtab");
  const ntpLock = await target((t) => t.id === ntp.id && t.url.includes(`${extId}/lock.html`));
  ok("tab chrome://newtab dialihkan ke halaman kunci", !!ntpLock, (await list()).map((t) => t.url).join(" | "));

  // ---- 7. password salah, lalu benar ----
  const lockT = ntpLock || await target((t) => t.url.includes(`${extId}/lock.html`));
  const lock = await conn(lockT.webSocketDebuggerUrl);
  await fill(lock, "#pw", "salah-total"); await submit(lock, "#unlockForm");
  const m1 = await until(async () => { const t = await text(lock, "#msg"); return /salah/i.test(t) ? t : null; });
  ok("password salah ditolak dengan pesan sisa percobaan", /Password salah/.test(m1 || "") && /4 percobaan/.test(m1 || ""), m1);
  ok("halaman tetap tertutup setelah password salah", (await covered(page)).host === true);
  await fill(lock, "#pw", "rahasia-satu-1"); await submit(lock, "#unlockForm");
  c = await until(async () => { const r = await covered(page); return !r.host ? r : null; });
  ok("password benar membuka halaman (overlay hilang, judul kembali)", !!c && c.vis === "visible" && c.title === "Halaman Uji", JSON.stringify(c));
  const back = await until(async () => (await list()).find((t) => t.id === ntp.id && !t.url.includes("lock.html")));
  ok("tab chrome://newtab dikembalikan setelah unlock", !!back, back?.url);
  ok("tab layar kunci lama tertutup setelah unlock", !!(await noLockTabs()));

  // ---- 7b. catatan percobaan gagal + lencana ----
  const swc = await conn(sw.webSocketDebuggerUrl);
  const badge = () => swc.ev("chrome.action.getBadgeText({})");
  let att = await ext(extId, { type: "getAttempts" });
  ok("dua percobaan salah tercatat (jenis password, belum dilihat)", att.log.length === 2 && att.log.every((e) => e.k === "password") && att.unseen === 2, JSON.stringify(att));
  ok("lencana ikon menampilkan jumlah percobaan gagal", (await badge()) === "2", String(await badge()));
  await ext(extId, { type: "markSeen" });
  ok("lencana hilang setelah ditandai dilihat, catatan tetap ada", (await badge()) === "" && (await ext(extId, { type: "getAttempts" })).log.length === 2);

  // ---- 7c. kunci per situs ----
  await ext(extId, { type: "setSettings", patch: { siteLocks: [{ host: "127.0.0.1", minutes: 15 }] } });
  c = await until(async () => { const r = await covered(page); return r.host ? r : null; });
  ok("situs yang diatur kunci per situs tertutup walau browser terbuka", !!c && c.vis === "hidden", JSON.stringify(c));
  const otherT = await openTab(`http://localhost:${SITE}/`);
  const other = await conn(otherT.webSocketDebuggerUrl); await sleep(1200);
  ok("situs lain (bukan di daftar) tidak ikut tertutup", !(await covered(other)).host);
  const sBad = await ext(extId, { type: "unlock", password: "salah-situs", site: "127.0.0.1" });
  ok("password salah tidak membuka situs", sBad.ok === false && (await covered(page)).host === true);
  const sOk = await ext(extId, { type: "unlock", password: "rahasia-satu-1", site: "127.0.0.1" });
  c = await until(async () => { const r = await covered(page); return !r.host ? r : null; });
  ok("password benar membuka situs itu saja", sOk.ok === true && !!c && c.vis === "visible", JSON.stringify(sOk));
  const st2 = await ext(extId, { type: "getState" });
  ok("browser sendiri tetap terbuka (bukan terkunci total)", st2.locked === false);
  await ext(extId, { type: "setSettings", patch: { siteLocks: [] } });
  other.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${otherT.id}`).catch(() => {});

  // ---- 7c2. kunci SATU tab: tab lain tidak ikut terkunci ----
  const tabOtherT = await openTab(`http://localhost:${SITE}/`);
  const tabOther = await conn(tabOtherT.webSocketDebuggerUrl); await sleep(1200);
  const idA = await chromeTabId(extId, `http://127.0.0.1:${SITE}/*`);
  ok("id tab ditemukan", Number.isInteger(idA), String(idA));
  const lockRes = await ext(extId, { type: "lockTab", tabId: idA });
  c = await until(async () => { const r = await covered(page); return r.host ? r : null; });
  ok("kunci tab: tab itu tertutup dan isinya disembunyikan", lockRes.ok === true && !!c && c.vis === "hidden", JSON.stringify([lockRes, c]));
  ok("kunci tab: tab LAIN tidak ikut terkunci", !(await covered(tabOther)).host && (await covered(tabOther)).vis === "visible");
  ok("kunci tab: browser sendiri tetap terbuka", (await ext(extId, { type: "getState" })).locked === false);
  const tBad = await ext(extId, { type: "unlock", password: "salah-tab", tab: idA });
  ok("kunci tab: password salah tidak membuka", tBad.ok === false && (await covered(page)).host === true);
  await ext(extId, { type: "unlock", password: "rahasia-satu-1", tab: idA });
  c = await until(async () => { const r = await covered(page); return !r.host ? r : null; });
  ok("kunci tab: password benar membuka tab itu saja", !!c && c.vis === "visible" && !(await covered(tabOther)).host, JSON.stringify(c));
  // password diketik langsung di tab yang dikunci sendiri: hanya tab itu yang terbuka
  await ext(extId, { type: "lockTab", tabId: idA });
  await until(async () => (await covered(page)).host);
  await until(async () => ((await blMode(page)) === "inline" ? 1 : null), 8000); await sleep(800);
  await typeInto(page, "rahasia-satu-1");
  c = await until(async () => { const r = await covered(page); return !r.host ? r : null; }, 8000);
  ok("kunci tab: password diketik langsung di tab membuka tab itu", !!c && c.vis === "visible" && !(await covered(tabOther)).host, JSON.stringify(c));
  // password diketik langsung untuk situs yang dikunci per situs
  await ext(extId, { type: "setSettings", patch: { siteLocks: [{ host: "127.0.0.1", minutes: 15 }] } });
  await until(async () => (await covered(page)).host);
  await until(async () => ((await blMode(page)) === "inline" ? 1 : null), 8000); await sleep(800);
  await typeInto(page, "rahasia-satu-1");
  c = await until(async () => { const r = await covered(page); return !r.host ? r : null; }, 8000);
  ok("kunci per situs: password diketik langsung di halaman membuka situs itu", !!c && c.vis === "visible", JSON.stringify(c));
  if (!c) console.log("  [diagnosa situs] mode:", await blMode(page), "| session:", await swc.ev("chrome.storage.session.get(null).then((s) => JSON.stringify({ lockedTabs: s.lockedTabs, lockedLinks: s.lockedLinks, siteOk: s.siteOk, unlocked: s.unlocked }))"), "| attempts:", JSON.stringify(await ext(extId, { type: "getAttempts" })));
  await ext(extId, { type: "setSettings", patch: { siteLocks: [] } });
  // kunci tab lalu kunci semua lalu buka browser: kunci tab ikut dilepas
  await ext(extId, { type: "lockTab", tabId: idA });
  await until(async () => (await covered(page)).host);
  await ext(extId, { type: "lockNow" });
  await until(async () => (await covered(tabOther)).host);
  await ext(extId, { type: "unlock", password: "rahasia-satu-1" });
  c = await until(async () => { const r = await covered(page); return !r.host && !(await covered(tabOther)).host ? r : null; });
  ok("membuka kunci browser juga melepas kunci per tab", !!c);
  // kunci tab menempel ke LINK: tab ditutup lalu link yang sama dibuka lagi => tetap terkunci
  const linkUrl = `http://127.0.0.1:${SITE}/rahasia?x=1`;
  const lkT = await openTab(linkUrl); const lk = await conn(lkT.webSocketDebuggerUrl); await sleep(1200);
  const idL = await chromeTabId(extId, `http://127.0.0.1:${SITE}/rahasia*`);
  await ext(extId, { type: "lockTab", tabId: idL });
  await until(async () => (await covered(lk)).host);
  lk.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${lkT.id}`).catch(() => {});   // tab dikunci lalu DITUTUP
  await sleep(600);
  const reT = await openTab(linkUrl); const re = await conn(reT.webSocketDebuggerUrl);
  c = await until(async () => { const r = await covered(re); return r.host ? r : null; });
  ok("link yang sama dibuka lagi setelah tab terkunci ditutup => tetap terkunci", !!c && c.vis === "hidden", JSON.stringify(c));
  const diffT = await openTab(`http://127.0.0.1:${SITE}/rahasia-lain`); const diff = await conn(diffT.webSocketDebuggerUrl); await sleep(1200);
  ok("halaman lain di situs yang sama (satu aplikasi) ikut terkunci", !!(await until(async () => (await covered(diff)).host)));
  const withHashT = await openTab(`${linkUrl}#bagian`); const withHash = await conn(withHashT.webSocketDebuggerUrl);
  ok("link yang sama dengan #fragment berbeda tetap terkunci", !!(await until(async () => (await covered(withHash)).host ? true : null)));
  const idRe = await chromeTabId(extId, `http://127.0.0.1:${SITE}/rahasia?x=1`);
  await ext(extId, { type: "unlock", password: "rahasia-satu-1", tab: idRe });
  c = await until(async () => { const r = await covered(re); return !r.host ? r : null; });
  ok("membuka tab itu dengan password melepas kunci link", !!c && c.vis === "visible", JSON.stringify(c));
  const again = await openTab(linkUrl); const ag = await conn(again.webSocketDebuggerUrl); await sleep(1200);
  ok("setelah dibuka, link yang sama tidak terkunci lagi", !(await covered(ag)).host);
  for (const x of [re, diff, withHash, ag]) x.close();
  for (const x of [reT, diffT, withHashT, again]) await fetch(`http://127.0.0.1:${PORT}/json/close/${x.id}`).catch(() => {});

  // tab chrome:// yang dikunci sendirian dialihkan ke layar kunci, tab lain tetap terbuka
  const ntp2 = await openTab("chrome://version"); await sleep(1500);   // halaman chrome:// yang unik, supaya jelas tab mana yang dikunci
  const idN = await chromeTabId(extId, "chrome://version/*");
  await ext(extId, { type: "lockTab", tabId: idN });
  const ntpLocked = await target((t) => t.id === ntp2.id && t.url.includes("lock.html") && t.url.includes(`tab=${idN}`));
  ok("kunci tab untuk halaman chrome:// dialihkan ke layar kunci khusus tab itu", !!ntpLocked, (await list()).map((t) => t.url).join(" | "));
  ok("tab lain tetap terbuka saat tab chrome:// dikunci", !(await covered(page)).host);
  await ext(extId, { type: "unlock", password: "rahasia-satu-1", tab: idN });
  const ntpBack = await until(async () => (await list()).find((t) => t.id === ntp2.id && !t.url.includes("lock.html")));
  ok("tab chrome:// kembali ke halaman asalnya setelah dibuka", !!ntpBack && /chrome:\/\/version/.test(ntpBack.url), ntpBack?.url);
  tabOther.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${tabOtherT.id}`).catch(() => {});
  await fetch(`http://127.0.0.1:${PORT}/json/close/${ntp2.id}`).catch(() => {});

  // ---- 7d. Touch ID (autentikator virtual milik Chrome) ----
  const boT = await openTab(`chrome-extension://${extId}/options.html`);
  const bo = await conn(boT.webSocketDebuggerUrl);
  await bo.send("WebAuthn.enable");
  await bo.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await bo.send("Page.reload");   // deteksi dukungan Touch ID berjalan saat halaman dimuat, jadi muat ulang setelah autentikator ada
  await sleep(800);
  await until(async () => (await visible(bo, "#main")) && (await text(bo, "#bioMsg")));
  ok("tombol Touch ID aktif saat perangkat mendukung", (await bo.ev("document.getElementById('bioEnable').disabled")) === false);
  await bo.send("Page.bringToFront");     // WebAuthn butuh halaman yang sedang fokus
  await bo.ev("document.getElementById('bioEnable').click()");
  const bioOn = await until(async () => bo.ev("chrome.runtime.sendMessage({type:'getState'}).then((s) => s.bio)"), 10000);   // tanpa membuka tab lain (fokus)
  ok("Touch ID berhasil didaftarkan", !!bioOn);
  await bo.ev("chrome.runtime.sendMessage({type:'lockNow'})");        // halaman ini sendiri dialihkan ke layar kunci
  await until(async () => (await bo.ev("location.href")).includes("lock.html"));
  ok("tombol 'Buka dengan Touch ID' muncul di layar kunci", !!(await until(async () => bo.ev("!document.getElementById('bio').classList.contains('hidden')"))));
  await bo.send("Page.bringToFront");
  await bo.ev("document.getElementById('bio').click()");
  c = await until(async () => { const r = await covered(page); return !r.host ? r : null; }, 10000);
  ok("sidik jari yang sah membuka kunci", !!c && c.vis === "visible", JSON.stringify(c));
  att = await ext(extId, { type: "getAttempts" });
  const before = att.log.length;
  await ext(extId, { type: "lockNow" });
  await until(async () => (await covered(page)).host);
  const ch1 = await ext(extId, { type: "bioChallenge" });
  const bad = await ext(extId, { type: "bioUnlock", credId: ch1.credId, assertion: { authenticatorData: "AAAA", clientDataJSON: "AAAA", signature: "AAAA" } });
  ok("assertion palsu DITOLAK dan tetap terkunci", bad.ok === false && (await covered(page)).host === true, JSON.stringify(bad));
  const bad2 = await ext(extId, { type: "bioUnlock", credId: ch1.credId, assertion: { authenticatorData: "AAAA", clientDataJSON: "AAAA", signature: "AAAA" } });
  ok("tantangan sekali pakai: percobaan kedua tanpa tantangan baru ditolak", bad2.ok === false);
  await ext(extId, { type: "unlock", password: "rahasia-satu-1" });
  const after = { ok: (await ext(extId, { type: "getState" })).locked === false };   // balasan unlock bisa hilang karena tab perantara dikembalikan, jadi cek status
  att = await ext(extId, { type: "getAttempts" });
  ok("percobaan Touch ID palsu tercatat sebagai 'biometric'", after.ok && att.log.length >= before + 2 && att.log.at(-1).k === "biometric", JSON.stringify(att.log.slice(-3)));
  await ext(extId, { type: "bioRemove" });
  ok("Touch ID bisa dimatikan", (await ext(extId, { type: "getState" })).bio === false);
  bo.close(); await fetch(`http://127.0.0.1:${PORT}/json/close/${boT.id}`).catch(() => {});
  await ext(extId, { type: "clearLog" });

  // ---- 7e. tombol panik ----
  await ext(extId, { type: "panic" });
  c = await until(async () => { const r = await covered(page); return r.host ? r : null; });
  ok("tombol panik langsung mengunci semua tab", !!c && c.vis === "hidden", JSON.stringify(c));
  // ---- 7f. service worker dimatikan paksa: status kunci tidak boleh hilang (harus tersimpan, bukan di memori) ----
  swc.close();
  const swT = (await list()).find((t) => t.type === "service_worker" && t.url.includes(extId));
  await fetch(`http://127.0.0.1:${PORT}/json/close/${swT.id}`).catch(() => {});
  await sleep(1500);
  ok("service worker benar-benar mati sebelum diuji", !(await list()).some((t) => t.id === swT.id));
  ok("setelah service worker mati lalu bangun, browser tetap terkunci", (await ext(extId, { type: "getState" })).locked === true);
  ok("halaman tetap tertutup setelah service worker mati", (await covered(page)).host === true);
  const wrongAfterKill = await ext(extId, { type: "unlock", password: "salah-setelah-mati" });
  ok("password salah tetap ditolak setelah service worker bangun", wrongAfterKill.ok === false);
  await ext(extId, { type: "unlock", password: "rahasia-satu-1" });
  await until(async () => !(await covered(page)).host);
  ok("password benar membuka setelah service worker bangun", !(await covered(page)).host);

  // ---- 8. lupa password: pemulihan ----
  await ext(extId, { type: "lockNow" });
  await until(async () => (await covered(page)).host);
  const lt = await target((t) => t.url.includes(`${extId}/lock.html`));
  const l2 = await conn(lt.webSocketDebuggerUrl);
  await l2.ev("document.getElementById('forgot').click()");
  await fill(l2, "#rcode", "AAAA-AAAA-AAAA-AAAA-AAAA"); await fill(l2, "#np1", "password-baru-77"); await fill(l2, "#np2", "password-baru-77"); await submit(l2, "#recoverForm");
  ok("kode pemulihan salah ditolak", /Kode pemulihan salah/.test((await until(async () => { const t = await text(l2, "#rmsg"); return /salah/.test(t) ? t : null; })) || ""));
  await fill(l2, "#rcode", code.toLowerCase()); await submit(l2, "#recoverForm");
  const code2 = await until(async () => { const t = await text(l2, "#codeText"); return /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/.test(t) ? t : null; });
  ok("pemulihan berhasil dan kode baru tampil, berbeda dari yang lama", !!code2 && code2 !== code, String(code2));
  if (!code2) console.log("  [diagnosa] teks halaman:", JSON.stringify((await l2.ev("document.body.innerText")) || "").slice(0, 400), "| url:", await l2.ev("location.href"), "| targets:", (await list()).filter((t) => t.type === "page").map((t) => t.url.slice(0, 70)).join(" ; "));
  ok("layar kunci TIDAK tertutup sebelum kode baru dibaca", (await list()).some((t) => t.url.includes("lock.html")));
  ok("halaman sudah terbuka setelah pemulihan", !(await covered(page)).host);
  await l2.ev("document.getElementById('done').click()");
  await noLockTabs();
  await ext(extId, { type: "lockNow" });
  await until(async () => (await covered(page)).host);
  await ext(extId, { type: "openLockWindow" });      // tidak ada tab ekstensi yang tersisa, jadi minta jendela kunci
  const lt2 = await target((t) => t.url.includes(`${extId}/lock.html?mode=window`) && !t.url.includes("recover=1"));
  const l3 = await conn(lt2.webSocketDebuggerUrl);
  await fill(l3, "#pw", "rahasia-satu-1"); await submit(l3, "#unlockForm");
  ok("password lama tidak berlaku lagi setelah pemulihan", /salah/i.test((await until(async () => { const t = await text(l3, "#msg"); return /salah/i.test(t) ? t : null; })) || ""));

  // ---- 9. batas percobaan: 5 salah => ditunda; yang benar pun ditolak selama ditunda ----
  for (let i = 0; i < 4; i++) { await fill(l3, "#pw", "salah-" + i); await submit(l3, "#unlockForm"); await sleep(450); }
  const thr = await until(async () => { const t = await text(l3, "#msg"); return /Terlalu banyak/.test(t) ? t : null; });
  ok("setelah 5 salah muncul hitung mundur", /Terlalu banyak percobaan.*0:/.test(thr || ""), thr);
  ok("kolom password dimatikan selama ditunda", await l3.ev("document.getElementById('pw').disabled"));
  const direct = await send(l3, { type: "unlock", password: "password-baru-77" });
  ok("password BENAR pun ditolak selama ditunda (anti brute-force)", direct.ok === false && direct.throttled === true, JSON.stringify(direct));

  // ---- 10. Chrome ditutup lalu dibuka lagi: selalu terkunci, jendela kunci terbuka otomatis ----
  [l3, lock, l2, opt, page].forEach((x) => { try { x.close(); } catch {} });
  await stop();
  await sleep(31_000);   // tunggu penundaan 30 dtk habis
  launch();
  const sw2 = await ready();
  ok("ekstensi hidup lagi setelah Chrome dibuka ulang", !!sw2);
  const win = await target((t) => t.url.includes(`${extId}/lock.html?mode=window`), 15000);
  ok("jendela kunci terbuka otomatis saat Chrome dibuka", !!win, (await list()).map((t) => t.url).join(" | "));
  if (win) {
    const w = await conn(win.webSocketDebuggerUrl);
    const gs = await send(w, { type: "getState" });
    ok("status setelah restart: terkunci (sesi tidak bertahan)", gs.hasPassword && gs.locked, JSON.stringify(gs));
    await fill(w, "#pw", "password-baru-77"); await submit(w, "#unlockForm");
    const gone = await until(async () => !(await list()).some((t) => t.url.includes("lock.html?mode=window")), 8000);
    ok("jendela kunci menutup sendiri setelah password benar", !!gone);
  }
  await stop();
}

// ---- varian: iframe tidak bisa dimuat (tanpa web_accessible_resources) => kembali ke tombol cadangan ----
async function fallbackVariant() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bl-nowar-"));
  fs.cpSync(EXT, dir, { recursive: true, filter: (p) => !/[\\/](tests|\.git|tools|store)([\\/]|$)|\.zip$/.test(p) });
  const mf = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")); delete mf.web_accessible_resources;
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(mf));
  const prof2 = fs.mkdtempSync(path.join(os.tmpdir(), "bl-nowar-prof-"));
  chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof2}`, "--no-first-run", "--no-default-browser-check", `--load-extension=${dir}`, "about:blank"], { stdio: "ignore" });
  const sw = await ready();
  ok("[varian tanpa iframe] ekstensi termuat", !!sw);
  const extId = new URL(sw.url).host;
  const optT = await target((t) => t.url.includes(`${extId}/options.html`));
  const o = await conn(optT.webSocketDebuggerUrl);
  await o.ev(`chrome.runtime.sendMessage({ type: "setInitialPassword", password: "rahasia-satu-1" })`);
  const pT = await openTab(`http://127.0.0.1:${SITE}/`); const p = await conn(pT.webSocketDebuggerUrl); await sleep(1000);
  await o.ev(`chrome.runtime.sendMessage({ type: "lockNow" })`);
  const m = await until(async () => ((await blMode(p)) === "fallback" ? "fallback" : null), 10000);
  ok("[varian tanpa iframe] iframe tidak bisa dimuat => kartu cadangan dengan tombol", m === "fallback", String(await blMode(p)));
  ok("[varian tanpa iframe] halaman tetap tertutup dan tersembunyi", (await covered(p)).vis === "hidden");
  await stop(); fs.rmSync(dir, { recursive: true, force: true });
}

try { await main(); await fallbackVariant(); } catch (e) { fail++; console.log("FAIL (exception)", e.stack || e); }
await stop(); site.close(); fs.rmSync(profile, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
