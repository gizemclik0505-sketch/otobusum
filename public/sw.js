// Otobüsüm — hizmet çalışanı (service worker)
//
// İki iş yapar:
//  1. Uygulamanın telefon ana ekranına eklenebilmesini sağlar.
//  2. İnternet yokken de açılmasını sağlar. Hat, durak ve güzergâh verisi
//     sayfanın içinde gömülü olduğu için çevrimdışıyken uygulamanın büyük
//     kısmı çalışır; yalnızca doluluk bilgisi güncellenemez.
//
// Önbellek stratejisi bilerek "önce ağ" seçildi: çevrimiçi kullanıcı her
// zaman güncel sürümü görür, çevrimdışı kullanıcı önbellekten açar. Böylece
// yeni bir sürüm yayınlandığında kimse eski sayfada kalmaz.

var VERSION = "otobusum-v1";
var SHELL = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(VERSION).then(function (cache) {
      // Tek tek ekliyoruz: biri başarısız olursa kurulum tamamen çökmesin.
      return Promise.all(
        SHELL.map(function (url) {
          return cache.add(url).catch(function () {});
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (k) {
          return k === VERSION ? null : caches.delete(k);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;

  if (req.method !== "GET") return;

  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }

  // Başka sitelere giden istekler (yazı tipleri vb.) tarayıcıya bırakılır.
  if (url.origin !== self.location.origin) return;

  // Doluluk verisi asla önbelleğe alınmaz: eski doluluk yanlış bilgidir.
  if (url.pathname.indexOf("/api/") === 0) return;

  event.respondWith(
    fetch(req)
      .then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(VERSION).then(function (cache) {
            cache.put(req, copy).catch(function () {});
          });
        }
        return res;
      })
      .catch(function () {
        return caches.match(req).then(function (hit) {
          if (hit) return hit;
          // Sayfa gezinmesiyse ana sayfayı önbellekten ver
          if (req.mode === "navigate") return caches.match("/");
          return Response.error();
        });
      })
  );
});
