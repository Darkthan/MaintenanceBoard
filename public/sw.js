const CACHE_NAME = 'maintenanceboard-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/rooms.html',
  '/equipment.html',
  '/interventions.html',
  '/orders.html',
  '/suppliers.html',
  '/stock.html',
  '/signatures.html',
  '/downloads.html',
  '/js/layout.js',
  '/scan.html',
  '/ticket-status.html',
];

// Install: précacher les assets statiques
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Activate: nettoyer les anciens caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Fetch: cache-first pour statiques, network-first pour API
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ne pas cacher les requêtes non-GET ni les ressources externes (CDN)
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API : network first, fallback cache
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Statiques : cache first, fallback network
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }))
  );
});
