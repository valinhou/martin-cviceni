/* sw.js – offline podpora: vždy zkusí síť (čerstvá verze), bez připojení vrátí uloženou kopii */
const CACHE = 'martin-cviceni-v1';
const FILES = ['./', 'index.html', 'app.js', 'cviky.js', 'anim-jadro.js', 'anim-nohy.js', 'anim-trup.js', 'anim-protazeni.js', 'manifest.json', 'ikona.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).catch(() => {})); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // OpenAI apod. neřešíme
  e.respondWith(fetch(e.request).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
