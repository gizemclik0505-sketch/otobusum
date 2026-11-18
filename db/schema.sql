-- Otobüsüm — veritabanı şeması
--
-- Bu dosyayı Neon panelindeki "SQL Editor" ekranına yapıştırıp bir kez
-- çalıştırmanız yeterli. Tekrar çalıştırmak zarar vermez ("IF NOT EXISTS").

-- Kullanıcılardan gelen ham doluluk bildirimleri.
-- Bu tablo asla güncellenmez, yalnızca yeni satır eklenir.
CREATE TABLE IF NOT EXISTS reports (
  id          BIGSERIAL PRIMARY KEY,

  -- Hattın resmî kimliği (GTFS route_id), ör. '1-A'.
  route_id    TEXT        NOT NULL,

  -- Yön: 0 veya 1. Tek yönlü hatlarda her zaman 0.
  direction   SMALLINT    NOT NULL CHECK (direction IN (0, 1)),

  -- Bildirilen doluluk yüzdesi.
  percent     SMALLINT    NOT NULL CHECK (percent >= 0 AND percent <= 100),

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Anonim cihaz kimliği. Hesap sistemi yok; aynı cihazın arka arkaya
  -- bildirim yapmasını sınırlamak için tutulur.
  client_id   UUID        NOT NULL,

  -- IP adresinin karması. Ham IP saklanmaz.
  ip_hash     TEXT
);

-- Doluluk hesabı: belirli bir hat+yön için son 30 dakikadaki bildirimler.
-- Bu indeks o sorgunun tamamını karşılar.
CREATE INDEX IF NOT EXISTS reports_route_dir_time_idx
  ON reports (route_id, direction, created_at DESC);

-- Tüm hatların özetini tek seferde çeken sorgu için.
CREATE INDEX IF NOT EXISTS reports_time_idx
  ON reports (created_at DESC);

-- Hız sınırı: bu cihaz bu hatta son X dakikada bildirim yaptı mı?
CREATE INDEX IF NOT EXISTS reports_client_idx
  ON reports (client_id, route_id, direction, created_at DESC);
