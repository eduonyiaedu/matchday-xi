import { notFound } from "next/navigation";
import Link from "next/link";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatCalendarDay, leagueWindowEndExclusive } from "@/lib/league-window";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LeagueSectionTabs } from "@/components/leagues/league-section-tabs";
import { LocalTime } from "@/components/ui/local-time";
import { JoinLeagueButton } from "@/components/leagues/join-league-button";
import { MembershipRequests } from "@/components/leagues/membership-requests";
import { FixtureEligibilityBadge } from "@/components/predict/fixture-eligibility-badge";
import { getNextEligibleFixture, isPredictionWindowOpen, predictionOpensAt } from "@/lib/next-fixture";
import { getLeagueLeaderboardRows } from "@/lib/rank";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";

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
  let leaderboardRows: Awaited<ReturnType<typeof getLeagueLeaderboardRows>> = [];
  let history: Awaited<ReturnType<typeof getLeagueHistory>> = [];
  if (isApproved && myMembership?.teamId) {
    [fixtures, leaderboardRows, history] = await Promise.all([
      getEligibleFixtures(myMembership.teamId, league),
      getLeagueLeaderboardRows(league.id),
      getLeagueHistory(league.id, user.id, myMembership.teamId, league),
    ]);
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
              : "any Premier League club (each member picks their own at join time)"}
          </p>
          <p>
            {/* Calendar days stored as UTC midnight — rendered in UTC, not the viewer's timezone,
                or anyone west of UTC would see every date shifted a day early. */}
            Active window: {formatCalendarDay(league.startDate)} – {formatCalendarDay(league.endDate)}
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
          <h2 className="mb-2 text-lg font-semibold">Standings</h2>
          <Card>
            <CardContent className="pt-4">
              <LeaderboardTable rows={leaderboardRows} />
            </CardContent>
          </Card>
        </div>
      )}

      {isApproved && (
        <LeagueSectionTabs
          fixtures={
          <>
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
                        <FixtureEligibilityBadge
                          locked={locked}
                          isNext={isNext}
                          windowOpen={windowOpen}
                          opensAt={predictionOpensAt(f)}
                        />
                      </div>
                      {locked && (
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Locked</Badge>
                        </div>
                      )}
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
                          {isNext ? "Opens soon" : "Opens 24hrs before kickoff"}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
          }
          history={
          <>
            {history.length === 0 && (
              <Card>
                <CardContent className="py-7 text-center text-sm text-muted-foreground">
                  No scored predictions yet.
                </CardContent>
              </Card>
            )}
            <div className="flex flex-col gap-2">
              {history.map(({ fixture, prediction }) => (
                <Link key={fixture.id} href={`/leagues/${league.id}/predict/${fixture.id}`}>
                  <Card className="transition-colors hover:bg-white/5">
                    <CardHeader className="flex flex-row items-center justify-between">
                      <div>
                        <CardTitle className="text-base">
                          {fixture.homeTeam.name} vs {fixture.awayTeam.name}
                        </CardTitle>
                        <CardDescription>
                          <LocalTime iso={fixture.kickoffAt.toISOString()} dateOnly />
                        </CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        {fixture.status === "VOIDED" ? (
                          <Badge variant="outline">Voided</Badge>
                        ) : prediction ? (
                          <>
                            <Badge>{prediction.pointsAwarded} pts</Badge>
                            {prediction.isPerfectXi && <Badge variant="secondary">Perfect XI</Badge>}
                          </>
                        ) : (
                          <>
                            <Badge variant="secondary">0 pts</Badge>
                            <Badge variant="outline">Missed</Badge>
                          </>
                        )}
                      </div>
                    </CardHeader>
                  </Card>
                </Link>
              ))}
            </div>
          </>
          }
        />
      )}
    </div>
  );
}

async function getLeagueHistory(
  leagueId: string,
  userId: string,
  teamId: string,
  league: { startDate: Date; endDate: Date },
) {
  // Fixture-driven (was Prediction-driven) — same fix as fixtures/history/page.tsx: a scored
  // fixture the user never predicted for used to be silently skipped instead of showing as missed.
  const fixtures = await prisma.fixture.findMany({
    where: {
      status: { in: ["SCORED", "VOIDED"] },
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      kickoffAt: { gte: league.startDate, lt: leagueWindowEndExclusive(league.endDate) },
    },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { kickoffAt: "desc" },
    take: 50,
  });
  const predictions = await prisma.prediction.findMany({
    where: { privateLeagueId: leagueId, userId, fixtureId: { in: fixtures.map((f) => f.id) } },
  });
  const predictionByFixtureId = new Map(predictions.map((p) => [p.fixtureId, p]));
  return fixtures.map((fixture) => ({ fixture, prediction: predictionByFixtureId.get(fixture.id) ?? null }));
}

async function getEligibleFixtures(
  memberTeamId: string,
  league: { startDate: Date; endDate: Date },
) {
  return prisma.fixture.findMany({
    where: {
      status: { in: ["SCHEDULED", "LOCKED", "LINEUPS_FETCHED", "NEEDS_MANUAL_REVIEW"] },
      OR: [{ homeTeamId: memberTeamId }, { awayTeamId: memberTeamId }],
      kickoffAt: { gte: league.startDate, lt: leagueWindowEndExclusive(league.endDate) },
    },
    include: { homeTeam: true, awayTeam: true },
    orderBy: { kickoffAt: "asc" },
    take: 5,
  });
}
