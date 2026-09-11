"use client";

import { useSyncExternalStore } from "react";

// The external store never actually changes — this only exists so useSyncExternalStore's
// documented hydration behavior kicks in: getServerSnapshot() is used for SSR and the initial
// hydration pass (matching what the server rendered, avoiding a mismatch), then React
// automatically re-renders once more with getSnapshot()'s real client-local value.
function subscribe() {
  return () => {};
}

/**
 * Renders a timestamp in the viewer's actual local time with a "(HH:mm GMT)" bracket alongside
 * it. Server Components run on Vercel's UTC clock, so a raw `date.toLocaleString()` call there
 * silently renders UTC, not the viewer's real timezone — this component fixes that.
 */
export function LocalTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const date = new Date(iso);
  const utcString = dateOnly
    ? date.toLocaleDateString("en-GB", { timeZone: "UTC" })
    : date.toLocaleString("en-GB", { timeZone: "UTC" });
  const gmtClock = date.toLocaleTimeString("en-GB", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const localString = useSyncExternalStore(
    subscribe,
    () => (dateOnly ? date.toLocaleDateString() : date.toLocaleString()),
    () => utcString,
  );

  return (
    <span>
      {localString} <span className="text-muted-foreground">({gmtClock} GMT)</span>
    </span>
  );
}
