import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { JoinLeagueButton } from "@/components/leagues/join-league-button";
import { MembershipRequests } from "@/components/leagues/membership-requests";

export default async function LeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  const league = await prisma.privateLeague.findUnique({
    where: { id },
    include: {
      creator: { select: { displayName: true } },
      restrictedTeam: { select: { name: true } },
      memberships: { include: { user: { select: { displayName: true } } } },
    },
  });
  if (!league) notFound();

  const myMembership = league.memberships.find((m) => m.userId === user.id);
  const isCreator = league.creatorId === user.id;
  const isApproved = isCreator || myMembership?.status === "APPROVED";

  let fixtures: Awaited<ReturnType<typeof getEligibleFixtures>> = [];
  if (isApproved) {
    fixtures = await getEligibleFixtures(league);
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{league.name}</h1>
        <p className="text-sm text-muted-foreground">Created by {league.creator.displayName}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rules (locked in, visible to everyone)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm">
          <p>
            Team rule:{" "}
            {league.teamRule === "SINGLE_TEAM"
              ? `everyone predicts for ${league.restrictedTeam?.name}`
              : league.teamRule === "SINGLE_LEAGUE"
                ? "any club from the specified competition"
                : "any Premier League club"}
          </p>
          <p>
            Active window: {league.startDate.toLocaleDateString()} –{" "}
            {league.endDate.toLocaleDateString()}
          </p>
          <p className="text-muted-foreground">Free to join — paid entry isn&apos;t live yet.</p>
        </CardContent>
      </Card>

      {!isCreator && (
        <JoinLeagueButton leagueId={league.id} status={myMembership?.status ?? null} />
      )}

      {isCreator && (
        <MembershipRequests
          pending={league.memberships
            .filter((m) => m.status === "PENDING")
            .map((m) => ({ id: m.id, displayName: m.user.displayName }))}
        />
      )}

      {isApproved && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Predict in this league</h2>
          {fixtures.length === 0 && (
            <p className="text-sm text-muted-foreground">No eligible fixtures right now.</p>
          )}
          <div className="flex flex-col gap-2">
            {fixtures.map((f) => (
              <Card key={`${f.fixtureId}-${f.teamId}`}>
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="text-base">
                      {f.homeTeamName} vs {f.awayTeamName}
                    </CardTitle>
                    <CardDescription>{f.kickoffAt.toLocaleString()}</CardDescription>
                  </div>
                  <Badge variant="secondary">Predicting for {f.teamName}</Badge>
                </CardHeader>
                <CardContent>
                  <Button asChild size="sm">
                    <Link href={`/leagues/${league.id}/predict/${f.fixtureId}?teamId=${f.teamId}`}>
                      Build lineup
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

async function getEligibleFixtures(league: {
  id: string;
  teamRule: string;
  restrictedTeamId: string | null;
  startDate: Date;
  endDate: Date;
}) {
  const fixtures = await prisma.fixture.findMany({
    where: {
      status: { in: ["SCHEDULED", "LOCKED"] },
      kickoffAt: { gte: league.startDate, lt: league.endDate },
    },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { kickoffAt: "asc" },
  });

  const rows: Array<{
    fixtureId: string;
    teamId: string;
    teamName: string;
    homeTeamName: string;
    awayTeamName: string;
    kickoffAt: Date;
  }> = [];

  for (const fixture of fixtures) {
    const sides = [fixture.homeTeam, fixture.awayTeam].filter((t) => t.isPremierLeagueClub);
    for (const side of sides) {
      if (league.teamRule === "SINGLE_TEAM" && side.id !== league.restrictedTeamId) continue;
      rows.push({
        fixtureId: fixture.id,
        teamId: side.id,
        teamName: side.name,
        homeTeamName: fixture.homeTeam.name,
        awayTeamName: fixture.awayTeam.name,
        kickoffAt: fixture.kickoffAt,
      });
    }
  }
  return rows;
}
