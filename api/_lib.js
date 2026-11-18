// Ortak yardımcılar: veritabanı bağlantısı ve doluluk hesaplama.
// Bu dosya doğrudan bir uç nokta değil; alt çizgiyle başladığı için Vercel
// bunu ayrı bir fonksiyon olarak yayınlamaz, sadece diğerleri içeri alır.

const { Pool } = require("pg");
const crypto = require("crypto");

// ---------------------------------------------------------------- sabitler
// Bu değerler ön yüzdeki değerlerle aynı olmalı (public/index.html).
const WINDOW_MINUTES = 30;      // bu süreden eski bildirim sayılmaz
const HALF_LIFE_MS = 10 * 60 * 1000;  // ağırlık yarılanma süresi
const COOLDOWN_MINUTES = 10;    // aynı cihaz, aynı hat+yön bekleme süresi
const OUTLIER_SPREAD = 30;      // medyandan bu kadar sapan bildirim atılır
const LEVEL_LOW_MAX = 40;
const LEVEL_MED_MAX = 75;

// Sunucusuz ortamda her çağrı yeni bir süreç açabilir. Havuzu global'de
// tutarsak aynı süreç tekrar kullanıldığında bağlantı yeniden açılmaz.
let pool = global.__otobusumPool;
if (!pool) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
  });
  global.__otobusumPool = pool;
}

function levelFor(percent) {
  if (percent <= LEVEL_LOW_MAX) return "LOW";
  if (percent <= LEVEL_MED_MAX) return "MEDIUM";
  return "HIGH";
}

function confidenceFor(count) {
  if (count >= 6) return "HIGH";
  if (count >= 3) return "MEDIUM";
  if (count >= 1) return "LOW";
  return "NONE";
}

function median(nums) {
  const s = nums.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Bir hat+yön için bildirim listesinden doluluk özeti üretir.
// rows: [{ percent, created_at }]
function summarize(rows, now) {
  if (!rows.length) {
    return { percent: null, level: "NONE", count: 0, confidence: "NONE", lastAt: null };
  }

  // Aykırı değer temizliği: yeterli bildirim varsa medyandan çok sapanlar atılır.
  let used = rows;
  if (rows.length >= 4) {
    const med = median(rows.map((r) => r.percent));
    const kept = rows.filter((r) => Math.abs(r.percent - med) <= OUTLIER_SPREAD);
    if (kept.length >= 3) used = kept;
  }

  // Zamana göre azalan ağırlıklı ortalama: yeni bildirim baskın olur.
  let wsum = 0;
  let vsum = 0;
  for (const r of used) {
    const age = now - new Date(r.created_at).getTime();
    const w = Math.pow(0.5, age / HALF_LIFE_MS);
    wsum += w;
    vsum += w * r.percent;
  }

  let lastAt = 0;
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (t > lastAt) lastAt = t;
  }

  const percent = Math.round(vsum / wsum);
  return {
    percent,
    level: levelFor(percent),
    count: rows.length,
    confidence: confidenceFor(rows.length),
    lastAt,
  };
}

// IP adresi saklanmaz; gizli bir tuzla karması alınır.
function hashIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  const ip = (Array.isArray(fwd) ? fwd[0] : fwd || "").split(",")[0].trim();
  if (!ip) return null;
  const salt = process.env.IP_SALT || "otobusum";
  return crypto.createHash("sha256").update(salt + ip).digest("hex").slice(0, 32);
}

function sendJson(res, status, body, cacheSeconds) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (cacheSeconds) {
    res.setHeader("Cache-Control", `public, max-age=0, s-maxage=${cacheSeconds}, stale-while-revalidate=60`);
  } else {
    res.setHeader("Cache-Control", "no-store");
  }
  res.end(JSON.stringify(body));
}

module.exports = {
  pool,
  summarize,
  levelFor,
  confidenceFor,
  hashIp,
  sendJson,
  WINDOW_MINUTES,
  COOLDOWN_MINUTES,
};
