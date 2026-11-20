-- Otobüsüm — 3. güncelleme: IP tabanlı hız sınırı için indeks
--
-- Cihaz kimliği tarayıcıda üretilip gönderiliyor, yani her istekte yeni kimlik
-- uyduran biri cihaz sınırlarını atlayabiliyordu. Artık IP karmasına da
-- bakılıyor. Bu indeks o sorgunun hızlı çalışmasını sağlar.
--
-- Bu dosyayı Neon panelindeki SQL Editor'e yapıştırıp bir kez çalıştırın.
-- Veri silmez, yalnızca indeks ekler.

CREATE INDEX IF NOT EXISTS reports_ip_time_idx
  ON reports (ip_hash, created_at DESC);
