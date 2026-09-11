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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Jersey } from "@/components/predict/jersey";
import { cn } from "@/lib/utils";

interface SquadPlayer {
  id: string;
  name: string;
  position: "GOALKEEPER" | "DEFENDER" | "MIDFIELDER" | "FORWARD";
  shirtNumber: number | null;
  squadTier: "SENIOR" | "U21";
  photoUrl: string | null;
}

interface ExistingSlot {
  slotIndex: number;
  squadPlayerId: string;
  isCorrect: boolean | null;
}

export const FORMATIONS = ["4-4-2", "4-3-3", "4-2-3-1", "3-4-3"] as const;
export type Formation = (typeof FORMATIONS)[number];

interface SlotPosition {
  slotIndex: number;
  top: string;
  left: string;
}

// Purely visual layouts — slotIndex 0 is always GK; 1-10 are free-form outfield regardless of
// formation. Switching formations only redraws where each slotIndex is drawn on the pitch, it
// never reassigns which player occupies which slot, so scoring (player-identity only, see
// lib/scoring.ts) is completely unaffected by this choice.
const FORMATION_LAYOUTS: Record<Formation, SlotPosition[]> = {
  "4-4-2": [
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
  ],
  "4-3-3": [
    { slotIndex: 0, top: "92%", left: "50%" },
    { slotIndex: 1, top: "72%", left: "14%" },
    { slotIndex: 2, top: "72%", left: "38%" },
    { slotIndex: 3, top: "72%", left: "62%" },
    { slotIndex: 4, top: "72%", left: "86%" },
    { slotIndex: 5, top: "50%", left: "25%" },
    { slotIndex: 6, top: "50%", left: "50%" },
    { slotIndex: 7, top: "50%", left: "75%" },
    { slotIndex: 8, top: "20%", left: "20%" },
    { slotIndex: 9, top: "20%", left: "50%" },
    { slotIndex: 10, top: "20%", left: "80%" },
  ],
  "4-2-3-1": [
    { slotIndex: 0, top: "92%", left: "50%" },
    { slotIndex: 1, top: "74%", left: "14%" },
    { slotIndex: 2, top: "74%", left: "38%" },
    { slotIndex: 3, top: "74%", left: "62%" },
    { slotIndex: 4, top: "74%", left: "86%" },
    { slotIndex: 5, top: "56%", left: "35%" },
    { slotIndex: 6, top: "56%", left: "65%" },
    { slotIndex: 7, top: "36%", left: "20%" },
    { slotIndex: 8, top: "36%", left: "50%" },
    { slotIndex: 9, top: "36%", left: "80%" },
    { slotIndex: 10, top: "16%", left: "50%" },
  ],
  "3-4-3": [
    { slotIndex: 0, top: "92%", left: "50%" },
    { slotIndex: 1, top: "74%", left: "25%" },
    { slotIndex: 2, top: "74%", left: "50%" },
    { slotIndex: 3, top: "74%", left: "75%" },
    { slotIndex: 4, top: "50%", left: "14%" },
    { slotIndex: 5, top: "50%", left: "38%" },
    { slotIndex: 6, top: "50%", left: "62%" },
    { slotIndex: 7, top: "50%", left: "86%" },
    { slotIndex: 8, top: "20%", left: "20%" },
    { slotIndex: 9, top: "20%", left: "50%" },
    { slotIndex: 10, top: "20%", left: "80%" },
  ],
};

const OUTFIELD_POSITION_LABELS: { position: SquadPlayer["position"]; label: string }[] = [
  { position: "DEFENDER", label: "Defenders" },
  { position: "MIDFIELDER", label: "Midfielders" },
  { position: "FORWARD", label: "Forwards" },
];

export function PitchBuilder({
  fixtureId,
  teamId,
  privateLeagueId = null,
  squad,
  locked,
  existingSlots,
  initialFormation = "4-4-2",
  teamColors,
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
  initialFormation?: Formation;
  teamColors: { primary: string; secondary: string };
  pointsAwarded: number | null;
  isPerfectXi: boolean | null;
  scored: boolean;
}) {
  const router = useRouter();
  const [formation, setFormation] = useState<Formation>(initialFormation);
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

  // Senior players grouped by position first (GK slot: just goalkeepers, no sub-groups needed),
  // followed by a single separate "Under 21" section — not further subgrouped by position.
  function groupedPlayersFor(slotIndex: number): { label: string; players: SquadPlayer[] }[] {
    const available = availablePlayersFor(slotIndex);
    const senior = available.filter((p) => p.squadTier === "SENIOR");
    const u21 = available.filter((p) => p.squadTier === "U21");

    const groups: { label: string; players: SquadPlayer[] }[] = [];
    if (slotIndex === 0) {
      if (senior.length > 0) groups.push({ label: "Goalkeepers", players: senior });
    } else {
      for (const { position, label } of OUTFIELD_POSITION_LABELS) {
        const players = senior.filter((p) => p.position === position);
        if (players.length > 0) groups.push({ label, players });
      }
    }
    if (u21.length > 0) groups.push({ label: "Under 21", players: u21 });
    return groups;
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
        formation,
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
  const slotPositions = FORMATION_LAYOUTS[formation];

  return (
    <div className="flex flex-col gap-4">
      {scored && pointsAwarded !== null && (
        <div className="flex items-center gap-2">
          <Badge className="text-base">{pointsAwarded} pts</Badge>
          {isPerfectXi && <Badge variant="secondary">Perfect XI! +3 bonus</Badge>}
        </div>
      )}

      {!locked && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Formation</span>
          <Select value={formation} onValueChange={(v) => setFormation(v as Formation)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FORMATIONS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">Visual only — doesn&apos;t affect scoring.</span>
        </div>
      )}

      <div className="relative mx-auto aspect-[2/3] w-full max-w-md rounded-lg bg-gradient-to-b from-green-600 to-green-700">
        <div className="absolute inset-4 rounded border-2 border-white/40" />
        <div className="absolute top-1/2 left-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/40" />

        {slotPositions.map(({ slotIndex, top, left }) => {
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
                  "flex items-center justify-center rounded-full",
                  scored && isCorrect === true && "ring-2 ring-emerald-500",
                  scored && isCorrect === false && "opacity-70 ring-2 ring-red-400",
                )}
              >
                <Jersey
                  primary={teamColors.primary}
                  secondary={teamColors.secondary}
                  number={player?.shirtNumber ?? null}
                  empty={!player}
                />
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
              groupedPlayersFor(pickerSlot).map((group) => (
                <div key={group.label} className="flex flex-col gap-0.5">
                  <p className="mt-2 px-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase first:mt-0">
                    {group.label}
                  </p>
                  {group.players.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectPlayer(pickerSlot, p.id)}
                      className="flex items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <span className="flex items-center gap-2">
                        {p.name}
                        {p.shirtNumber != null && (
                          <span className="text-xs text-muted-foreground">#{p.shirtNumber}</span>
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">{p.position}</span>
                    </button>
                  ))}
                </div>
              ))}
            {pickerSlot !== null && groupedPlayersFor(pickerSlot).length === 0 && (
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
