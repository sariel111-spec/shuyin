const CACHE_NAME = 'cardtalk-v58-fix-reply-crash';
const ASSETS = ['./', './index.html', './manifest.json', './favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Handle notification click - focus or open the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = self.registration.scope;
  const data = event.notification.data || {};

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to find an existing tab
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) {
          client.focus();
          // Send message to navigate to the conversation
          if (data.conversationId) {
            client.postMessage({
              type: 'muxu-notification-click',
              conversationId: data.conversationId
            });
          }
          return;
        }
      }
      // No existing tab found, open a new one
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // HTML 文件使用 network-first 策略，确保总是获取最新版本
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname.endsWith('/muxu/')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request).then((cached) => cached || new Response('Offline', { status: 503 })))
    );
    return;
  }
  // 其他资源使用 cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).then((response) => {
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});
