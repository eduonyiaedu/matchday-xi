"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TeamOption {
  id: string;
  name: string;
  shortName: string | null;
  crestUrl: string | null;
}

export function TeamPicker({ teams }: { teams: TeamOption[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!selectedId) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch("/api/teams/change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: selectedId }),
    });
    setSubmitting(false);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Something went wrong.");
      return;
    }
    router.push("/home");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {teams.map((team) => (
          <button
            key={team.id}
            type="button"
            onClick={() => setSelectedId(team.id)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors hover:border-primary",
              selectedId === team.id ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            {team.crestUrl ? (
              <Image src={team.crestUrl} alt="" width={40} height={40} className="h-10 w-10 object-contain" unoptimized />
            ) : (
              <div className="h-10 w-10 rounded-full bg-muted" />
            )}
            <span className="text-center">{team.shortName ?? team.name}</span>
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button size="lg" disabled={!selectedId || submitting} onClick={confirm}>
        {submitting ? "Saving..." : "Confirm my club"}
      </Button>
    </div>
  );
}
