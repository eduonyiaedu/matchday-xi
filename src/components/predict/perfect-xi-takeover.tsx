"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { TierDisc, tierFromPerfectXiCount } from "@/components/leaderboard/tier-disc";
import { ShareOverlay } from "@/components/predict/share-overlay";

interface TakeoverRow {
  pos: string;
  number: number | null;
  name: string;
}

const STAMP_DATE_OPTIONS: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

// Same fix as local-time.tsx: toLocaleDateString(undefined, ...) resolves the server's locale
// during SSR and the viewer's locale on the client, so rendering it directly here would hydrate
// mismatched. getServerSnapshot pins a UTC-formatted string for SSR/first paint; React then swaps
// to the viewer's real locale via getSnapshot once mounted.
function subscribe() {
  return () => {};
}

const CONFETTI = [
  { left: 28, color: "#F0B429", delay: 0.2, w: 7, h: 14 },
  { left: 92, color: "#6CABDD", delay: 0.6, w: 6, h: 12 },
  { left: 152, color: "#F5F3EC", delay: 0.35, w: 7, h: 13 },
  { left: 224, color: "#F0B429", delay: 0.85, w: 6, h: 14 },
  { left: 288, color: "#6CABDD", delay: 0.5, w: 7, h: 12 },
  { left: 344, color: "#F0B429", delay: 1, w: 6, h: 13 },
  { left: 60, color: "#F5F3EC", delay: 1.25, w: 5, h: 11 },
  { left: 260, color: "#F0B429", delay: 1.5, w: 5, h: 11 },
];

/**
 * Fires only when isPerfectXi. Opened as a client-side overlay from the scored pitch view
 * (not a separate route) so it reuses data already loaded there. Respects
 * prefers-reduced-motion: confetti is removed, the stamp holds its final rotation, the points
 * counter jumps straight to the total, via the mdxi* keyframes' own reduced-motion media query.
 */
export function PerfectXiTakeover({
  matchLabel,
  matchdayLabel,
  formation,
  rows,
  pointsAwarded,
  perfectXiCount,
  predictionId,
  onClose,
}: {
  matchLabel: string;
  matchdayLabel: string;
  formation: string;
  rows: TakeoverRow[];
  pointsAwarded: number;
  perfectXiCount: number;
  predictionId: string;
  onClose: () => void;
}) {
  const tier = tierFromPerfectXiCount(perfectXiCount);
  const nextTierThreshold = perfectXiCount < 5 ? 5 : perfectXiCount < 10 ? 10 : null;
  const nextTier = nextTierThreshold === 5 ? "Silver" : nextTierThreshold === 10 ? "Gold" : null;
  const untilNextTier = nextTierThreshold !== null ? nextTierThreshold - perfectXiCount : null;
  const [shareOpen, setShareOpen] = useState(false);

  // Stamped once, at the moment the celebration opens, so a re-render doesn't tick it over.
  const [openedAtIso] = useState(() => new Date().toISOString());
  const stampDate = useSyncExternalStore(
    subscribe,
    () => new Date(openedAtIso).toLocaleDateString(undefined, STAMP_DATE_OPTIONS).toUpperCase(),
    () => new Date(openedAtIso).toLocaleDateString("en-GB", { ...STAMP_DATE_OPTIONS, timeZone: "UTC" }).toUpperCase(),
  );

  return (
    <div className="fixed inset-0 z-[70] overflow-hidden bg-pitch">
      <div className="pointer-events-none absolute -top-22 -left-17 h-100 w-135 floodlight" />
      {CONFETTI.map((c, i) => (
          <div
            key={i}
            data-anim-confetti
            className="pointer-events-none absolute top-0 motion-reduce:hidden"
            style={{
              left: c.left,
              width: c.w,
              height: c.h,
              background: c.color,
              animation: `mdxiFall 7s linear infinite`,
              animationDelay: `${c.delay}s`,
            }}
          />
        ))}

      <div className="relative flex h-full flex-col px-5 pt-11 pb-6">
        <div className="text-center">
          <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">{matchdayLabel}</p>
          <p className="mt-1.5 font-heading text-lg font-semibold uppercase">{matchLabel}</p>
        </div>

        <div className="relative mt-5 rounded-[14px] bg-pitch-light p-4 pt-4.5 shadow-[0_14px_40px_rgba(0,0,0,0.5),inset_0_0_0_1px_rgba(108,171,221,0.22)]">
          <div className="flex items-center justify-between border-b border-white/12 pb-2.5">
            <span className="font-heading text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
              Your Team Sheet
            </span>
            <span className="font-mono text-[10px] text-club">{formation}</span>
          </div>
          <div className="mt-1 flex flex-col">
            {rows.map((r, i) => (
              <div
                key={i}
                className="flex items-center gap-2.5 py-1.5 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-left-2"
                style={{ animationDelay: `${0.05 + i * 0.06}s`, animationDuration: "400ms", animationFillMode: "backwards" }}
              >
                <span className="w-6 font-mono text-[10px] text-muted-foreground">{r.pos}</span>
                <span className="w-5 font-mono text-[11px] text-club">{r.number ?? ""}</span>
                <span className="flex-1 text-[13.5px] font-medium">{r.name}</span>
                <span className="text-[13px] text-gold">✓</span>
              </div>
            ))}
          </div>

          <div
            className="absolute left-1/2 top-[52%] size-50 -translate-x-1/2 -translate-y-1/2 rounded-full border-3 border-gold/60 motion-reduce:hidden"
            style={{ animation: "mdxiShock 7s ease-out infinite" }}
          />
          <div
            className="absolute top-[52%] left-1/2 w-59 -translate-x-1/2 -translate-y-1/2 motion-reduce:!rotate-[-9deg] motion-reduce:opacity-100"
            style={{ animation: "mdxiStamp 7s cubic-bezier(0.2,0.9,0.3,1) infinite" }}
          >
            <div className="rounded-lg border-4 border-gold bg-pitch/88 p-2.5 text-center shadow-[0_0_34px_rgba(240,180,41,0.32)]">
              <p className="font-heading text-[34px] leading-none font-bold tracking-[0.04em] text-gold uppercase">Perfect XI</p>
              <p className="mt-1.5 font-mono text-[9px] tracking-[0.24em] text-chalk">
                {stampDate} · 11/11
              </p>
            </div>
          </div>
        </div>

        <div className="mt-4.5 flex items-center justify-center gap-2">
          <span className="font-heading text-2xl font-semibold text-gold">+</span>
          <span className="font-mono text-3xl font-bold text-gold motion-reduce:animate-none">{pointsAwarded}</span>
          <span className="pt-1.5 font-heading text-[13px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            pts added
          </span>
        </div>

        <div className="flex-1" />

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-center gap-2 pb-1">
            <TierDisc tier={tier} size={17} />
            <span className="text-xs text-muted-foreground">
              {perfectXiCount === 1 ? "Your first Perfect XI" : `${perfectXiCount}${ordinal(perfectXiCount)} Perfect XI`}
              {nextTier && untilNextTier !== null && (
                <span className="text-chalk">
                  {" "}
                  — {untilNextTier === 1 ? "one more" : `${untilNextTier} more`} for {nextTier}
                </span>
              )}
            </span>
          </div>
          <Button size="lg" onClick={() => setShareOpen(true)}>
            Share this team sheet
          </Button>
          <button type="button" onClick={onClose} className="py-1.5 text-center text-sm text-muted-foreground">
            Back to matchday
          </button>
        </div>
      </div>

      {shareOpen && <ShareOverlay predictionId={predictionId} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] ?? s[v] ?? s[0];
}
