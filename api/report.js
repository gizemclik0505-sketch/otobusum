// POST /api/report
//
// Bir doluluk bildirimini kaydeder ve ilgili hat+yönün güncel özetini döndürür.
//
// Gövde: { "routeId": "1-A", "direction": 0, "percent": 65, "clientId": "<uuid>" }

const { pool, summarize, hashIp, sendJson, WINDOW_MINUTES, COOLDOWN_MINUTES } = require("./_lib.js");

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

  if (!ROUTE_RE.test(routeId)) {
    return sendJson(res, 400, { ok: false, error: "Hat kimliği geçersiz" });
  }
  if (direction !== 0 && direction !== 1) {
    return sendJson(res, 400, { ok: false, error: "Yön 0 veya 1 olmalı" });
  }
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return sendJson(res, 400, { ok: false, error: "Doluluk 0 ile 100 arasında olmalı" });
  }
  if (!UUID_RE.test(clientId)) {
    return sendJson(res, 400, { ok: false, error: "Cihaz kimliği geçersiz" });
  }

  try {
    // --- hız sınırı: aynı cihaz, aynı hat+yön -------------------------
    const recent = await pool.query(
      `SELECT created_at
         FROM reports
        WHERE client_id = $1 AND route_id = $2 AND direction = $3
          AND created_at > now() - interval '${Number(COOLDOWN_MINUTES)} minutes'
        ORDER BY created_at DESC
        LIMIT 1`,
      [clientId, routeId, direction]
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

    // --- kaydet -------------------------------------------------------
    await pool.query(
      `INSERT INTO reports (route_id, direction, percent, client_id, ip_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [routeId, direction, Math.round(percent), clientId, hashIp(req)]
    );

    // --- güncel özeti döndür ------------------------------------------
    const { rows } = await pool.query(
      `SELECT percent, created_at
         FROM reports
        WHERE route_id = $1 AND direction = $2
          AND created_at > now() - interval '${Number(WINDOW_MINUTES)} minutes'`,
      [routeId, direction]
    );

    return sendJson(res, 200, {
      ok: true,
      routeId,
      direction,
      summary: summarize(rows, Date.now()),
    });
  } catch (err) {
    console.error("report hatası:", err);
    return sendJson(res, 500, { ok: false, error: "Bildirim kaydedilemedi" });
  }
};
