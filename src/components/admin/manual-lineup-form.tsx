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

export function ManualLineupForm({
  fixtureId,
  teamId,
  squad,
  initialSelected,
}: {
  fixtureId: string;
  teamId: string;
  squad: SquadPlayerOption[];
  initialSelected: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(initialSelected));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 11) {
        next.add(id);
      }
      return next;
    });
  }

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/admin/lineups/${fixtureId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId, squadPlayerIds: [...selected] }),
    });
    setSaving(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toast.error(body.error ?? "Couldn't save lineup.");
      return;
    }
    toast.success("Lineup saved and predictions scored.");
    router.refresh();
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
        <span className="text-sm text-muted-foreground">{selected.size}/11 selected</span>
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

      <Button onClick={save} disabled={saving || selected.size !== 11} className="self-start">
        {saving ? "Saving..." : selected.size === 11 ? "Save lineup" : `Pick ${11 - selected.size} more`}
      </Button>
    </div>
  );
}
