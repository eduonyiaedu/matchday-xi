import Link from "next/link";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LocalTime } from "@/components/ui/local-time";
import { FixtureEligibilityBadge } from "@/components/predict/fixture-eligibility-badge";
import { FixturesTabs } from "@/components/fixtures/fixtures-tabs";
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
      take: 5,
    }),
    getNextEligibleFixture(user.favoriteTeamId),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold uppercase">Fixtures</h1>
      <FixturesTabs active="upcoming" />
      {fixtures.length === 0 && (
        <Card>
          <CardContent className="py-7 text-center">
            <div className="mx-auto h-13.5 w-13.5 rounded-xl turf shadow-[inset_0_0_0_1.5px_rgba(245,243,236,0.16)]" />
            <p className="mt-3.5 font-heading text-lg font-semibold uppercase">No fixtures yet</p>
            <p className="mx-auto mt-1.5 max-w-xs text-[12.5px] text-muted-foreground">
              The Premier League calendar syncs every morning. Your next match will appear here as soon as it&apos;s
              published.
            </p>
          </CardContent>
        </Card>
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
