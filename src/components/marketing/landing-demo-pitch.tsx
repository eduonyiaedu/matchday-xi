"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

// Purely cosmetic — hardcoded demo squad + a baked-in reference lineup to "score" against on
// completion. No backend calls, no relation to any real account or fixture.
const DEMO_LAYOUT = [
  { top: "92%", left: "50%" },
  { top: "72%", left: "14%" },
  { top: "72%", left: "38%" },
  { top: "72%", left: "62%" },
  { top: "72%", left: "86%" },
  { top: "46%", left: "14%" },
  { top: "46%", left: "38%" },
  { top: "46%", left: "62%" },
  { top: "46%", left: "86%" },
  { top: "18%", left: "36%" },
  { top: "18%", left: "64%" },
];

// The "real" XI this demo scores against once all 11 slots are filled — indices that come up
// short of a perfect score just make the demo feel real, not a rigged win every time.
const REFERENCE_CORRECT = new Set([0, 1, 2, 4, 5, 6, 8, 9]);

export function LandingDemoPitch() {
  const [filled, setFilled] = useState<Record<number, boolean>>({});
  const [scored, setScored] = useState(false);
  const count = Object.values(filled).filter(Boolean).length;
  const isComplete = count === 11;

  function toggle(i: number) {
    if (scored) return;
    setFilled((prev) => ({ ...prev, [i]: !prev[i] }));
  }

  const correctCount = scored ? [...Array(11).keys()].filter((i) => REFERENCE_CORRECT.has(i)).length : 0;

  return (
    <div className="mt-5.5 rounded-2xl bg-pitch-light p-3.5 shadow-[0_12px_34px_rgba(0,0,0,0.45),inset_0_0_0_1px_rgba(108,171,221,0.2)]">
      <div className="flex items-center justify-between pb-2.5">
        <span className="font-heading text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          Try it — Man City vs Arsenal
        </span>
        <span className="font-mono text-[10px] text-gold">{scored ? "11/11" : `${count}/11`}</span>
      </div>
      <div className="relative h-62.5 overflow-hidden rounded-[10px] turf shadow-[inset_0_0_0_1.5px_rgba(245,243,236,0.18)]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(245,243,236,0.14),rgba(11,31,23,0)_60%)]" />
        <div className="absolute top-1/2 left-1/2 size-16.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/18" />
        {DEMO_LAYOUT.map((pos, i) => {
          const isFilled = !!filled[i];
          const isRight = scored && REFERENCE_CORRECT.has(i) === isFilled;
          return (
            <button
              key={i}
              type="button"
              onClick={() => toggle(i)}
              style={{ top: pos.top, left: pos.left }}
              className={cn(
                "absolute flex size-6.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-lg text-[12px] text-pitch",
                scored
                  ? isRight
                    ? "bg-gold"
                    : "bg-white/15 text-transparent"
                  : isFilled
                    ? "bg-club"
                    : "bg-pitch/35 shadow-[inset_0_0_0_1.5px_rgba(245,243,236,0.35)]",
              )}
            >
              {(scored ? isRight : isFilled) ? "✓" : ""}
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 text-center text-xs text-muted-foreground">
        {scored ? `Scored ${correctCount}/11 against the real XI — sign up to make it count.` : isComplete ? "Tap to score it against the real XI →" : "Tap the slots to build a lineup"}
      </p>
      {isComplete && !scored && (
        <button
          type="button"
          onClick={() => setScored(true)}
          className="mt-2 w-full rounded-[9px] py-2 text-center font-heading text-xs font-semibold tracking-[0.06em] text-gold uppercase shadow-[inset_0_0_0_1px_rgba(240,180,41,0.35)]"
        >
          Score it
        </button>
      )}
    </div>
  );
}
