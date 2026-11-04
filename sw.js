/* TonePi Bluetooth bundle. The page (navigation) goes to the network
 * first, so a published update shows on the next open; every asset URL
 * carries its content hash (?v=), so assets are cache-first by exact URL
 * and a changed file is a new URL. Offline, the cached copy serves. */
var C = 'tonepi-ble-6e401eae5f';
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(C).then(function (c) { return c.addAll(["index.html", "static/css/mobile-app.css?v=7216f4a828", "static/css/zynthian-mobile.css?v=7d4d5820ab", "static/icons/icon-192.png?v=95acb0f43a", "static/icons/icon-512.png?v=b18e69a6b9", "static/js/live_graph.js?v=ee8e08feb9", "static/js/mobile-app.js?v=5fe7908f83", "static/js/mobile-banks.js?v=d3c6b8f86b", "static/js/mobile-chain.js?v=f4a54bf2b6", "static/js/mobile-drag.js?v=fa33bd6e01", "static/js/mobile-models.js?v=3499d422a1", "static/js/mobile-palette.js?v=e6af5105e7", "static/js/mobile-parallel.js?v=25cc1f7c8b", "static/js/mobile-params.js?v=e77a7d10c1", "static/js/mobile-play.js?v=b5b8f7bcf2", "static/js/mobile-presets.js?v=35f7a1a56c", "static/js/mobile-state.js?v=caa9d03bf0", "static/js/mobile-tools.js?v=9d340fe56b", "static/js/mobile-ws.js?v=9a424cd601", "static/js/model_level.js?v=ad522ef434", "static/js/tp_ble.js?v=37497a17ce", "static/js/tp_engine.js?v=4829cd5ace", "static/js/tp_snapshots.js?v=3de49ad15a", "static/js/xy_pad.js?v=e48c458b5e", "static/js/zynm-app.js?v=6ebf220df2", "static/js/zynm-inspector.js?v=33d5460bed", "static/js/zynm-library.js?v=b4f4064e3b", "static/js/zynm-mixer.js?v=36219858bc", "static/js/zynm-rack.js?v=c5cb61a2c2", "static/js/zynm-state.js?v=6ca61e84d0", "static/js/zynm-voices.js?v=83da5fdc82", "static/manifest.json?v=4f85953c42"]); }));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== C; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r, { cache: 'no-store' }).catch(function () {
      return caches.match('index.html');
    }));
    return;
  }
  e.respondWith(caches.match(r).then(function (hit) { return hit || fetch(r); }));
});
