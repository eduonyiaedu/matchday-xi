"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // Browsers only re-check sw.js on their own schedule (up to 24h, per spec) — for an
        // installed PWA that's rarely closed, that can leave a fixed bug live on-device for a
        // long time. Force a check on every load instead of waiting for the browser to get to it.
        registration.update().catch(() => {});
      })
      .catch(() => {
        // Non-fatal — the app works fine without offline support.
      });

    // A new service worker only controls FUTURE navigations once activated — reload once so an
    // already-open tab picks up a fix immediately instead of needing a manual close/reopen.
    let reloaded = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  }, []);
  return null;
}
