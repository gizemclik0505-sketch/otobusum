// GET /api/occupancy
//
// Son 30 dakikadaki tüm bildirimleri çeker ve her (hat, yön) için doluluk
// özetini döndürür. Ön yüz listeyi ve detay ekranını bununla doldurur.
//
// Yanıt:
// { "ok": true, "now": 1763..., "windowMinutes": 30,
//   "items": { "1-A|0": { percent, level, count, confidence, lastAt }, ... } }

const { pool, summarize, sendJson, WINDOW_MINUTES } = require("./_lib.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "Yalnızca GET" });
  }

  try {
    const { rows } = await pool.query(
      `SELECT route_id, direction, percent, created_at
         FROM reports
        WHERE created_at > now() - ($1 || ' minutes')::interval`,
      [String(WINDOW_MINUTES)]
    );

    // (hat, yön) bazında grupla
    const groups = new Map();
    for (const r of rows) {
      const key = r.route_id + "|" + r.direction;
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(r);
    }

    const now = Date.now();
    const items = {};
    for (const [key, list] of groups) {
      items[key] = summarize(list, now);
    }

    // 15 saniye kenar önbelleği: aynı anda çok kullanıcı olsa da veritabanı
    // her istekte sorgulanmaz, ama veri yine de taze kalır.
    return sendJson(res, 200, {
      ok: true,
      now,
      windowMinutes: WINDOW_MINUTES,
      items,
    }, 15);
  } catch (err) {
    console.error("occupancy hatası:", err);
    return sendJson(res, 500, { ok: false, error: "Doluluk bilgisi alınamadı" });
  }
};
