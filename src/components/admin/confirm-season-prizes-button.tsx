"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function ConfirmSeasonPrizesButton({ season }: { season: string }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  async function confirm() {
    if (
      !window.confirm(
        `Confirm these as the ${season} season winners? This locks them in and notifies the winners and every player. It can't be undone.`,
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/season-prizes/confirm", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't confirm the winners.");
      toast.success(`${season} winners confirmed and announced.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't confirm the winners.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button onClick={confirm} disabled={saving} className="self-start">
      {saving ? "Confirming..." : "Confirm winners"}
    </Button>
  );
}
