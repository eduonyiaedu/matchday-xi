"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
import { getTeamColors } from "@/lib/team-colors";
import { cn } from "@/lib/utils";

interface TeamOption {
  id: string;
  name: string;
  shortName: string | null;
  crestUrl: string | null;
  externalId: number;
}

function initialsFor(team: TeamOption): string {
  return (team.shortName ?? team.name).slice(0, 3).toUpperCase();
}

export function TeamPicker({
  teams,
  initialTeamId,
  onSuccess,
}: {
  teams: TeamOption[];
  /** Pre-highlight the user's current club, e.g. when switching rather than picking for the first time. */
  initialTeamId?: string | null;
  /** Called after a successful switch instead of navigating to /home — e.g. to close a host sheet in place. */
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(initialTeamId ?? null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = teams.find((t) => t.id === selectedId) ?? null;

  async function confirm() {
    if (!selectedId) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/teams/change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: selectedId }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong.");
      return;
    }
    setConfirmOpen(false);
    if (onSuccess) {
      onSuccess();
    } else {
      router.push("/home");
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-2.5">
        {teams.map((team) => {
          const colors = getTeamColors(team.externalId);
          const sel = selectedId === team.id;
          return (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedId(team.id)}
              className={cn(
                "flex min-h-11 flex-col items-center gap-2 rounded-xl p-3 transition-shadow",
                !sel && "bg-pitch-light shadow-[inset_0_0_0_1px_rgba(245,243,236,0.07)]",
              )}
              style={
                sel
                  ? { backgroundColor: `${colors.primary}24`, boxShadow: `inset 0 0 0 2px ${colors.primary}` }
                  : undefined
              }
            >
              <div
                className="flex size-8.5 items-center justify-center rounded-full font-heading text-[11px] font-bold"
                style={{ backgroundColor: colors.primary, color: colors.secondary }}
              >
                {initialsFor(team)}
              </div>
              <span className="text-center font-heading text-[11px] leading-tight font-medium tracking-[0.02em] uppercase">
                {team.shortName ?? team.name}
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="lg" disabled={!selectedId} onClick={() => setConfirmOpen(true)}>
        {selected ? `Confirm ${selected.name}` : "Pick a club"}
      </Button>

      <BottomSheet open={confirmOpen} onOpenChange={setConfirmOpen}>
        <BottomSheetContent>
          {selected && (
            <div className="flex flex-col gap-4 px-5 pb-6">
              <div className="flex items-center gap-3">
                <div
                  className="flex size-11 items-center justify-center rounded-full font-heading text-sm font-bold"
                  style={{
                    backgroundColor: getTeamColors(selected.externalId).primary,
                    color: getTeamColors(selected.externalId).secondary,
                  }}
                >
                  {initialsFor(selected)}
                </div>
                <div>
                  <BottomSheetTitle>{selected.name}</BottomSheetTitle>
                  <p className="mt-0.5 text-xs text-muted-foreground">Your club for the season</p>
                </div>
              </div>
              <p className="text-sm text-chalk">
                You can switch clubs freely until your first prediction. After that it&apos;s locked
                for the season — points and Perfect XIs stay tied to this club.
              </p>
              <Button size="lg" disabled={submitting} onClick={confirm}>
                {submitting ? "Saving..." : "Lock it in"}
              </Button>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="py-2 text-center text-sm text-muted-foreground"
              >
                Not yet
              </button>
            </div>
          )}
        </BottomSheetContent>
      </BottomSheet>
    </div>
  );
}
