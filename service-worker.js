// v6.5 no-cache service worker for KCB Minerals Ledger Pro
self.addEventListener("install", event => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  event.respondWith(fetch(event.request, { cache: "no-store" }).catch(() => fetch(event.request)));
});
