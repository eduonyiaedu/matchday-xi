"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

type TeamRule = "ANY_TEAM" | "SINGLE_LEAGUE" | "SINGLE_TEAM";

export function CreateLeagueForm({ teams }: { teams: { id: string; name: string }[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [teamRule, setTeamRule] = useState<TeamRule>("ANY_TEAM");
  const [restrictedTeamId, setRestrictedTeamId] = useState<string>("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const res = await fetch("/api/leagues", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        teamRule,
        restrictedTeamId: teamRule === "SINGLE_TEAM" ? restrictedTeamId : undefined,
        startDate,
        endDate,
      }),
    });
    setSubmitting(false);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(body.error ?? "Something went wrong.");
      return;
    }
    router.push(`/leagues/${body.league.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">League name</Label>
        <Input id="name" required minLength={3} value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Who can members pick as their team?</Label>
        <Select value={teamRule} onValueChange={(v) => setTeamRule(v as TeamRule)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ANY_TEAM">Any Premier League club</SelectItem>
            <SelectItem value="SINGLE_LEAGUE">Only clubs from one competition</SelectItem>
            <SelectItem value="SINGLE_TEAM">Everyone must use the same club</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {teamRule === "SINGLE_TEAM" && (
        <div className="flex flex-col gap-1.5">
          <Label>Which club?</Label>
          <Select value={restrictedTeamId} onValueChange={setRestrictedTeamId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a club" />
            </SelectTrigger>
            <SelectContent>
              {teams.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="startDate">Starts</Label>
          <Input id="startDate" type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="endDate">Ends</Label>
          <Input id="endDate" type="date" required value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
      </div>

      <Card className="opacity-70">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Charge an entry fee</CardTitle>
            <Badge variant="outline">Coming soon</Badge>
          </div>
          <CardDescription>
            Paid entry (15% platform / 15% you / 70% prize pool) isn&apos;t live yet — this league
            will be free to join.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <Switch disabled checked={false} />
            <span className="text-sm text-muted-foreground">Disabled</span>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? "Creating..." : "Create league"}
      </Button>
    </form>
  );
}
