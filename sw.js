/* ARRAIGO: trabajo sin conexión. La página se pide primero a la red (para tener
   siempre la versión vigente) y, si no hay señal, se sirve la última guardada.
   Los datos capturados viven en el equipo y se sincronizan al volver la conexión;
   la función del asistente (/api) nunca se guarda en caché. */
const CACHE = 'arraigo-v2';
const BASE = ['/', '/manifest.webmanifest', '/icons/icono-192.png', '/icons/icono-512.png', '/icons/icono.svg'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(BASE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  const esPagina = e.request.mode === 'navigate';
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok && !r.redirected) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(esPagina ? '/' : e.request, copia)); }
      return r;
    }).catch(() => caches.match(esPagina ? '/' : e.request).then((r) => r || caches.match('/')))
  );
});
