"use client";

import { useState } from "react";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
import { LocalTime } from "@/components/ui/local-time";
import { TeamPicker } from "@/components/team/team-picker";

interface TeamOption {
  id: string;
  name: string;
  shortName: string | null;
  crestUrl: string | null;
  externalId: number;
}

export function HomeAvatar({
  initials,
  teamName,
  teamId,
  lockedAt,
  teams,
}: {
  initials: string;
  teamName: string;
  teamId: string | null;
  lockedAt: string | null;
  teams: TeamOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-club font-heading text-xs font-bold text-pitch shadow-[0_0_0_2px_rgba(108,171,221,0.25)]"
      >
        {initials}
      </button>
      <BottomSheet open={open} onOpenChange={setOpen}>
        <BottomSheetContent heightClassName={lockedAt ? "h-auto max-h-[85vh]" : "h-[80vh]"}>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10.5 items-center justify-center rounded-full bg-club font-heading text-sm font-bold text-pitch">
                {initials}
              </div>
              <div>
                <BottomSheetTitle>{teamName}</BottomSheetTitle>
                {lockedAt ? (
                  <p className="mt-0.5 font-mono text-[10px] tracking-[0.1em] text-gold">
                    LOCKED <LocalTime iso={lockedAt} dateOnly />
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-muted-foreground">Not locked yet</p>
                )}
              </div>
            </div>
            {lockedAt ? (
              <>
                <p className="text-sm text-chalk">
                  Your club locked when your first prediction locked. Every point and Perfect XI
                  you&apos;ve earned belongs to this club, so it stays put for the season.
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-[11px] py-3.5 text-center font-heading text-sm font-semibold tracking-[0.06em] uppercase shadow-[inset_0_0_0_1px_rgba(245,243,236,0.18)]"
                >
                  Got it
                </button>
              </>
            ) : (
              <>
                <p className="text-sm text-chalk">
                  You can switch clubs freely until your first prediction locks. Pick a new one below.
                </p>
                <TeamPicker teams={teams} initialTeamId={teamId} onSuccess={() => setOpen(false)} />
              </>
            )}
          </div>
        </BottomSheetContent>
      </BottomSheet>
    </>
  );
}
