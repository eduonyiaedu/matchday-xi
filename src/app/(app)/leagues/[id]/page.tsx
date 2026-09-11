import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { JoinLeagueButton } from "@/components/leagues/join-league-button";
import { MembershipRequests } from "@/components/leagues/membership-requests";
import { FixtureEligibilityBadge } from "@/components/predict/fixture-eligibility-badge";
import { getNextEligibleFixture, isPredictionWindowOpen, predictionOpensAt } from "@/lib/next-fixture";

export default async function LeagueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  const league = await prisma.privateLeague.findUnique({
    where: { id },
    include: {
      creator: { select: { displayName: true, username: true } },
      restrictedTeam: { select: { name: true } },
      memberships: { include: { user: { select: { displayName: true, username: true } }, team: { select: { name: true } } } },
    },
  });
  if (!league) notFound();

  const myMembership = league.memberships.find((m) => m.userId === user.id);
  const isApproved = myMembership?.status === "APPROVED" && myMembership.teamId;

  const teams =
    league.teamRule === "SINGLE_TEAM"
      ? []
      : await prisma.team.findMany({
          where: { isPremierLeagueClub: true, isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        });

  let fixtures: Awaited<ReturnType<typeof getEligibleFixtures>> = [];
  let nextFixtureId: string | null = null;
  if (isApproved && myMembership?.teamId) {
    fixtures = await getEligibleFixtures(myMembership.teamId, league);
    const next = await getNextEligibleFixture(myMembership.teamId);
    nextFixtureId = next?.id ?? null;
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">{league.name}</h1>
        <p className="text-sm text-muted-foreground">
          Created by {league.creator.displayName} <span>@{league.creator.username}</span>
        </p>
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
                ? "any club from the specified competition (each member picks their own at join time)"
                : "any Premier League club (each member picks their own at join time)"}
          </p>
          <p>
            Active window: <LocalTime iso={league.startDate.toISOString()} dateOnly /> –{" "}
            <LocalTime iso={league.endDate.toISOString()} dateOnly />
          </p>
          <p className="text-muted-foreground">Free to join — paid entry isn&apos;t live yet.</p>
        </CardContent>
      </Card>

      {league.creatorId !== user.id && (
        <JoinLeagueButton
          leagueId={league.id}
          status={myMembership?.status ?? null}
          teamRule={league.teamRule}
          teams={teams}
        />
      )}

      {league.creatorId === user.id && (
        <MembershipRequests
          pending={league.memberships
            .filter((m) => m.status === "PENDING")
            .map((m) => ({
              id: m.id,
              displayName: m.user.displayName,
              username: m.user.username,
              teamName: m.team?.name ?? null,
            }))}
        />
      )}

      {isApproved && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Predict in this league</h2>
          {fixtures.length === 0 && (
            <p className="text-sm text-muted-foreground">No eligible fixtures right now.</p>
          )}
          <div className="flex flex-col gap-2">
            {fixtures.map((f) => {
              const locked = f.status !== "SCHEDULED" || new Date() >= f.lockAt;
              const isNext = f.id === nextFixtureId;
              const windowOpen = isPredictionWindowOpen(f);
              const actionable = !locked && isNext && windowOpen;
              return (
                <Card key={f.id}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-base">
                        {f.homeTeam.name} vs {f.awayTeam.name}
                      </CardTitle>
                      <CardDescription>
                        <LocalTime iso={f.kickoffAt.toISOString()} />
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">Predicting for {myMembership!.team?.name}</Badge>
                      {locked && <Badge variant="outline">Locked</Badge>}
                      {!locked && (
                        <FixtureEligibilityBadge isNext={isNext} windowOpen={windowOpen} opensAt={predictionOpensAt(f)} />
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    {locked || actionable ? (
                      <Button asChild size="sm">
                        <Link href={`/leagues/${league.id}/predict/${f.id}`}>
                          {locked ? "View" : "Build lineup"}
                        </Link>
                      </Button>
                    ) : (
                      <Button disabled size="sm" variant="outline">
                        {isNext ? "Opens soon" : "Not yet your next match"}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

async function getEligibleFixtures(
  memberTeamId: string,
  league: { startDate: Date; endDate: Date },
) {
  return prisma.fixture.findMany({
    where: {
      status: { in: ["SCHEDULED", "LOCKED", "LINEUPS_FETCHED", "NEEDS_MANUAL_REVIEW"] },
      OR: [{ homeTeamId: memberTeamId }, { awayTeamId: memberTeamId }],
      kickoffAt: { gte: league.startDate, lt: league.endDate },
    },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { kickoffAt: "asc" },
  });
}
