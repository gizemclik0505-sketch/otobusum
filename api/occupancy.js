// GET /api/occupancy
//
// Son 30 dakikadaki tüm bildirimleri çeker ve her (hat, yön) için doluluk
// özetini döndürür. Tramvaylarda ayrıca vagon bazlı kırılım verir.
//
// Yanıt:
// { "ok": true, "now": 1763..., "windowMinutes": 30,
//   "items": {
//     "1-A|0":   { percent, level, count, confidence, lastAt },
//     "150-A|0": { percent, level, count, confidence, lastAt,
//                  cars: { "1": {...}, "2": {...} } }
//   } }
//
// Genel özet, o yöne ait BÜTÜN bildirimlerden hesaplanır: vagon belirtenler
// de belirtmeyenler de aracın kalabalığını anlatır. cars kırılımı ise yalnızca
// o vagonu belirten bildirimleri kullanır.

const { pool, summarize, sendJson, WINDOW_MINUTES } = require("./_lib.js");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "Yalnızca GET" });
  }

  try {
    // Aralık doğrudan sorguya yazılıyor: PostgreSQL, parametreyle kurulan
    // "($1 || ' minutes')::interval" ifadesinde parametrenin tipini
    // belirleyemeyip hata verebiliyor. Değer sunucu sabiti, kullanıcıdan
    // gelmiyor; yine de sayıya zorlanıyor.
    const { rows } = await pool.query(
      `SELECT route_id, direction, car, percent, created_at
         FROM reports
        WHERE created_at > now() - interval '${Number(WINDOW_MINUTES)} minutes'`
    );

    const now = Date.now();

    // (hat, yön) ve (hat, yön, vagon) bazında grupla
    const groups = new Map();
    const carGroups = new Map();

    for (const r of rows) {
      const key = r.route_id + "|" + r.direction;
      let list = groups.get(key);
      if (!list) {
        list = [];
        groups.set(key, list);
      }
      list.push(r);

      if (r.car === 1 || r.car === 2) {
        const ck = key + "|" + r.car;
        let cl = carGroups.get(ck);
        if (!cl) {
          cl = [];
          carGroups.set(ck, cl);
        }
        cl.push(r);
      }
    }

    const items = {};
    for (const [key, list] of groups) {
      items[key] = summarize(list, now);
    }

    for (const [ck, list] of carGroups) {
      const idx = ck.lastIndexOf("|");
      const key = ck.slice(0, idx);
      const car = ck.slice(idx + 1);
      if (!items[key]) continue;
      if (!items[key].cars) items[key].cars = {};
      items[key].cars[car] = summarize(list, now);
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
