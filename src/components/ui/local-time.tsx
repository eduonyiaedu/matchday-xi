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
// HH:MM, 24-hour, no seconds — applied to the time portion everywhere it's shown, both in the
// full date+time render below and in the GMT bracket alongside it.
const TIME_OPTIONS: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: false };
// toLocaleString only renders exactly the components it's given — the date fields have to be
// listed explicitly alongside TIME_OPTIONS, or the date portion silently disappears entirely.
const DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  ...TIME_OPTIONS,
};

export function LocalTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const date = new Date(iso);
  const utcString = dateOnly
    ? date.toLocaleDateString("en-GB", { timeZone: "UTC" })
    : date.toLocaleString("en-GB", { timeZone: "UTC", ...DATE_TIME_OPTIONS }).replace(",", "");
  const gmtClock = date.toLocaleTimeString("en-GB", { timeZone: "UTC", ...TIME_OPTIONS });

  const localString = useSyncExternalStore(
    subscribe,
    () => (dateOnly ? date.toLocaleDateString() : date.toLocaleString(undefined, DATE_TIME_OPTIONS).replace(",", "")),
    () => utcString,
  );

  return (
    <span>
      {localString} <span className="text-muted-foreground">({gmtClock} GMT)</span>
    </span>
  );
}
