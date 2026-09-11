"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function JoinLeagueButton({
  leagueId,
  status,
  teamRule,
  teams,
}: {
  leagueId: string;
  status: "PENDING" | "APPROVED" | "DENIED" | null;
  teamRule: "ANY_TEAM" | "SINGLE_LEAGUE" | "SINGLE_TEAM";
  teams: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [teamId, setTeamId] = useState("");

  if (status === "APPROVED") return <Badge variant="secondary">You&apos;re a member</Badge>;
  if (status === "PENDING") return <Badge variant="outline">Request pending approval</Badge>;

  async function join(chosenTeamId?: string) {
    setLoading(true);
    await fetch(`/api/leagues/${leagueId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chosenTeamId ? { teamId: chosenTeamId } : {}),
    });
    setLoading(false);
    setPickerOpen(false);
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      {status === "DENIED" && <Badge variant="destructive">Previous request denied</Badge>}
      <Button onClick={() => (teamRule === "SINGLE_TEAM" ? join() : setPickerOpen(true))} disabled={loading}>
        {loading ? "Requesting..." : "Request to join"}
      </Button>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pick your team for this league</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Permanent once approved — you&apos;ll predict this league&apos;s fixtures for this
            team only.
          </p>
          <Select value={teamId} onValueChange={setTeamId}>
            <SelectTrigger>
              <SelectValue placeholder="Select your team" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button disabled={!teamId || loading} onClick={() => join(teamId)}>
            {loading ? "Requesting..." : "Request to join"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
