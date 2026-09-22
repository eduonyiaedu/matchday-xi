"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetTitle,
} from "@/components/ui/bottom-sheet";
import { Jersey } from "@/components/predict/jersey";
import { PerfectXiTakeover } from "@/components/predict/perfect-xi-takeover";
import { ShareOverlay } from "@/components/predict/share-overlay";
import { cn } from "@/lib/utils";
import { FORMATIONS, FORMATION_LAYOUTS, type Formation } from "@/lib/formations";

interface SquadPlayer {
  id: string;
  name: string;
  position: "GOALKEEPER" | "DEFENDER" | "MIDFIELDER" | "FORWARD";
  shirtNumber: number | null;
  squadTier: "SENIOR" | "U21";
  photoUrl: string | null;
  /** "Started last 5" — oldest to newest, derived from stored official lineups. */
  form: boolean[];
}

interface ExistingSlot {
  slotIndex: number;
  squadPlayerId: string;
  isCorrect: boolean | null;
}

interface OfficialStarter {
  squadPlayerId: string | null;
  name: string;
  shirtNumber: number | null;
  isGoalkeeper: boolean;
}

const OUTFIELD_POSITION_LABELS: { position: SquadPlayer["position"]; label: string }[] = [
  { position: "DEFENDER", label: "Defenders" },
  { position: "MIDFIELDER", label: "Midfielders" },
  { position: "FORWARD", label: "Forwards" },
];

const LONG_PRESS_MS = 380;

function FormDots({ form }: { form: boolean[] }) {
  return (
    <span className="flex gap-[3px]">
      {form.map((started, i) => (
        <span
          key={i}
          className={cn("size-[5px] rounded-full", started ? "bg-gold" : "bg-white/18")}
        />
      ))}
    </span>
  );
}

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
  officialLineup,
  matchLabel,
  matchdayLabel,
  perfectXiCount,
  predictionId,
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
  /** Only passed once scored — the confirmed XI, used for the "who started instead" reveal. */
  officialLineup?: OfficialStarter[];
  /** The following four are only needed when isPerfectXi (feed the takeover celebration). */
  matchLabel?: string;
  matchdayLabel?: string;
  perfectXiCount?: number;
  predictionId?: string;
}) {
  const router = useRouter();
  const [formation, setFormation] = useState<Formation>(initialFormation);
  const [takeoverOpen, setTakeoverOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [slots, setSlots] = useState<Record<number, string | null>>(() => {
    const initial: Record<number, string | null> = {};
    for (let i = 0; i <= 10; i++) initial[i] = null;
    for (const s of existingSlots) initial[s.slotIndex] = s.squadPlayerId;
    return initial;
  });
  const [drawerSlot, setDrawerSlot] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [statPlayerId, setStatPlayerId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Record<number, boolean>>({});
  const [saving, setSaving] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A completed long-press still ends in a trailing click (fired on mouseup/touchend) — without
  // this, opening the stat card also immediately opens the picker drawer on top of it.
  const longPressFiredRef = useRef(false);

  const playerById = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);
  const usedPlayerIds = useMemo(
    () => new Set(Object.values(slots).filter((v): v is string => v !== null)),
    [slots],
  );
  const filled = Object.values(slots).filter(Boolean).length;
  const isComplete = filled === 11;

  function availablePlayersFor(slotIndex: number) {
    const wantsGoalkeeper = slotIndex === 0;
    return squad.filter((p) => {
      if (usedPlayerIds.has(p.id) && slots[slotIndex] !== p.id) return false;
      return wantsGoalkeeper ? p.position === "GOALKEEPER" : p.position !== "GOALKEEPER";
    });
  }

  function groupedPlayersFor(slotIndex: number): { label: string; players: SquadPlayer[] }[] {
    const q = query.trim().toLowerCase();
    const available = availablePlayersFor(slotIndex).filter(
      (p) => !q || p.name.toLowerCase().includes(q) || String(p.shirtNumber ?? "").includes(q),
    );
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
    setDrawerSlot(null);
    setQuery("");
  }

  function clearSlot(slotIndex: number) {
    setSlots((prev) => ({ ...prev, [slotIndex]: null }));
    setDrawerSlot(null);
    setQuery("");
  }

  function handlePressStart(playerId: string | null) {
    if (!playerId) return;
    longPressFiredRef.current = false;
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      longPressFiredRef.current = true;
      setStatPlayerId(playerId);
    }, LONG_PRESS_MS);
  }
  function handlePressEnd() {
    clearTimeout(pressTimer.current);
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
  const statPlayer = statPlayerId ? playerById.get(statPlayerId) : null;
  // A scored fixture the user never predicted for at all (visible via the history list, which now
  // surfaces these instead of skipping them) — pointsAwarded is null since there's no Prediction
  // row, but it's honestly 0, not "nothing to show."
  const noSubmission = scored && existingSlots.length === 0;
  const displayPoints = pointsAwarded ?? (noSubmission ? 0 : null);

  // "Who else started" reveal — no true positional mapping exists (outfield slots are
  // free-form), so this pairs each miss with an official starter not already matched to one of
  // the user's correct picks, by iteration order. An honest "who else played," not a claim about
  // a specific tactical swap.
  const revealFor = useMemo(() => {
    if (!scored || !officialLineup) return new Map<number, OfficialStarter>();

    // No prediction was ever submitted for this fixture — every slot is a "miss" by definition,
    // not just the ones existingSlots would normally mark isCorrect===false (existingSlots is
    // empty here, so there's nothing to check against). Pair the flagged goalkeeper with slot 0
    // and everyone else in order, same honest "who else played" framing as the real reveal below.
    if (existingSlots.length === 0) {
      const goalkeeper = officialLineup.find((p) => p.isGoalkeeper);
      const others = officialLineup.filter((p) => p !== goalkeeper);
      const map = new Map<number, OfficialStarter>();
      if (goalkeeper) map.set(0, goalkeeper);
      others.forEach((p, i) => map.set(i + 1, p));
      return map;
    }

    const correctIds = new Set(
      existingSlots.filter((s) => s.isCorrect).map((s) => s.squadPlayerId),
    );
    const unclaimed = officialLineup.filter((p) => !p.squadPlayerId || !correctIds.has(p.squadPlayerId));
    const missedSlotIndices = existingSlots
      .filter((s) => s.isCorrect === false)
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((s) => s.slotIndex);
    const map = new Map<number, OfficialStarter>();
    missedSlotIndices.forEach((slotIdx, i) => {
      if (unclaimed[i]) map.set(slotIdx, unclaimed[i]);
    });
    return map;
  }, [scored, officialLineup, existingSlots]);

  function renderSquadList(forSlot: number | null) {
    if (forSlot === null) {
      return <p className="p-4 text-sm text-muted-foreground">Tap a pitch slot to pick a player.</p>;
    }
    const groups = groupedPlayersFor(forSlot);
    const currentPlayerId = slots[forSlot];
    return (
      <>
        <div className="px-4 pb-2.5">
          <div className="flex items-center justify-between">
            <p className="font-heading text-[17px] font-semibold uppercase">
              {forSlot === 0 ? "Pick your keeper" : "Pick a player"}
            </p>
          </div>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the squad"
            className="mt-2.5 w-full rounded-[9px] bg-pitch px-3 py-2.5 text-sm text-chalk shadow-[inset_0_0_0_1px_rgba(245,243,236,0.12)] outline-none"
          />
          {currentPlayerId && (
            <button
              type="button"
              onClick={() => clearSlot(forSlot)}
              className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-[9px] py-2.5 font-heading text-[13px] font-semibold tracking-[0.06em] text-destructive uppercase shadow-[inset_0_0_0_1px_rgba(200,16,46,0.4)]"
            >
              Remove {playerById.get(currentPlayerId)?.name}
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2.5 pb-4">
          {groups.map((group) => (
            <div key={group.label} className="mb-2">
              <p className="mt-2.5 mb-1 px-2 font-mono text-[9px] tracking-[0.18em] text-muted-foreground uppercase">
                {group.label}
              </p>
              {group.players.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPlayer(forSlot, p.id)}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-white/5"
                >
                  <span className="w-6 font-mono text-[11px] text-club">{p.shirtNumber ?? ""}</span>
                  <span className="flex-1 text-[13.5px] font-medium">{p.name}</span>
                  <FormDots form={p.form} />
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">No eligible players left — free up a slot first.</p>
          )}
        </div>
      </>
    );
  }

  const saveButton = (
    <Button
      size="lg"
      className="w-full"
      variant={isComplete ? "default" : "secondary"}
      disabled={!isComplete || saving}
      onClick={submit}
    >
      {saving ? "Saving..." : isComplete ? "Save prediction" : `Pick ${11 - filled} more`}
    </Button>
  );

  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
      <div className="flex flex-1 flex-col gap-4">
        {scored && displayPoints !== null && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-center">
              <p className="font-heading text-4xl font-semibold text-gold">+{displayPoints}</p>
              <p className="font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">Points</p>
            </div>
            {noSubmission && (
              <p className="text-sm text-muted-foreground">
                You didn&apos;t submit a prediction — here&apos;s who started.
              </p>
            )}
            {isPerfectXi && (
              <Button variant="outline" size="sm" onClick={() => setTakeoverOpen(true)}>
                See the Perfect XI moment
              </Button>
            )}
            {predictionId && (
              <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
                Share your lineup
              </Button>
            )}
          </div>
        )}

        {!locked && (
          <div className="flex items-center gap-2.5">
            <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full transition-[width] duration-300 ease-out"
                style={{
                  width: `${(filled / 11) * 100}%`,
                  background: `linear-gradient(90deg, var(--club), ${teamColors.primary})`,
                }}
              />
            </div>
            <span className="font-mono text-xs font-bold text-gold">{filled}/11</span>
          </div>
        )}

        {!locked && (
          <div className="flex gap-1.5 overflow-x-auto">
            {FORMATIONS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFormation(f)}
                className={cn(
                  "shrink-0 rounded-full px-3 py-2 font-mono text-[11px] tracking-[0.06em] whitespace-nowrap",
                  formation === f
                    ? "font-bold text-pitch"
                    : "text-muted-foreground shadow-[inset_0_0_0_1px_rgba(245,243,236,0.14)]",
                )}
                style={formation === f ? { backgroundColor: teamColors.primary } : undefined}
              >
                {f}
              </button>
            ))}
          </div>
        )}

        <div className="relative aspect-2/3 overflow-hidden rounded-[14px] shadow-[inset_0_0_0_1.5px_rgba(245,243,236,0.16)] turf">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-6%,rgba(245,243,236,0.16),rgba(11,31,23,0)_58%)]" />
          <div className="absolute inset-3 rounded border border-white/18" />
          <div className="absolute inset-x-0 top-1/2 h-px bg-white/18" />
          <div className="absolute top-1/2 left-1/2 size-21 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/18" />
          <div className="absolute bottom-3 left-1/2 h-13 w-33 -translate-x-1/2 border border-b-0 border-white/18" />
          <div className="absolute top-3 left-1/2 h-13 w-33 -translate-x-1/2 border border-t-0 border-white/18" />

          {slotPositions.map(({ slotIndex, top, left }) => {
            const playerId = slots[slotIndex];
            const player = playerId ? playerById.get(playerId) : null;
            const isCorrect = correctBySlot.get(slotIndex);
            const reveal = revealed[slotIndex] ? revealFor.get(slotIndex) : undefined;
            const shownName = reveal ? reveal.name : player ? player.name.split(" ").slice(-1)[0] : slotIndex === 0 ? "GK" : "Pick";
            const shownNumber = reveal ? reveal.shirtNumber : (player?.shirtNumber ?? null);
            return (
              <button
                key={slotIndex}
                type="button"
                disabled={scored ? isCorrect === true : locked}
                onClick={() => {
                  if (longPressFiredRef.current) {
                    longPressFiredRef.current = false;
                    return;
                  }
                  if (scored) {
                    // isCorrect is undefined (not false) for a slot from a never-submitted
                    // prediction — treat that the same as an explicit miss, not like a correct
                    // pick, so the reveal toggle still works with zero submitted slots.
                    if (isCorrect !== true) setRevealed((r) => ({ ...r, [slotIndex]: !r[slotIndex] }));
                    return;
                  }
                  if (!locked) setDrawerSlot(slotIndex);
                }}
                onMouseDown={() => !scored && !locked && handlePressStart(playerId)}
                onMouseUp={handlePressEnd}
                onMouseLeave={handlePressEnd}
                onTouchStart={() => !scored && !locked && handlePressStart(playerId)}
                onTouchEnd={handlePressEnd}
                style={{ top, left, transitionProperty: "top,left", transitionDuration: "340ms" }}
                className={cn(
                  "absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 transition-[top,left] ease-[cubic-bezier(0.3,0.8,0.3,1)] select-none",
                  locked && !scored && "cursor-default",
                )}
              >
                <div
                  className={cn(
                    "rounded-xl",
                    scored && isCorrect === true && "shadow-[0_0_0_2px_var(--gold)]",
                    scored && isCorrect !== true && !reveal && "opacity-70",
                    !scored && !player && !locked && "mdxi-pulse rounded-[11px]",
                    !scored && player && "motion-safe:animate-[mdxiPop_260ms_cubic-bezier(0.2,0.9,0.3,1)]",
                  )}
                  style={!scored && !player ? ({ "--pulse-color": teamColors.primary } as React.CSSProperties) : undefined}
                >
                  <Jersey
                    primary={reveal ? "#F5F3EC" : teamColors.primary}
                    secondary={reveal ? "#0B1F17" : teamColors.secondary}
                    number={shownNumber}
                    empty={!player && !reveal}
                  />
                </div>
                <span
                  className={cn(
                    "max-w-20 truncate rounded bg-black/60 px-1.5 py-0.5 text-[10px]",
                    player || reveal ? "font-medium text-chalk" : "font-mono tracking-[0.08em] text-chalk/70",
                  )}
                >
                  {shownName}
                </span>
                {scored && isCorrect !== true && (
                  <span className="font-mono text-[7.5px] tracking-[0.14em] text-chalk/40 uppercase">
                    {reveal ? "Started" : "Tap"}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {locked ? (
          existingSlots.length === 0 && !scored ? (
            <p className="text-center text-sm text-muted-foreground">
              You didn&apos;t submit a prediction before this fixture locked.
            </p>
          ) : !scored ? (
            <div className="flex flex-col items-center gap-2.5">
              <p className="text-center text-sm text-muted-foreground">Locked — this prediction is final.</p>
              {predictionId && (
                <Button variant="outline" size="sm" onClick={() => setShareOpen(true)}>
                  Share your predicted XI
                </Button>
              )}
            </div>
          ) : null
        ) : (
          <div className="md:hidden">{saveButton}</div>
        )}
        {!locked && (
          <p className="text-center text-xs text-muted-foreground">
            Formation is cosmetic — only who you pick scores. Long-press a shirt for form.
          </p>
        )}
      </div>

      {!locked && (
        <>
          {/* Mobile: bottom-sheet drawer. Non-modal — the squad list also renders live in the
              desktop sidebar below, and Radix's modal body-lock (pointer-events: none on <body>)
              would freeze that sidebar too since it sits outside this dialog's own DOM subtree. */}
          <BottomSheet open={drawerSlot !== null} onOpenChange={(open) => !open && setDrawerSlot(null)} modal={false}>
            <BottomSheetContent heightClassName="h-[62vh]" className="flex md:hidden" overlayClassName="md:hidden">
              <BottomSheetTitle className="sr-only">Pick a player</BottomSheetTitle>
              {renderSquadList(drawerSlot)}
            </BottomSheetContent>
          </BottomSheet>

          {/* Desktop: always-visible sidebar */}
          <div className="hidden md:flex md:w-80 md:shrink-0 md:flex-col md:gap-3 md:rounded-[14px] md:bg-pitch-light md:pt-4 md:shadow-[inset_0_0_0_1px_rgba(245,243,236,0.06)]">
            <div className="flex max-h-125 flex-1 flex-col">{renderSquadList(drawerSlot)}</div>
            <div className="px-4 pb-4">{saveButton}</div>
          </div>
        </>
      )}

      <Dialog open={!!statPlayer} onOpenChange={(open) => !open && setStatPlayerId(null)}>
        <DialogContent>
          {statPlayer && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <div
                    className="flex size-11 items-center justify-center rounded-[10px] font-mono text-base font-bold"
                    style={{ backgroundColor: teamColors.primary, color: teamColors.secondary }}
                  >
                    {statPlayer.shirtNumber ?? ""}
                  </div>
                  <div>
                    <DialogTitle>{statPlayer.name}</DialogTitle>
                    <p className="mt-0.5 font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
                      {statPlayer.position}
                      {statPlayer.squadTier === "U21" ? " · U21" : ""}
                    </p>
                  </div>
                </div>
              </DialogHeader>
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <span className="text-xs text-muted-foreground">Started last 5</span>
                <FormDots form={statPlayer.form} />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {takeoverOpen && isPerfectXi && matchLabel && matchdayLabel && predictionId && pointsAwarded !== null && (
        <PerfectXiTakeover
          matchLabel={matchLabel}
          matchdayLabel={matchdayLabel}
          formation={formation}
          rows={existingSlots
            .slice()
            .sort((a, b) => a.slotIndex - b.slotIndex)
            .map((s) => {
              const p = playerById.get(s.squadPlayerId);
              return {
                pos: s.slotIndex === 0 ? "GK" : POS_ABBREV[p?.position ?? "MIDFIELDER"],
                number: p?.shirtNumber ?? null,
                name: p?.name ?? "",
              };
            })}
          pointsAwarded={pointsAwarded}
          perfectXiCount={perfectXiCount ?? 1}
          predictionId={predictionId}
          onClose={() => setTakeoverOpen(false)}
        />
      )}

      {shareOpen && predictionId && <ShareOverlay predictionId={predictionId} onClose={() => setShareOpen(false)} />}
    </div>
  );
}

const POS_ABBREV: Record<SquadPlayer["position"], string> = {
  GOALKEEPER: "GK",
  DEFENDER: "DEF",
  MIDFIELDER: "MID",
  FORWARD: "FWD",
};
