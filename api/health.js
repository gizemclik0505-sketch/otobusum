// GET /api/health
//
// Teşhis aracı. Kurulumun neresinde sorun olduğunu sırayla kontrol eder ve
// anlaşılır Türkçe bir sonuç döndürür.
//
// Şifre, bağlantı adresi veya başka bir gizli bilgi ASLA yazdırılmaz;
// yalnızca sunucu adı gösterilir.

const { pool, sendJson } = require("./_lib.js");

module.exports = async function handler(req, res) {
  const checks = [];
  let hint = null;

  // --- 1. Ortam değişkeni tanımlı mı? --------------------------------
  const raw = process.env.DATABASE_URL;
  if (!raw || !raw.trim()) {
    // İsim yanlış yazılmış olabilir. Benzer isimleri listeleyelim —
    // yalnızca İSİMLER, değerler asla.
    const benzer = Object.keys(process.env).filter((k) =>
      /DATA|POSTGRES|NEON|SALT|_URL$/i.test(k)
    );

    const tanimliAmaBos = Object.prototype.hasOwnProperty.call(
      process.env,
      "DATABASE_URL"
    );

    checks.push({
      adim: "1. DATABASE_URL ayarı",
      durum: "HATA",
      aciklama: tanimliAmaBos
        ? "DATABASE_URL tanımlı ama DEĞERİ BOŞ. Yapıştırma sırasında pano boş kalmış olabilir."
        : "DATABASE_URL adında bir değişken bulunamadı.",
    });

    checks.push({
      adim: "Projede bulunan benzer değişken isimleri",
      durum: "BİLGİ",
      aciklama: benzer.length
        ? benzer.join(", ")
        : "Hiç benzer isim yok — değişken bu dağıtıma hiç ulaşmamış.",
    });

    return sendJson(res, 500, {
      ok: false,
      checks,
      hint:
        "Yukarıdaki listede DATABASE_URL tam olarak böyle yazılmış görünüyor mu? " +
        "Küçük/büyük harf ve alt çizgiler birebir aynı olmalı. İsim doğruysa " +
        "değeri boş demektir: Vercel'de değişkeni düzenleyip Neon adresini " +
        "yeniden yapıştırın. Her iki durumda da sonrasında Deployments " +
        "sekmesinden Redeploy yapmayı unutmayın.",
    });
  }

  const url = raw.trim();
  // Bu uç nokta herkese açık. Tam sunucu adresini yazdırmıyoruz; teşhis için
  // sağlayıcının görünmesi yeterli (ör. "neon.tech").
  let host = "bilinmiyor";
  let looksRight = false;
  try {
    const u = new URL(url);
    looksRight = u.protocol === "postgres:" || u.protocol === "postgresql:";
    const parts = u.hostname.split(".");
    host = parts.length > 2 ? parts.slice(-2).join(".") : u.hostname;
  } catch (e) {
    /* biçim bozuk */
  }

  checks.push({
    adim: "1. DATABASE_URL ayarı",
    durum: looksRight ? "TAMAM" : "HATA",
    aciklama: looksRight
      ? `Tanımlı. Sunucu: ${host}`
      : "Tanımlı ama biçimi hatalı. 'postgresql://' ile başlamalı. " +
        "Yapıştırırken başına/sonuna tırnak veya boşluk karışmış olabilir.",
  });

  if (!looksRight) {
    return sendJson(res, 500, {
      ok: false,
      checks,
      hint:
        "Neon panelinden bağlantı adresini yeniden kopyalayın. Tırnak işareti " +
        "olmadan, tek satır halinde yapıştırın. Sonra Redeploy edin.",
    });
  }

  // --- 2. Veritabanına bağlanılabiliyor mu? --------------------------
  let client;
  try {
    client = await pool.connect();
    await client.query("SELECT 1");
    checks.push({
      adim: "2. Veritabanı bağlantısı",
      durum: "TAMAM",
      aciklama: `${host} sunucusuna bağlanıldı.`,
    });
  } catch (err) {
    checks.push({
      adim: "2. Veritabanı bağlantısı",
      durum: "HATA",
      aciklama: temizHata(err),
    });
    if (client) client.release();
    return sendJson(res, 500, {
      ok: false,
      checks,
      hint:
        "Bağlantı adresi yanlış olabilir ya da Neon projesi uykuda/silinmiş " +
        "olabilir. Neon panelini açıp projenin çalıştığını doğrulayın ve " +
        "bağlantı adresini yeniden kopyalayın.",
    });
  }

  // --- 3. reports tablosu var mı? ------------------------------------
  try {
    const t = await client.query("SELECT to_regclass('public.reports') AS tablo");
    if (!t.rows[0].tablo) {
      checks.push({
        adim: "3. reports tablosu",
        durum: "HATA",
        aciklama: "Tablo bulunamadı.",
      });
      client.release();
      return sendJson(res, 500, {
        ok: false,
        checks,
        hint:
          "Neon'da SQL Editor'ü açıp db/schema.sql içindeki komutları " +
          "çalıştırın. Dikkat: tabloyu başka bir projede veya başka bir " +
          "branch'te oluşturmuş olabilirsiniz; DATABASE_URL hangi projeye " +
          "işaret ediyorsa tablo orada olmalı.",
      });
    }
    checks.push({
      adim: "3. reports tablosu",
      durum: "TAMAM",
      aciklama: "Tablo mevcut.",
    });
  } catch (err) {
    checks.push({ adim: "3. reports tablosu", durum: "HATA", aciklama: temizHata(err) });
    client.release();
    return sendJson(res, 500, { ok: false, checks, hint: null });
  }

  // --- 4. Okuma ve sayım ---------------------------------------------
  try {
    const c = await client.query("SELECT count(*)::int AS n FROM reports");
    const r = await client.query(
      "SELECT count(*)::int AS n FROM reports WHERE created_at > now() - interval '30 minutes'"
    );
    checks.push({
      adim: "4. Tabloyu okuma",
      durum: "TAMAM",
      aciklama: `Toplam ${c.rows[0].n} bildirim, son 30 dakikada ${r.rows[0].n} tane.`,
    });
  } catch (err) {
    checks.push({ adim: "4. Tabloyu okuma", durum: "HATA", aciklama: temizHata(err) });
    client.release();
    return sendJson(res, 500, { ok: false, checks, hint: null });
  }

  client.release();

  return sendJson(res, 200, {
    ok: true,
    sonuc: "Her şey çalışıyor. Uygulama doluluk verisini okuyup yazabilir.",
    checks,
  });
};

// Hata metninden bağlantı adresi veya şifre sızmasın.
function temizHata(err) {
  const kod = err && err.code ? ` (kod: ${err.code})` : "";
  let msg = err && err.message ? String(err.message) : "Bilinmeyen hata";
  msg = msg.replace(/postgres(ql)?:\/\/[^\s]+/gi, "[bağlantı adresi gizlendi]");
  if (msg.length > 200) msg = msg.slice(0, 200) + "…";
  return msg + kod;
}
