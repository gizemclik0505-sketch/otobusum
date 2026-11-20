// POST /api/report
//
// Bir doluluk bildirimini kaydeder ve ilgili hat+yönün güncel özetini döndürür.
//
// Gövde: { "routeId": "1-A", "direction": 0, "percent": 65,
//          "clientId": "<uuid>", "car": null }
//
// car: 1 = ön vagon, 2 = arka vagon, null/yok = ayırt edilmemiş.
// Tramvaylar iki vagonlu ve vagonların doluluğu çok farklı olabiliyor.
// Sunucu hangi hattın tramvay olduğunu bilmez (hat verisi ön yüzde durur),
// bu yüzden car alanını her hat için kabul eder; seçeneği yalnızca tramvay
// hatlarında gösteren taraf arayüzdür.

const {
  pool, summarize, hashIp, sendJson,
  WINDOW_MINUTES, COOLDOWN_MINUTES,
  IP_WINDOW_MINUTES, IP_ROUTE_LIMIT, IP_TOTAL_LIMIT,
  CLEANUP_CHANCE, cleanupOldReports,
} = require("./_lib.js");
const { isValidRoute, isValidDirection, isTram } = require("./_routes.js");
const { isValidStop } = require("./_stops.js");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROUTE_RE = /^[A-Za-z0-9-]{1,16}$/;

function readBody(req) {
  // Vercel gövdeyi çoğu zaman kendisi çözer; çözmediği durumda elle okuruz.
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 4000) reject(new Error("Gövde çok büyük"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Geçersiz JSON"));
      }
    });
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Yalnızca POST" });
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return sendJson(res, 400, { ok: false, error: "İstek okunamadı" });
  }

  // --- doğrulama ------------------------------------------------------
  const routeId = typeof body.routeId === "string" ? body.routeId.trim() : "";
  const direction = Number(body.direction);
  const percent = Number(body.percent);
  const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";

  let car = null;
  if (body.car !== null && body.car !== undefined && body.car !== "") {
    car = Number(body.car);
    if (car !== 1 && car !== 2) {
      return sendJson(res, 400, { ok: false, error: "Vagon 1 veya 2 olmalı" });
    }
  }

  if (!ROUTE_RE.test(routeId)) {
    return sendJson(res, 400, { ok: false, error: "Hat kimliği geçersiz" });
  }
  // Hat gerçekten var mı? Olmayan hat kimlikleriyle gönderilen bildirimler
  // hiçbir yerde görünmez ama tabloyu kirletir ve ileride yapılacak
  // analizleri bozar.
  if (!isValidRoute(routeId)) {
    return sendJson(res, 400, { ok: false, error: "Böyle bir hat yok" });
  }
  if (direction !== 0 && direction !== 1) {
    return sendJson(res, 400, { ok: false, error: "Yön 0 veya 1 olmalı" });
  }
  // 52 hat tek yönlü; onlara "dönüş" bildirimi anlamsız.
  if (!isValidDirection(routeId, direction)) {
    return sendJson(res, 400, { ok: false, error: "Bu hatta böyle bir yön yok" });
  }
  // Vagon yalnızca tramvaylarda anlamlı; otobüs bildirimlerinde yok sayılır.
  if (car !== null && !isTram(routeId)) {
    car = null;
  }

  // Durak isteğe bağlı. Kullanıcıya sorulmuyor; cihazı konumundan en yakın
  // durağı kendisi buluyor ve yalnızca durağın kimliğini gönderiyor.
  // Konumun kendisi sunucuya hiç gelmiyor.
  //
  // Not: bu bir konum KANITI değil. İstemci istediği durağı gönderebilir.
  // Dürüst bildirimleri zenginleştirir; kötüye kullanıma karşı koruma
  // hız sınırlarıdır.
  let stopId = typeof body.stopId === "string" ? body.stopId.trim() : "";
  if (stopId && !isValidStop(stopId)) {
    stopId = "";   // uydurma durak sessizce atılır, bildirim yine kabul edilir
  }
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return sendJson(res, 400, { ok: false, error: "Doluluk 0 ile 100 arasında olmalı" });
  }
  if (!UUID_RE.test(clientId)) {
    return sendJson(res, 400, { ok: false, error: "Cihaz kimliği geçersiz" });
  }

  try {
    // --- hız sınırı: aynı cihaz, aynı hat+yön+vagon -------------------
    // Vagon ayrı sayılır: biri ön vagonu, biri arka vagonu bildirmek
    // isteyebilir ve ikisi de geçerli bilgidir.
    const recent = await pool.query(
      `SELECT created_at
         FROM reports
        WHERE client_id = $1 AND route_id = $2 AND direction = $3
          AND car IS NOT DISTINCT FROM $4
          AND created_at > now() - interval '${Number(COOLDOWN_MINUTES)} minutes'
        ORDER BY created_at DESC
        LIMIT 1`,
      [clientId, routeId, direction, car]
    );

    if (recent.rows.length) {
      const last = new Date(recent.rows[0].created_at).getTime();
      const waitMs = COOLDOWN_MINUTES * 60 * 1000 - (Date.now() - last);
      return sendJson(res, 429, {
        ok: false,
        error: "Bu hat için az önce bildirim gönderdiniz.",
        retryAfterMinutes: Math.max(1, Math.ceil(waitMs / 60000)),
      });
    }

    // --- genel hız sınırı: aynı cihaz, tüm hatlar ---------------------
    const burst = await pool.query(
      `SELECT count(*)::int AS n
         FROM reports
        WHERE client_id = $1 AND created_at > now() - interval '10 minutes'`,
      [clientId]
    );
    if (burst.rows[0].n >= 8) {
      return sendJson(res, 429, {
        ok: false,
        error: "Çok fazla bildirim gönderdiniz. Lütfen biraz bekleyin.",
        retryAfterMinutes: 10,
      });
    }

    // --- IP tabanlı sınır --------------------------------------------
    // Yukarıdaki sınırlar cihaz kimliğine bakıyor, o da tarayıcıda üretilip
    // gönderiliyor: her istekte yeni kimlik uyduran biri hepsini atlar.
    // IP karması istekle birlikte geldiği için uydurulamaz.
    const ipHash = hashIp(req);
    if (ipHash) {
      const ipCheck = await pool.query(
        `SELECT
           (count(*) FILTER (WHERE route_id = $2 AND direction = $3))::int AS ayni_hat,
           count(*)::int AS toplam
         FROM reports
        WHERE ip_hash = $1
          AND created_at > now() - interval '${Number(IP_WINDOW_MINUTES)} minutes'`,
        [ipHash, routeId, direction]
      );

      const { ayni_hat: ayniHat, toplam } = ipCheck.rows[0];

      if (ayniHat >= IP_ROUTE_LIMIT) {
        return sendJson(res, 429, {
          ok: false,
          error: "Bu hat için kısa sürede çok fazla bildirim geldi. Lütfen biraz sonra tekrar deneyin.",
          retryAfterMinutes: IP_WINDOW_MINUTES,
        });
      }

      if (toplam >= IP_TOTAL_LIMIT) {
        return sendJson(res, 429, {
          ok: false,
          error: "Bağlantınızdan kısa sürede çok fazla bildirim geldi. Lütfen biraz sonra tekrar deneyin.",
          retryAfterMinutes: IP_WINDOW_MINUTES,
        });
      }
    }

    // --- kaydet -------------------------------------------------------
    await pool.query(
      `INSERT INTO reports (route_id, direction, percent, client_id, ip_hash, car, stop_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [routeId, direction, Math.round(percent), clientId, ipHash, car, stopId || null]
    );

    // --- güncel özeti döndür ------------------------------------------
    const { rows } = await pool.query(
      `SELECT car, percent, created_at
         FROM reports
        WHERE route_id = $1 AND direction = $2
          AND created_at > now() - interval '${Number(WINDOW_MINUTES)} minutes'`,
      [routeId, direction]
    );

    const now = Date.now();
    const summary = summarize(rows, now);

    const byCar = { 1: [], 2: [] };
    for (const r of rows) {
      if (r.car === 1 || r.car === 2) byCar[r.car].push(r);
    }
    for (const c of [1, 2]) {
      if (byCar[c].length) {
        if (!summary.cars) summary.cars = {};
        summary.cars[c] = summarize(byCar[c], now);
      }
    }

    // Ara sıra eski bildirimleri temizle. Ayrı bir zamanlanmış işe bağlamak
    // yerine buraya koyuldu: ek kurulum ve plana bağımlılık olmuyor.
    // Bildirimlerin küçük bir kısmında çalıştığı için kullanıcıyı bekletmiyor.
    if (Math.random() < CLEANUP_CHANCE) {
      await cleanupOldReports();
    }

    return sendJson(res, 200, {
      ok: true,
      routeId,
      direction,
      car,
      summary,
    });
  } catch (err) {
    console.error("report hatası:", err);
    return sendJson(res, 500, { ok: false, error: "Bildirim kaydedilemedi" });
  }
};
