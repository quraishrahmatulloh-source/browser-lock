// Kunci per situs: situs tertentu minta password lagi walau browser sedang terbuka. Logika murni (bisa dites di Node).
export const SITE_MINUTES = [0, 5, 15, 30, 60];   // 0 = sampai Chrome ditutup
export const MAX_RULES = 50;

/** "https://www.Mail.Google.com/inbox?x=1" -> "mail.google.com". Tidak valid -> null. */
export function normalizeHost(input) {
  let s = String(input ?? "").trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").split(/[/?#]/)[0].replace(/^[^@]*@/, "").replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  if (s.length > 253 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(s)) return null;
  return s;
}

/** Rapikan daftar aturan: host valid, menit valid, tanpa duplikat, maksimal MAX_RULES. */
export function sanitizeRules(rules) {
  const seen = new Set(), out = [];
  for (const r of Array.isArray(rules) ? rules : []) {
    const host = normalizeHost(r?.host);
    const minutes = SITE_MINUTES.includes(r?.minutes) ? r.minutes : 15;
    if (host && !seen.has(host) && out.length < MAX_RULES) { seen.add(host); out.push({ host, minutes }); }
  }
  return out;
}

/** Aturan yang cocok dengan URL (domain sama atau subdomainnya), hanya http(s). */
export function matchRule(url, rules) {
  let host;
  try { const u = new URL(url); if (u.protocol !== "http:" && u.protocol !== "https:") return null; host = u.hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; }
  return (rules || []).find((r) => host === r.host || host.endsWith("." + r.host)) || null;
}

/**
 * siteOk: { host: expiryTimestamp | null }. undefined = belum dibuka, null = terbuka sampai Chrome ditutup.
 * Mengembalikan aturan yang mengunci URL ini sekarang, atau null kalau tidak terkunci.
 */
export function isSiteLocked(url, rules, siteOk, now = Date.now()) {
  const rule = matchRule(url, rules);
  if (!rule) return null;
  const e = siteOk ? siteOk[rule.host] : undefined;
  if (e === undefined) return rule;
  if (e === null) return null;
  return e > now ? null : rule;
}

export const expiryFor = (rule, now = Date.now()) => (rule.minutes === 0 ? null : now + rule.minutes * 60_000);
