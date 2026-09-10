"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function JoinLeagueButton({
  leagueId,
  status,
}: {
  leagueId: string;
  status: "PENDING" | "APPROVED" | "DENIED" | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (status === "APPROVED") return <Badge variant="secondary">You&apos;re a member</Badge>;
  if (status === "PENDING") return <Badge variant="outline">Request pending approval</Badge>;

  async function join() {
    setLoading(true);
    await fetch(`/api/leagues/${leagueId}/join`, { method: "POST" });
    setLoading(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {status === "DENIED" && <Badge variant="destructive">Previous request denied</Badge>}
      <Button onClick={join} disabled={loading}>
        {loading ? "Requesting..." : "Request to join"}
      </Button>
    </div>
  );
}
