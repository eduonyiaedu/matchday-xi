"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BottomSheet, BottomSheetContent, BottomSheetTitle } from "@/components/ui/bottom-sheet";
import { TeamPicker } from "@/components/team/team-picker";

interface TeamOption {
  id: string;
  name: string;
  shortName: string | null;
  crestUrl: string | null;
  externalId: number;
}

/**
 * New-season "keep or change your club?" card on Home (lib/new-season.ts). Shown to returning
 * players until they answer or make their first prediction of the season (which locks the club).
 */
export function NewSeasonClubPrompt({
  seasonLabel,
  teamName,
  teamId,
  teams,
}: {
  seasonLabel: string;
  teamName: string;
  teamId: string;
  teams: TeamOption[];
}) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function keep() {
    setBusy(true);
    try {
      const res = await fetch("/api/teams/keep", { method: "POST" });
      if (!res.ok) throw new Error();
      setHidden(true);
      router.refresh();
    } catch {
      toast.error("Couldn't save that — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (hidden) return null;

  return (
    <div className="rounded-[14px] border-2 border-gold bg-pitch-light p-4 shadow-[0_0_30px_rgba(240,180,41,0.25)]">
      <p className="font-heading text-lg leading-tight font-semibold text-gold uppercase">
        ⚽ The {seasonLabel} season is here
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        Keep supporting {teamName}, or switch clubs for the new season. Your club locks with your first prediction.
      </p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={busy} onClick={keep}>
          {busy ? "..." : `Keep ${teamName}`}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPickerOpen(true)}>
          Change club
        </Button>
      </div>

      <BottomSheet open={pickerOpen} onOpenChange={setPickerOpen}>
        <BottomSheetContent heightClassName="h-[80vh]">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-6">
            <BottomSheetTitle>Your club for {seasonLabel}</BottomSheetTitle>
            <TeamPicker
              teams={teams}
              initialTeamId={teamId}
              onSuccess={() => {
                setPickerOpen(false);
                setHidden(true);
              }}
            />
          </div>
        </BottomSheetContent>
      </BottomSheet>
    </div>
  );
}
