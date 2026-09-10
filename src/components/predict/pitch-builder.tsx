"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface SquadPlayer {
  id: string;
  name: string;
  position: "GOALKEEPER" | "DEFENDER" | "MIDFIELDER" | "FORWARD";
  photoUrl: string | null;
}

interface ExistingSlot {
  slotIndex: number;
  squadPlayerId: string;
  isCorrect: boolean | null;
}

// Purely visual default 1-4-4-2 layout — slotIndex 0 is always GK; 1-10 are free-form outfield,
// this is just where they're drawn on the pitch (rulebook §4).
const SLOT_POSITIONS: { slotIndex: number; top: string; left: string }[] = [
  { slotIndex: 0, top: "92%", left: "50%" },
  { slotIndex: 1, top: "72%", left: "14%" },
  { slotIndex: 2, top: "72%", left: "38%" },
  { slotIndex: 3, top: "72%", left: "62%" },
  { slotIndex: 4, top: "72%", left: "86%" },
  { slotIndex: 5, top: "46%", left: "14%" },
  { slotIndex: 6, top: "46%", left: "38%" },
  { slotIndex: 7, top: "46%", left: "62%" },
  { slotIndex: 8, top: "46%", left: "86%" },
  { slotIndex: 9, top: "18%", left: "36%" },
  { slotIndex: 10, top: "18%", left: "64%" },
];

export function PitchBuilder({
  fixtureId,
  teamId,
  privateLeagueId = null,
  squad,
  locked,
  existingSlots,
  pointsAwarded,
  isPerfectXi,
  scored,
}: {
  fixtureId: string;
  teamId: string;
  privateLeagueId?: string | null;
  squad: SquadPlayer[];
  locked: boolean;
  existingSlots: ExistingSlot[];
  pointsAwarded: number | null;
  isPerfectXi: boolean | null;
  scored: boolean;
}) {
  const router = useRouter();
  const [slots, setSlots] = useState<Record<number, string | null>>(() => {
    const initial: Record<number, string | null> = {};
    for (let i = 0; i <= 10; i++) initial[i] = null;
    for (const s of existingSlots) initial[s.slotIndex] = s.squadPlayerId;
    return initial;
  });
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const playerById = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);
  const usedPlayerIds = useMemo(
    () => new Set(Object.values(slots).filter((v): v is string => v !== null)),
    [slots],
  );
  const isComplete = Object.values(slots).every((v) => v !== null);

  function availablePlayersFor(slotIndex: number) {
    const wantsGoalkeeper = slotIndex === 0;
    return squad.filter((p) => {
      if (usedPlayerIds.has(p.id) && slots[slotIndex] !== p.id) return false;
      return wantsGoalkeeper ? p.position === "GOALKEEPER" : p.position !== "GOALKEEPER";
    });
  }

  function selectPlayer(slotIndex: number, playerId: string) {
    setSlots((prev) => ({ ...prev, [slotIndex]: playerId }));
    setPickerSlot(null);
  }

  async function submit() {
    setSaving(true);
    const res = await fetch("/api/predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fixtureId,
        teamId,
        privateLeagueId,
        slots: Object.entries(slots).map(([slotIndex, squadPlayerId]) => ({
          slotIndex: Number(slotIndex),
          squadPlayerId,
        })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't save your prediction.");
      return;
    }
    toast.success("Prediction saved!");
    router.refresh();
  }

  const correctBySlot = new Map(existingSlots.map((s) => [s.slotIndex, s.isCorrect]));

  return (
    <div className="flex flex-col gap-4">
      {scored && pointsAwarded !== null && (
        <div className="flex items-center gap-2">
          <Badge className="text-base">{pointsAwarded} pts</Badge>
          {isPerfectXi && <Badge variant="secondary">Perfect XI! +3 bonus</Badge>}
        </div>
      )}

      <div className="relative mx-auto aspect-[2/3] w-full max-w-md rounded-lg bg-gradient-to-b from-green-600 to-green-700">
        <div className="absolute inset-4 rounded border-2 border-white/40" />
        <div className="absolute top-1/2 left-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/40" />

        {SLOT_POSITIONS.map(({ slotIndex, top, left }) => {
          const playerId = slots[slotIndex];
          const player = playerId ? playerById.get(playerId) : null;
          const isCorrect = correctBySlot.get(slotIndex);
          return (
            <button
              key={slotIndex}
              type="button"
              disabled={locked}
              onClick={() => setPickerSlot(slotIndex)}
              style={{ top, left }}
              className={cn(
                "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1",
                locked && "cursor-default",
              )}
            >
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full border-2 bg-white text-xs font-bold shadow",
                  player ? "border-slate-900" : "border-dashed border-slate-400 text-slate-400",
                  scored && isCorrect === true && "border-emerald-500 bg-emerald-100",
                  scored && isCorrect === false && "border-red-400 bg-red-50 opacity-70",
                )}
              >
                {slotIndex === 0 ? "GK" : slotIndex}
              </div>
              <span className="max-w-20 truncate rounded bg-black/60 px-1 text-[10px] text-white">
                {player ? player.name : "Pick"}
              </span>
            </button>
          );
        })}
      </div>

      {locked ? (
        existingSlots.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">
            You didn&apos;t submit a prediction before this fixture locked.
          </p>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Locked — this prediction is final.
          </p>
        )
      ) : (
        <Button size="lg" disabled={!isComplete || saving} onClick={submit}>
          {saving ? "Saving..." : "Save prediction"}
        </Button>
      )}

      <Dialog open={pickerSlot !== null} onOpenChange={(open) => !open && setPickerSlot(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{pickerSlot === 0 ? "Pick your goalkeeper" : "Pick a player"}</DialogTitle>
          </DialogHeader>
          <div className="grid max-h-96 gap-1 overflow-y-auto">
            {pickerSlot !== null &&
              availablePlayersFor(pickerSlot).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPlayer(pickerSlot, p.id)}
                  className="flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span>{p.name}</span>
                  <span className="text-xs text-muted-foreground">{p.position}</span>
                </button>
              ))}
            {pickerSlot !== null && availablePlayersFor(pickerSlot).length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">
                No eligible players left — free up a slot first.
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
