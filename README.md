# Otobüsüm

Konya otobüs hatlarında yolcu bildirimine dayalı doluluk takibi.

Hat, durak ve güzergâh verisi **Konya Büyükşehir Belediyesi Açık Veri
Platformu**'ndan alınmıştır (gtfs_11_2025.zip, 10 Kasım 2025, CC BY 4.0).
Doluluk verisi belediyeden gelmez; kullanıcı bildirimlerinden hesaplanır.

Bağımsız bir projedir, belediyenin resmî uygulaması değildir.

## İçindekiler

```
public/index.html          Uygulamanın tamamı: hat listesi, arama, harita,
                           durak listesi, doluluk bildirimi, yakındaki duraklar.
                           Konya verisi (157 hat, 4.190 durak, 262 yön) gömülü.
public/sw.js               Çevrimdışı çalışma ve ana ekrana eklenebilme
public/manifest.webmanifest Uygulama adı, simgeleri, açılış ayarları
public/icon-*.png          Uygulama simgeleri
api/occupancy.js           GET  — tüm hatların güncel doluluk özeti
api/report.js              POST — yeni doluluk bildirimi kaydeder
api/health.js              GET  — kurulum teşhisi
api/_lib.js                Veritabanı bağlantısı ve doluluk hesaplama
api/_routes.js             Geçerli hat ve yön listesi (üretilir)
api/_stops.js              Geçerli durak kimlikleri (üretilir)
db/schema.sql              Veritabanı tabloları (ilk kurulum — hepsini içerir)
db/002-vagon.sql           Tramvay vagon alanı (mevcut kuruluma ek)
db/003-ip-limit.sql        IP bazlı hız sınırı indeksi (mevcut kuruluma ek)
db/004-durak.sql           Bildirime durak bilgisi (mevcut kuruluma ek)
package.json               Tek bağımlılık: pg (PostgreSQL sürücüsü)
```

`public/index.html` elle düzenlenmez; şablon ile Konya verisinden üretilir.
Üretim adımı belgeyi `<!doctype html>`, `charset` ve `viewport` etiketleriyle
birlikte kurar — bunlar olmadan telefon tarayıcıları sayfayı 980 piksel
genişliğinde açıp küçültür.

## Özellikler

- **157 hat** (154 otobüs, 3 tramvay), 4.190 durak, gerçek güzergâh çizgileri
- **Türkçe aksansız arama**: "sehir hastanesi" yazınca "Şehir Hastanesi" bulunur;
  hat numarası ve durak adı birlikte aranır
- **Doluluk bildirimi** ve yolcu bildirimlerinden hesaplanan doluluk
- **Tramvayda vagon bazlı doluluk** — ön ve arka vagon ayrı
- **Yakınımdaki duraklar** — konum izniyle en yakın 8 durak ve geçen hatlar
- **Bildirime durak bilgisi** — bildirim yapılırken cihaz, konumdan en yakın
  durağı kendisi bulur; sunucuya yalnızca durağın kimliği gider, konumun
  kendisi hiç gönderilmez. Amaç: "benim durağıma gelen araç dolu mu?"
  sorusuna cevap verebilmek — aynı hat ilk durakta boş, beşinci durakta
  dolu olabiliyor
- **Çevrimdışı çalışır** — hat, durak ve güzergâh verisi uygulamanın içinde;
  internet yokken yalnızca doluluk güncellenemez
- **Ana ekrana eklenebilir** — telefonda uygulama gibi açılır

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

İki katman var, çünkü tek başına cihaz kimliği yeterli değil.

**Cihaz bazlı** (`clientId` — tarayıcıda üretilen anonim UUID)

- Aynı cihaz, aynı hat + yön + vagon: **10 dakikada bir** bildirim
- Aynı cihaz, tüm hatlar: **10 dakikada en fazla 8** bildirim

**IP bazlı** (`ip_hash`)

- Aynı IP, aynı hat + yön: **10 dakikada en fazla 5** bildirim
- Aynı IP, tüm hatlar: **10 dakikada en fazla 40** bildirim

IP katmanı şart: `clientId` tarayıcıda üretilip sunucuya gönderildiği için
her istekte yeni bir kimlik uyduran biri cihaz sınırlarının hepsini atlar.
IP karması istekle birlikte geldiğinden uydurulamaz.

IP eşikleri bilerek gevşek tutuldu. Türkiye'de mobil operatörler binlerce
aboneyi tek IP arkasına koyabiliyor (CGNAT); sıkı bir sınır aynı hattaki
gerçek yolcuları da engellerdi. Amaç tek bir kişinin bir hattı sahte
bildirimle doldurmasını önlemek.

**Diğer katmanlar**

- Medyan tabanlı aykırı değer temizliği (bkz. doluluk hesabı)
- Veritabanı kısıtları: `percent` 0–100, `direction` 0/1, `car` NULL/1/2
- IP adresi saklanmaz, yalnızca `IP_SALT` ile tuzlanmış karması tutulur
- Hesap sistemi yoktur, kişisel veri toplanmaz
- Konum verisi yalnızca tarayıcıda kullanılır, sunucuya hiç gönderilmez

**Henüz yok:** bildirenin gerçekten o hatta yakın olduğunun doğrulanması.
Konum iznine bağlı olacağı için sürtünme yaratır; kötüye kullanım gerçek bir
sorun haline gelirse eklenebilir.

## Veri saklama

Bildirimler **90 gün** saklanır (`RETENTION_DAYS`, `api/_lib.js`).

Doluluk hesabı yalnızca son 30 dakikaya bakar, yani gösterim için eski veri
gereksiz. Yine de hemen silinmez: biriken geçmiş, "12 numaralı hat hafta içi
08:00–09:00 arası ortalama %85 dolu" gibi saat bazlı analizlere imkân verir ve
bu bilgi başka hiçbir kaynakta yoktur. 90 gün mevsimsel farkı da gösterir
(okul açık/kapalı) ve depolamayı sınırlı tutar.

Temizlik ayrı bir zamanlanmış işe bağlı değil: bildirimlerin yaklaşık %2'sinde
çalışır, tek seferde en fazla 5.000 satır siler, birikme olursa sonraki
çalışmalarda devam eder. Böylece ek kurulum ve barındırma planına bağımlılık
yok. Hata durumunda sessizce geçer; temizlik yapılamaması bildirimin
kaydedilmesini engellemez.

Yer hesabı: bir bildirim indeksleriyle birlikte yaklaşık 350 bayt. Neon'un
ücretsiz 1 GB'ına kabaca 3 milyon bildirim sığar — 90 günlük saklamayla
pratikte hiç dolmaz.


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
