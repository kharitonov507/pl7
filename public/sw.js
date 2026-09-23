const CACHE = 'dooh-shell-v1';
const SHELL = ['/player.html', '/player.js', '/player.css', '/db.js'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('dooh-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !SHELL.includes(url.pathname) || event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(url.pathname);
    return cached || new Response('Плеер ещё не закеширован', { status: 503 });
  }));
});
