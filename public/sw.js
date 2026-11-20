// Otobüsüm — hizmet çalışanı (service worker)
//
// İki iş yapar:
//  1. Uygulamanın telefon ana ekranına eklenebilmesini sağlar.
//  2. İnternet yokken de açılmasını sağlar. Hat, durak ve güzergâh verisi
//     sayfanın içinde gömülü olduğu için çevrimdışıyken uygulamanın büyük
//     kısmı çalışır; yalnızca doluluk bilgisi güncellenemez.
//
// Strateji: sayfa için "önce ağ, ama en fazla 3 saniye bekle".
//
// Saf "önce ağ" olsaydı, zayıf şebekede kullanıcı 585 KB'lık sayfa inene
// kadar boş ekrana bakardı — otobüs beklerken tam istenmeyen şey. Saf
// "önce önbellek" olsaydı yeni sürüm bir açılış gecikmeli gelirdi.
// Zaman aşımı ikisinin ortası: şebeke iyiyse güncel sürüm, kötüyse
// önbellekten anında açılış. Ağ yanıtı sonra gelse de önbellek tazelenir.
//
// Simge ve manifest için "önce önbellek": bunlar sürüm içinde değişmez.

var VERSION = "otobusum-v2";
var PAGE_TIMEOUT_MS = 3000;
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

  // Simgeler, manifest: sürüm içinde değişmez, önbellekten anında ver.
  if (/\.(png|webmanifest|ico|svg)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetchAndCache(req);
      })
    );
    return;
  }

  event.respondWith(pageResponse(req));
});

function fetchAndCache(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(VERSION).then(function (cache) {
        cache.put(req, copy).catch(function () {});
      });
    }
    return res;
  });
}

function cacheFallback(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    if (req.mode === "navigate") {
      return caches.match("/").then(function (home) {
        return home || Response.error();
      });
    }
    return Response.error();
  });
}

// Önce ağ, ama en fazla PAGE_TIMEOUT_MS bekle; süre dolarsa önbellekten ver.
// Ağ yanıtı sonra gelirse önbellek yine tazelenir.
function pageResponse(req) {
  return new Promise(function (resolve) {
    var done = false;
    function finish(res) {
      if (done) return;
      done = true;
      resolve(res);
    }

    var timer = setTimeout(function () {
      if (done) return;
      caches.match(req).then(function (hit) {
        if (hit) finish(hit);
      });
    }, PAGE_TIMEOUT_MS);

    fetchAndCache(req).then(
      function (res) {
        clearTimeout(timer);
        finish(res);
      },
      function () {
        clearTimeout(timer);
        cacheFallback(req).then(finish);
      }
    );
  });
}
