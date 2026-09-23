"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export interface PrizeWin {
  kind: "monthly" | "season";
  id: string;
  title: string;
}

/**
 * "You won!" banner on Home — stays until the winner taps "Got it", so a winner with push
 * notifications off still finds out (the push is best-effort; this isn't).
 */
export function PrizeWinBanner({ wins }: { wins: PrizeWin[] }) {
  const [visible, setVisible] = useState(wins);
  const [busy, setBusy] = useState<string | null>(null);

  async function dismiss(win: PrizeWin) {
    setBusy(win.id);
    try {
      const res = await fetch("/api/prizes/seen", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: win.kind, id: win.id }),
      });
      if (!res.ok) throw new Error();
      setVisible((prev) => prev.filter((w) => w.id !== win.id));
    } catch {
      toast.error("Couldn't update that — please try again.");
    } finally {
      setBusy(null);
    }
  }

  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      {visible.map((win) => (
        <div
          key={win.id}
          className="rounded-[14px] border-2 border-gold bg-pitch-light p-4 shadow-[0_0_30px_rgba(240,180,41,0.25)]"
        >
          <p className="font-heading text-lg leading-tight font-semibold text-gold uppercase">🏆 {win.title}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Congratulations! We&apos;ll be in touch by email about your prize.
          </p>
          <Button size="sm" className="mt-3" disabled={busy === win.id} onClick={() => dismiss(win)}>
            {busy === win.id ? "..." : "Got it"}
          </Button>
        </div>
      ))}
    </div>
  );
}
