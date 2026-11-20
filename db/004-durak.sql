-- Otobüsüm — 4. güncelleme: bildirime durak bilgisi
--
-- Amaç: "benim durağıma gelen araç dolu mu?" sorusuna cevap verebilmek.
-- Aynı hat ilk durakta boş, beşinci durakta dolu olabiliyor; hat bazında
-- ortalama bu farkı gizliyor.
--
-- Durak kullanıcıya sorulmuyor, cihazındaki konumdan bulunuyor. Konumun
-- kendisi sunucuya gönderilmiyor; yalnızca bulunan durağın kimliği geliyor.
--
-- Bu dosyayı Neon panelindeki SQL Editor'e yapıştırıp bir kez çalıştırın.
-- Veri silmez. Mevcut bildirimlerin durak alanı boş (NULL) kalır.

-- GTFS stop_id, ör. '2415a'. NULL = konum yoktu ya da izin verilmedi.
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS stop_id TEXT;

-- Saat bazlı tahmin sorgusu: belirli hat+yön+durak için geçmiş bildirimler.
CREATE INDEX IF NOT EXISTS reports_stop_time_idx
  ON reports (route_id, direction, stop_id, created_at DESC);
