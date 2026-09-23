"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function EmailSeasonExportButton({ season }: { season: string }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      const res = await fetch(`/api/admin/season-export?season=${encodeURIComponent(season)}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't send it.");
      toast.success(`${season} export emailed to you.`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't send it.");
    } finally {
      setSending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={sending}
      className="rounded-lg px-3 py-1.5 font-heading text-xs tracking-[0.1em] uppercase ring-1 ring-white/12 hover:bg-white/5 disabled:opacity-50"
    >
      {sending ? "Sending..." : "Email it to me"}
    </button>
  );
}
