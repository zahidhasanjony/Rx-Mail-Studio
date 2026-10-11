const VERSION = "rx-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(["/icon.svg", "/manifest.webmanifest"])),
  );
  self.skipWaiting();
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)),
        ),
      ),
  ),
);
self.addEventListener("fetch", (event) => {
  const u = new URL(event.request.url);
  if (
    u.origin === self.location.origin &&
    ["/icon.svg", "/manifest.webmanifest"].includes(u.pathname)
  ) {
    event.respondWith(
      caches.match(event.request).then((r) => r || fetch(event.request)),
    );
  }
});
