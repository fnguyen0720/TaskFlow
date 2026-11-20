// TaskFlow's first installable release is online-only by design.
// Never cache API requests, authenticated HTML, tokens, or user task data.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  if (event.request.method === "GET" && event.request.mode === "navigate") {
    event.respondWith(fetch(event.request));
  }
});
