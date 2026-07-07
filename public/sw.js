const CACHE_NAME = 'maintenanceboard-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/login.html',
  '/rooms.html',
  '/equipment.html',
  '/interventions.html',
  '/supervision.html',
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

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'MaintenanceBoard', body: event.data?.text() || 'Nouvelle notification' };
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'MaintenanceBoard', {
      body: data.body || '',
      icon: '/assets/app-logo.svg',
      badge: '/assets/app-logo.svg',
      tag: data.tag || 'maintenanceboard',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client && client.url.includes(targetUrl)) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
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

  // Pages HTML : toujours demander au réseau d'abord pour éviter de servir une ancienne interface.
  const acceptsHtml = event.request.headers.get('accept')?.includes('text/html');
  if (acceptsHtml) {
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

  // Statiques JS/CSS : network first pour toujours servir la dernière version
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
});
