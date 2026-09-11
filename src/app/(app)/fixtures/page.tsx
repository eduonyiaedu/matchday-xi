import Link from "next/link";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { FixtureEligibilityBadge } from "@/components/predict/fixture-eligibility-badge";
import { getNextEligibleFixture, isPredictionWindowOpen, predictionOpensAt } from "@/lib/next-fixture";

export default async function FixturesPage() {
  const user = await getOrCreateCurrentUser();
  if (!user?.favoriteTeamId) return null; // (app) layout already redirects, this satisfies TS

  const [fixtures, nextFixture] = await Promise.all([
    prisma.fixture.findMany({
      where: {
        status: { in: ["SCHEDULED", "LOCKED", "LINEUPS_FETCHED", "NEEDS_MANUAL_REVIEW"] },
        OR: [{ homeTeamId: user.favoriteTeamId }, { awayTeamId: user.favoriteTeamId }],
      },
      include: {
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } },
        competition: { select: { name: true } },
        predictions: { where: { userId: user.id, privateLeagueId: null }, select: { id: true } },
      },
      orderBy: { kickoffAt: "asc" },
    }),
    getNextEligibleFixture(user.favoriteTeamId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Upcoming fixtures</h1>
      {fixtures.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No upcoming fixtures synced yet — check back soon.
        </p>
      )}
      {fixtures.map((fixture) => {
        const locked = fixture.status !== "SCHEDULED" || new Date() >= fixture.lockAt;
        const hasPrediction = fixture.predictions.length > 0;
        const isNext = nextFixture?.id === fixture.id;
        const windowOpen = isPredictionWindowOpen(fixture);
        const actionable = !locked && isNext && windowOpen;
        return (
          <Card key={fixture.id}>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {fixture.homeTeam.name} vs {fixture.awayTeam.name}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {fixture.competition.name} · <LocalTime iso={fixture.kickoffAt.toISOString()} />
                </p>
              </div>
              <div className="flex items-center gap-2">
                {hasPrediction && <Badge variant="secondary">Submitted</Badge>}
                {locked && <Badge variant="outline">Locked</Badge>}
                {!locked && (
                  <FixtureEligibilityBadge
                    isNext={isNext}
                    windowOpen={windowOpen}
                    opensAt={predictionOpensAt(fixture)}
                  />
                )}
              </div>
            </CardHeader>
            <CardContent>
              {locked || actionable ? (
                <Button asChild variant={hasPrediction ? "outline" : "default"}>
                  <Link href={`/predict/${fixture.id}`}>
                    {locked ? "View" : hasPrediction ? "Edit prediction" : "Build lineup"}
                  </Link>
                </Button>
              ) : (
                <Button disabled variant="outline">
                  {isNext ? "Opens soon" : "Not yet your next match"}
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
