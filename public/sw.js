/* Borga service worker: Web Push tray only (no caching, no offline shell).
 * Served from /sw.js so its scope is the whole origin. Self-contained on
 * purpose: no imports, no build step, nothing for CSP to argue about. */

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Borga';
  const body = typeof data.body === 'string' ? data.body : '';
  const tag = typeof data.tag === 'string' && data.tag ? data.tag : 'borga-notice';
  const url = typeof data.url === 'string' && data.url ? data.url : '/app';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag,
      data: { url },
      renotify: true,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const url = typeof raw === 'string' && raw ? raw : '/app';
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        try {
          const u = new URL(w.url);
          if (u.pathname === '/app' || u.pathname.startsWith('/app/')) {
            await w.focus();
            return;
          }
        } catch {
          /* ignore unparseable client urls */
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
