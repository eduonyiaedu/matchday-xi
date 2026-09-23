"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

interface SquadPlayerOption {
  id: string;
  name: string;
  shirtNumber: number | null;
  position: "GOALKEEPER" | "DEFENDER" | "MIDFIELDER" | "FORWARD";
}

interface UnlistedPlayer {
  name: string;
  isGoalkeeper: boolean;
}

export function ManualLineupForm({
  fixtureId,
  teamId,
  squad,
  initialSelected,
  initialUnlisted,
}: {
  fixtureId: string;
  teamId: string;
  squad: SquadPlayerOption[];
  initialSelected: string[];
  initialUnlisted: UnlistedPlayer[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [unlisted, setUnlisted] = useState<UnlistedPlayer[]>(initialUnlisted);
  const [newName, setNewName] = useState("");
  const [newIsGoalkeeper, setNewIsGoalkeeper] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const total = selected.size + unlisted.length;
  const goalkeeperCount =
    squad.filter((p) => selected.has(p.id) && p.position === "GOALKEEPER").length +
    unlisted.filter((p) => p.isGoalkeeper).length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size + unlisted.length < 11) {
        next.add(id);
      }
      return next;
    });
  }

  function addUnlisted() {
    const name = newName.trim();
    if (!name || total >= 11) return;
    setUnlisted((prev) => [...prev, { name, isGoalkeeper: newIsGoalkeeper }]);
    setNewName("");
    setNewIsGoalkeeper(false);
  }

  async function save() {
    // Scoring only compares player sets, so this is purely a mis-click guard — two starting
    // keepers (or none) almost always means a wrong box was ticked. Overridable, since squad
    // data occasionally tags a position wrongly.
    if (
      goalkeeperCount !== 1 &&
      !window.confirm(
        `This lineup has ${goalkeeperCount} goalkeepers — a real starting XI has exactly 1. Save it anyway?`,
      )
    ) {
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/lineups/${fixtureId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, squadPlayerIds: [...selected], unlistedPlayers: unlisted }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        toast.error(body.error ?? "Couldn't save lineup.");
        return;
      }
      toast.success("Lineup saved and predictions scored.");
      router.refresh();
    } catch {
      toast.error("Couldn't reach the server — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const filtered = squad.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the squad"
          className="max-w-xs"
        />
        <span className="text-sm text-muted-foreground">{total}/11 selected</span>
      </div>

      <div className="grid max-h-80 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3">
        {filtered.map((p) => (
          <label key={p.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
            <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
            <span className="w-6 font-mono text-xs text-muted-foreground">{p.shirtNumber ?? ""}</span>
            <span className="flex-1 truncate">{p.name}</span>
            {p.position === "GOALKEEPER" && <span className="text-xs text-muted-foreground">GK</span>}
          </label>
        ))}
        {filtered.length === 0 && <p className="col-span-full text-sm text-muted-foreground">No players match.</p>}
      </div>

      <div className="flex flex-col gap-2 rounded border border-white/10 p-3">
        <p className="text-sm font-medium">Starter not in the list?</p>
        <p className="text-xs text-muted-foreground">
          E.g. an academy call-up or new signing we haven&apos;t synced yet. Recorded by name only —
          nobody gets points for them, since nobody could have picked them.
        </p>
        {unlisted.map((p, i) => (
          <div key={`${p.name}-${i}`} className="flex items-center justify-between text-sm">
            <span>
              {p.name}
              {p.isGoalkeeper && <span className="ml-2 text-xs text-muted-foreground">GK</span>}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setUnlisted((prev) => prev.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Player name"
            className="max-w-xs"
            disabled={total >= 11}
          />
          <label className="flex items-center gap-1.5 text-sm">
            <Checkbox checked={newIsGoalkeeper} onCheckedChange={(v) => setNewIsGoalkeeper(v === true)} />
            GK
          </label>
          <Button variant="outline" size="sm" onClick={addUnlisted} disabled={!newName.trim() || total >= 11}>
            Add
          </Button>
        </div>
      </div>

      {total === 11 && goalkeeperCount !== 1 && (
        <p className="text-sm text-destructive">
          Heads up: {goalkeeperCount} goalkeepers selected — a starting XI normally has exactly 1.
        </p>
      )}

      <Button onClick={save} disabled={saving || total !== 11} className="self-start">
        {saving ? "Saving..." : total === 11 ? "Save lineup" : `Pick ${11 - total} more`}
      </Button>
    </div>
  );
}
