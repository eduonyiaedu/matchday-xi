"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// Separate buttons/endpoints, matching the independent cron jobs — kept apart deliberately so one
// click never combines enough football-data.org / API-Football calls to approach a free-tier
// rate limit (see lib/football-data/client.ts and lib/api-football/client.ts).
const SYNCS = [
  {
    label: "Sync squads",
    description: "Refreshes club squads from football-data.org, a few clubs per run.",
    endpoint: "/api/admin/sync-squads",
  },
  {
    label: "Sync fixtures",
    description: "Pulls upcoming fixtures, plus final scores from the last 7 days.",
    endpoint: "/api/admin/sync-fixtures",
  },
  {
    label: "Sync shirt numbers / U21",
    description: "Adds shirt numbers, photos and U21 players from API-Football, 1 club per run. Uses API-Football's daily allowance.",
    endpoint: "/api/admin/sync-shirt-numbers",
  },
  {
    label: "Sync standings",
    description: "Updates the Premier League table, top scorers and season dates.",
    endpoint: "/api/admin/sync-standings",
  },
];

function SyncButton({ label, description, endpoint }: (typeof SYNCS)[number]) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch(endpoint, { method: "POST" });
      if (res.ok) {
        toast.success(`${label} complete`);
        router.refresh();
      } else {
        toast.error(`${label} failed — check job logs`);
      }
    } catch {
      toast.error(`${label} couldn't reach the server — check your connection.`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={loading}
      className={cn(
        // Same look as the main admin page's nav cards (components/ui/card.tsx).
        "w-full rounded-[14px] bg-card p-4 text-left shadow-[0_4px_14px_rgba(0,0,0,0.3)] ring-1 ring-white/6 transition-colors hover:bg-white/5",
        loading && "opacity-70",
      )}
    >
      <p className="font-heading text-sm font-semibold uppercase">{loading ? "Syncing..." : label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

export function ManualSyncButtons() {
  return (
    <div className="flex flex-col gap-3">
      {SYNCS.map((s) => (
        <SyncButton key={s.endpoint} {...s} />
      ))}
    </div>
  );
}
