// Meter kekuatan password (4 blok pixel). Hanya petunjuk visual, aturan resminya ada di lib/auth.js.
export function score(p) {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if ((/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) || p.length >= 16) s++;
  if (/^(.)\1+$/.test(p) || p.length < 8) s = Math.min(s, 1);
  return s;
}
const LABELS = ["", "Weak", "Okay", "Good", "Strong"];

/** Pasang meter di bawah input. Mengembalikan elemen meter. */
export function attachMeter(input) {
  const wrap = document.createElement("div");
  wrap.className = "meter"; wrap.setAttribute("aria-live", "polite");
  wrap.innerHTML = '<span class="bars"><i></i><i></i><i></i><i></i></span><span class="lbl"></span>';
  (input.closest(".pw") || input).insertAdjacentElement("afterend", wrap);
  const update = () => {
    const n = score(input.value);
    wrap.dataset.level = String(n);
    wrap.querySelectorAll("i").forEach((b, i) => b.classList.toggle("on", i < n));
    wrap.querySelector(".lbl").textContent = input.value ? LABELS[n] : "";
  };
  input.addEventListener("input", update); update();
  return wrap;
}
