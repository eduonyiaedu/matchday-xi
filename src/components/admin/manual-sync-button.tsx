"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Two separate buttons/endpoints, matching the two independent cron jobs — kept apart
// deliberately so one click never combines enough football-data.org calls to approach the
// free-tier rate limit (see lib/football-data/client.ts and lib/services/fixture-sync.ts).
function SyncButton({ label, endpoint }: { label: string; endpoint: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    const res = await fetch(endpoint, { method: "POST" });
    setLoading(false);
    if (res.ok) {
      toast.success(`${label} complete`);
      router.refresh();
    } else {
      toast.error(`${label} failed — check job logs`);
    }
  }

  return (
    <Button onClick={run} disabled={loading} variant="outline">
      {loading ? "Syncing..." : label}
    </Button>
  );
}

export function ManualSyncButtons() {
  return (
    <div className="flex gap-2">
      <SyncButton label="Sync squads" endpoint="/api/admin/sync-squads" />
      <SyncButton label="Sync fixtures" endpoint="/api/admin/sync-fixtures" />
      <SyncButton label="Sync shirt numbers / U21" endpoint="/api/admin/sync-shirt-numbers" />
    </div>
  );
}
