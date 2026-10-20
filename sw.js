// Service worker: кэширует оболочку приложения, чтобы оно быстро открывалось и ставилось на телефон.
// Данные (Supabase), маршруты (/api) и тайлы карты всегда идут из сети.
const CACHE = 'akg-v2';
const SHELL = [
  '/', '/index.html', '/css/app.css', '/manifest.webmanifest', '/icons/icon.svg',
  '/js/app.js', '/js/config.js', '/js/data.js', '/js/demo-data.js', '/js/routing.js',
  '/js/lib/profiles.js', '/js/lib/barriers.js', '/js/lib/trust.js', '/js/lib/geo.js',
  '/js/lib/ranking.js', '/js/lib/route-analysis.js',
];
// Библиотека карты с CDN: без неё приложение не запустится офлайн.
const LIBS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(SHELL);
    await Promise.all(LIBS.map(u => c.add(u).catch(() => {}))); // не мешаем установке, если CDN недоступен
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  // Leaflet: версия закреплена, поэтому сначала кэш.
  if (LIBS.includes(req.url)) {
    e.respondWith(caches.match(req).then(r => r || fetch(req)));
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Свои файлы: сначала сеть (обновления приходят сразу), кэш — запасной вариант.
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('/index.html');
      return Response.error();
    }),
  );
});
