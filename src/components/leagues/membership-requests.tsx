"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function MembershipRequests({
  pending,
}: {
  pending: { id: string; displayName: string; username: string; teamName: string | null }[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function respond(membershipId: string, approve: boolean) {
    setBusyId(membershipId);
    await fetch("/api/leagues/membership", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ membershipId, approve }),
    });
    setBusyId(null);
    router.refresh();
  }

  if (pending.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pending join requests</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {pending.map((m) => (
          <div key={m.id} className="flex items-center justify-between">
            <span className="text-sm">
              {m.displayName} <span className="text-muted-foreground">@{m.username}</span>
              {m.teamName && <span className="text-muted-foreground"> · {m.teamName}</span>}
            </span>
            <div className="flex gap-2">
              <Button size="sm" disabled={busyId === m.id} onClick={() => respond(m.id, true)}>
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === m.id}
                onClick={() => respond(m.id, false)}
              >
                Deny
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
