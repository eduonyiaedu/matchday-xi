// Matchday XI service worker — deliberately minimal. This app's data (fixtures, locks, scores)
// changes in real time, so we do NOT cache-first any page or API response: that would risk
// showing a user a stale "still open" prediction after it's actually locked. All this SW does is
// (a) make the app installable/full-screen and (b) show a friendly offline page instead of the
// browser's default error when there's no network at all.

const CACHE_NAME = "matchday-xi-shell-v1";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([OFFLINE_URL])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.open(CACHE_NAME).then((cache) => cache.match(OFFLINE_URL)),
    ),
  );
});
