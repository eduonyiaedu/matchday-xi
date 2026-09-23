"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

const buttonClass =
  "rounded-lg px-3 py-1.5 font-heading text-xs tracking-[0.1em] uppercase ring-1 ring-white/12 hover:bg-white/5 disabled:opacity-50";

/** Build / email controls for one season's export on /admin/prizes (lib/season-export.ts). */
export function SeasonExportControls({ season, status }: { season: string; status: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"build" | "email" | null>(null);
  const building = status === "QUEUED" || status === "RUNNING";

  async function run(action: "build" | "email") {
    setBusy(action);
    try {
      const res = await fetch(`/api/admin/season-export?season=${encodeURIComponent(season)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
      toast.success(
        body.status === "emailed"
          ? `${season} download links emailed to you.`
          : action === "email"
            ? `Preparing the ${season} export — the links will be emailed to you when it's ready.`
            : `Preparing the ${season} export — refresh this page in a minute or two.`,
      );
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => run("build")} disabled={busy !== null || building} className={buttonClass}>
        {busy === "build" ? "Starting..." : status === "READY" || status === "FAILED" ? "Rebuild" : "Prepare export"}
      </button>
      <button type="button" onClick={() => run("email")} disabled={busy !== null} className={buttonClass}>
        {busy === "email" ? "Sending..." : "Email me the links"}
      </button>
    </div>
  );
}
