import Link from "next/link";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { computeGlobalRank, computeLeagueStandings } from "@/lib/rank";
import { getNextEligibleFixture, isPredictionWindowOpen, predictionOpensAt } from "@/lib/next-fixture";
import { scopeKeyFor } from "@/lib/prediction-scope";

export default async function HomePage() {
  const authedUser = await getOrCreateCurrentUser();
  if (!authedUser?.favoriteTeamId) return null; // (app) layout already redirects, this satisfies TS
  const favoriteTeamId = authedUser.favoriteTeamId;

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: authedUser.id },
    include: { favoriteTeam: true },
  });

  const [globalRank, teamRank, memberships, nextFixture] = await Promise.all([
    computeGlobalRank(user),
    computeGlobalRank(user, favoriteTeamId),
    prisma.privateLeagueMembership.findMany({
      where: { userId: user.id, status: "APPROVED" },
      include: { league: true, team: true },
    }),
    getNextEligibleFixture(favoriteTeamId),
  ]);

  const leagueStandings = await Promise.all(
    memberships.map(async (m) => {
      const standings = await computeLeagueStandings(m.leagueId);
      const myIndex = standings.findIndex((s) => s.userId === user.id);
      return {
        leagueId: m.leagueId,
        leagueName: m.league.name,
        teamName: m.team?.name ?? "—",
        rank: myIndex === -1 ? standings.length + 1 : myIndex + 1,
        points: myIndex === -1 ? 0 : standings[myIndex].points,
      };
    }),
  );

  const nextFixturePrediction = nextFixture
    ? await prisma.prediction.findUnique({
        where: {
          userId_fixtureId_scopeKey: {
            userId: user.id,
            fixtureId: nextFixture.id,
            scopeKey: scopeKeyFor(null),
          },
        },
        select: { id: true },
      })
    : null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Welcome back, {user.displayName}</h1>
        <p className="text-sm text-muted-foreground">
          @{user.username} · {user.favoriteTeam?.name}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Streak</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <Badge variant="secondary">🔥 {user.currentStreak}d current</Badge>
            <Badge variant="outline">Best: {user.longestStreak}d</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Global leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">#{globalRank}</p>
            <p className="text-sm text-muted-foreground">{user.totalPoints} pts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{user.favoriteTeam?.name} fans leaderboard</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">#{teamRank}</p>
            <p className="text-sm text-muted-foreground">{user.totalPoints} pts</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Next match</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {nextFixture ? (
              <>
                <p className="text-sm">
                  {nextFixture.homeTeam.name} vs {nextFixture.awayTeam.name}
                </p>
                <p className="text-xs text-muted-foreground">
                  <LocalTime iso={nextFixture.kickoffAt.toISOString()} />
                </p>
                <div>
                  <Badge variant={nextFixturePrediction ? "secondary" : "outline"}>
                    {nextFixturePrediction ? "Lineup submitted" : "No lineup yet"}
                  </Badge>
                </div>
                {isPredictionWindowOpen(nextFixture) ? (
                  <Button asChild size="sm">
                    <Link href={`/predict/${nextFixture.id}`}>
                      {nextFixturePrediction ? "Edit prediction" : "Build lineup"}
                    </Link>
                  </Button>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Opens <LocalTime iso={predictionOpensAt(nextFixture).toISOString()} />
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No upcoming fixtures synced yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {leagueStandings.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Your private leagues</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {leagueStandings.map((l) => (
              <Link key={l.leagueId} href={`/leagues/${l.leagueId}`}>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{l.leagueName}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">Predicting for {l.teamName}</p>
                    <p className="text-lg font-bold">
                      #{l.rank} · {l.points} pts
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
