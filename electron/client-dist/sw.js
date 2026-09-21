// Minimal service worker. Chrome requires an active service worker with a
// fetch handler before it will offer a real "Install app" option (as
// opposed to the plain "Create shortcut" window, which has no manifest/SW
// and therefore doesn't reliably support the Badging API). This one does no
// caching — it just passes every request straight through to the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
