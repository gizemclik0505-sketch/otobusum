# Otobüsüm

Konya otobüs hatlarında yolcu bildirimine dayalı doluluk takibi.

Hat, durak ve güzergâh verisi **Konya Büyükşehir Belediyesi Açık Veri
Platformu**'ndan alınmıştır (gtfs_11_2025.zip, 10 Kasım 2025, CC BY 4.0).
Doluluk verisi belediyeden gelmez; kullanıcı bildirimlerinden hesaplanır.

Bağımsız bir projedir, belediyenin resmî uygulaması değildir.

## İçindekiler

```
public/index.html   Uygulamanın tamamı: hat listesi, arama, harita,
                    durak listesi, doluluk bildirimi. Konya verisi
                    (157 hat, 4.190 durak, 262 yön) dosyanın içinde gömülü.
api/occupancy.js    GET  — tüm hatların güncel doluluk özeti
api/report.js       POST — yeni doluluk bildirimi kaydeder
api/_lib.js         Veritabanı bağlantısı ve doluluk hesaplama
db/schema.sql       Veritabanı tabloları
package.json        Tek bağımlılık: pg (PostgreSQL sürücüsü)
```

Derleme adımı yoktur. Vercel `public/` klasörünü olduğu gibi yayınlar,
`api/` içindeki dosyaları sunucu fonksiyonu olarak çalıştırır.

## Kurulum

### 1. Veritabanı (Neon)

1. [neon.com](https://neon.com) üzerinden ücretsiz hesap açın, bir proje oluşturun.
2. Soldaki menüden **SQL Editor**'ü açın.
3. `db/schema.sql` dosyasının içeriğini yapıştırıp **Run**'a basın.
4. **Connection string**'i kopyalayın (`postgresql://...` ile başlar).

### 2. Yayın (Vercel)

1. [vercel.com](https://vercel.com) hesabını GitHub ile açın.
2. **Add New → Project** deyip bu depoyu seçin.
3. **Environment Variables** bölümüne ekleyin:
   - `DATABASE_URL` = Neon'dan kopyaladığınız adres
   - `IP_SALT` = rastgele uzun bir metin (IP adreslerini karmalamak için)
4. **Deploy**'a basın.

Diğer ayarlara dokunmayın; derleme komutu gerekmez.

## Doluluk nasıl hesaplanır?

Kurallar `api/_lib.js` içinde tek yerde durur:

- **Zaman penceresi:** yalnızca son **30 dakikadaki** bildirimler sayılır.
- **Ağırlıklı ortalama:** bir bildirimin ağırlığı **10 dakikada yarıya** düşer,
  böylece yeni bildirim eskisine baskın gelir.
- **Aykırı değer temizliği:** en az 4 bildirim varsa, medyandan 30 puandan fazla
  sapanlar hesaba katılmaz.
- **Yoğunluk:** %0–40 düşük, %41–75 orta, %76–100 yüksek.
- **Güvenilirlik:** 1–2 bildirim düşük, 3–5 orta, 6+ yüksek.

## Kötüye kullanım koruması

- Aynı cihaz aynı hat ve yöne **10 dakikada bir** bildirim gönderebilir.
- Aynı cihaz tüm hatlarda **10 dakikada en fazla 8** bildirim gönderebilir.
- IP adresi saklanmaz, yalnızca tuzlanmış karması tutulur.
- Hesap sistemi yoktur; cihaz kimliği tarayıcıda üretilen anonim bir UUID'dir.

## Veri kaynağı hakkında bilinenler

Ham GTFS paketi incelenerek tasarlandı. Tasarımı etkileyen noktalar:

- **Güzergâh çizgisi yön başına ayrılamıyor.** Kaynakta `shape_id` her zaman
  `route_id`'ye eşit; gidiş ve dönüş aynı çizgiyi paylaşıyor. Haritada hat
  başına tek çizgi çizilir, yön sıralı durak listesiyle verilir.
- **`direction_id` hatlar arasında tutarlı değil.** 1-A'da yön 0 Alaaddin→Meram,
  2-A'da yön 0 Meram→Zafer. Bu yüzden kullanıcıya "Gidiş/Dönüş" değil, seferin
  kendi yön adı gösterilir: "Meram yönü", "Alaaddin yönü".
- **`route_long_name` kendini tekrar ediyor** ("Meram Yaka - Meram Yaka
  Anasultan"). En ayırt edici son parça alınır: "Meram Yaka Anasultan".
- **Birçok hat aynı duraklarda başlayıp bitiyor** (262 yönde 137 farklı uç
  çifti), bu yüzden listede uç durakların yanında hattın adı da gösterilir.
- 165 hattan 8'inin hiç seferi yok; bunlar uygulamaya alınmadı. Kalan 157 hat
  listeleniyor, 154'ü otobüs, 3'ü tramvay.

## Veriyi güncellemek

Belediye yeni bir GTFS paketi yayınladığında `public/index.html` içindeki gömülü
veri yeniden üretilir. Dönüştürme adımları: aktif hatların seçilmesi, her
(hat, yön) için temsilci seferin durak sırası, güzergâh çizgisinin 20 metre
toleransla sadeleştirilmesi (127.000 nokta → 15.000).

## Sonraki adımlar

- [ ] Telefon ana ekranına eklenebilme (PWA)
- [ ] "Yakınımdaki duraklar" (konum izniyle)
- [ ] Hat ve durak verisinin de veritabanına alınması (şu an uygulamaya gömülü)
- [ ] Doluluk geçmişi ve saat bazlı ortalamalar
