-- Otobüsüm — 2. güncelleme: tramvayda vagon bazlı doluluk
--
-- Konya'daki tramvaylar iki vagonlu ve vagonların doluluğu birbirinden çok
-- farklı olabiliyor. Bu yüzden bildirime "hangi vagon" bilgisi eklendi.
--
-- Bu dosyayı Neon panelindeki SQL Editor'e yapıştırıp bir kez çalıştırın.
-- Tekrar çalıştırmak zarar vermez. Mevcut bildirimler silinmez; onların
-- vagon bilgisi boş (NULL) kalır, yani "tüm araç" sayılırlar.

-- 1 = ön vagon, 2 = arka vagon, NULL = ayırt edilmemiş (otobüsler ve
-- "tüm tramvay" bildirimleri)
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS car SMALLINT;

-- Kısıtı ayrı ekliyoruz; ADD COLUMN IF NOT EXISTS ile birlikte yazıldığında
-- kolon zaten varsa kısıt eklenmiyor.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_car_check'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_car_check CHECK (car IS NULL OR car IN (1, 2));
  END IF;
END $$;

-- Vagon bazlı doluluk sorgusu için
CREATE INDEX IF NOT EXISTS reports_route_dir_car_time_idx
  ON reports (route_id, direction, car, created_at DESC);
