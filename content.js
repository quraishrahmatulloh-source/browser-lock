// Skrip konten Browser Lock: saat terkunci, isi halaman DISEMBUNYIKAN (bukan cuma ditutup) dan diberi layar kunci.
// Password TIDAK diketik di halaman ini (skrip situs bisa mengintip). Tombolnya membuka jendela milik ekstensi.
(() => {
  if (window.top !== window) return;               // frame lain ikut tersembunyi bersama halaman utamanya
  if (window.__browserLockLoaded) return;
  window.__browserLockLoaded = true;

  const HIDE_ID = "__browser_lock_hide";
  const HOST_ATTR = "data-browser-lock";
  let locked = false, host = null, observer = null, savedTitle = null, bodyWasInert = null;

  // 1) segera sembunyikan halaman sampai status diketahui, supaya tidak ada kilatan isi halaman
  const hider = document.createElement("style");
  hider.id = HIDE_ID;
  hider.textContent = `html{visibility:hidden !important}html>[${HOST_ATTR}]{visibility:visible !important}`;
  (document.documentElement || document).appendChild(hider);

  const PIXEL_LOCK = [
    "................", ".....######.....", "....#mmmmmm#....", "...#mm####mm#...", "...#m#....#m#...", "...#m#....#m#...",
    "...#m#....#m#...", ".##############.", ".#oooooooooooo#.", ".#oooooooooooo#.", ".#ooooo##ooooo#.", ".#oooo####oooo#.",
    ".#ooooo##ooooo#.", ".#ooooo##ooooo#.", ".#oooooooooooo#.", ".##############.",
  ];
  const COLORS = { "#": "#111", o: "#ffd23f", m: "#cfcfdd" };

  function lockSvg() {
    const rects = [];
    PIXEL_LOCK.forEach((row, y) => [...row].forEach((c, x) => { if (COLORS[c]) rects.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${COLORS[c]}"/>`); }));
    return `<svg viewBox="0 0 16 16" width="112" height="112" shape-rendering="crispEdges" aria-hidden="true">${rects.join("")}</svg>`;
  }

  function build() {
    const el = document.createElement("div");
    el.setAttribute(HOST_ATTR, "");
    const root = el.attachShadow({ mode: "closed" });   // halaman web tidak bisa membaca isi layar kunci
    root.innerHTML = `
      <style>
        :host{all:initial}
        .wrap{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;
          background:#fff8ec radial-gradient(#eadfc8 1.4px,transparent 1.5px) 0 0/22px 22px;
          font-family:ui-rounded,"SF Pro Rounded",system-ui,-apple-system,"Segoe UI",sans-serif;color:#111}
        .col{display:grid;justify-items:center;gap:22px}
        .clock{display:grid;justify-items:center;gap:2px;text-align:center}
        .time{font:800 64px/1 ui-monospace,"SF Mono",Menlo,monospace;letter-spacing:-.02em}
        .date{color:#555;font-size:15px;font-weight:600}
        .card{display:grid;justify-items:center;gap:14px;padding:34px 38px;max-width:min(420px,90vw);text-align:center;
          background:#fff;border:3px solid #111;border-radius:22px;box-shadow:7px 7px 0 #111;animation:rise .32s cubic-bezier(.2,.9,.3,1.15) both}
        .card svg{animation:bob 2.4s steps(4) infinite}
        @keyframes rise{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
        @keyframes bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @media (prefers-reduced-motion:reduce){.card,.card svg{animation:none}}
        h1{margin:0;font-size:26px;letter-spacing:-.01em}
        p{margin:0;color:#555;font-size:15px;line-height:1.4}
        button{margin-top:6px;padding:13px 26px;font:700 16px/1 inherit;font-family:inherit;color:#111;cursor:pointer;
          background:#ffd23f;border:3px solid #111;border-radius:14px;box-shadow:4px 4px 0 #111;transition:transform .08s,box-shadow .08s}
        button:hover{transform:translate(-1px,-1px);box-shadow:5px 5px 0 #111}
        button:active{transform:translate(3px,3px);box-shadow:none}
        button:focus-visible{outline:3px solid #5b8def;outline-offset:3px}
        small{color:#777;font-size:12.5px}
        @media (prefers-color-scheme:dark){
          .wrap{background:#1c1b24 radial-gradient(#2b2a36 1.4px,transparent 1.5px) 0 0/22px 22px;color:#f6efe2}
          .card{background:#2a2834;border-color:#000;box-shadow:7px 7px 0 #000}p,small{color:#b5adc4}
        }
      </style>
      <div class="wrap" role="dialog" aria-modal="true" aria-label="Browser terkunci">
       <div class="col">
        <div class="clock"><div class="time" id="time"></div><div class="date" id="date"></div></div>
        <div class="card">
          ${lockSvg()}
          <h1>Browser terkunci</h1>
          <p>Masukkan password untuk membuka semua tab.</p>
          <button type="button" id="open">Masukkan password</button>
          <small>Atau klik ikon gembok di toolbar Chrome.</small>
        </div>
       </div>
      </div>`;
    const tick = () => {
      const d = new Date();
      root.getElementById("time").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      root.getElementById("date").textContent = d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    };
    tick(); el.__clock = setInterval(tick, 10_000);
    const btn = root.getElementById("open");
    const ask = () => { try { chrome.runtime.sendMessage({ type: "openLockWindow" }); } catch { /* ekstensi sedang dimuat ulang */ } };
    btn.addEventListener("click", ask);
    root.addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
    setTimeout(() => btn.focus(), 0);
    return el;
  }

  function ensureHost() {
    if (!host) host = build();
    if (!host.isConnected) (document.documentElement || document).appendChild(host);
    if (document.body && bodyWasInert === null) { bodyWasInert = document.body.inert; document.body.inert = true; }   // tidak bisa difokus lewat Tab
  }

  function show() {
    locked = true;
    if (!document.getElementById(HIDE_ID)) (document.documentElement || document).appendChild(hider);
    ensureHost();
    if (savedTitle === null) { savedTitle = document.title; }
    document.title = "🔒 Terkunci";
    document.querySelectorAll("video,audio").forEach((m) => { try { m.pause(); } catch { /* abaikan */ } });
    if (!observer) {
      observer = new MutationObserver(() => { if (locked) ensureHost(); });   // dipasang lagi kalau dihapus
      observer.observe(document, { childList: true, subtree: false });
      observer.observe(document.documentElement, { childList: true });
    }
  }

  function hide() {
    locked = false;
    if (observer) { observer.disconnect(); observer = null; }
    if (host) { clearInterval(host.__clock); host.remove(); host = null; }
    hider.remove();
    if (document.body && bodyWasInert !== null) document.body.inert = bodyWasInert;
    bodyWasInert = null;
    if (savedTitle !== null) { document.title = savedTitle; savedTitle = null; }
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg?.type === "lock") { show(); reply({ ok: true }); }
    else if (msg?.type === "unlock") { hide(); reply({ ok: true }); }
    return false;
  });

  // 2) tanya status. Gagal sementara (service worker bangun) => coba lagi; menyerah setelah ~3 dtk supaya situs tidak rusak permanen.
  async function init(attempt = 0) {
    try {
      const st = await chrome.runtime.sendMessage({ type: "getState" });
      if (st && st.locked) show(); else hide();
    } catch {
      if (attempt < 10) setTimeout(() => init(attempt + 1), 300); else hide();
    }
  }
  init();
})();
