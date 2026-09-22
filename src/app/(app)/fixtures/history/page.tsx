import Link from "next/link";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/ui/local-time";
import { FixturesTabs } from "@/components/fixtures/fixtures-tabs";

export default async function FixturesHistoryPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  // Fixture-driven (was Prediction-driven): a scored fixture the user never submitted a
  // prediction for used to be silently skipped entirely, since there was no Prediction row to
  // join off of. Querying fixtures first and left-joining the user's own predictions in JS means
  // a missed fixture still shows up — as "0 pts" / "Missed" — instead of vanishing.
  const fixtures = user.favoriteTeamId
    ? await prisma.fixture.findMany({
        where: {
          status: { in: ["SCORED", "VOIDED"] },
          OR: [{ homeTeamId: user.favoriteTeamId }, { awayTeamId: user.favoriteTeamId }],
        },
        include: { homeTeam: true, awayTeam: true, competition: true },
        orderBy: { kickoffAt: "desc" },
        take: 50,
      })
    : [];
  const predictions = await prisma.prediction.findMany({
    where: { userId: user.id, privateLeagueId: null, fixtureId: { in: fixtures.map((f) => f.id) } },
  });
  const predictionByFixtureId = new Map(predictions.map((p) => [p.fixtureId, p]));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold uppercase">Fixtures</h1>
      <FixturesTabs active="history" />
      {fixtures.length === 0 && (
        <Card>
          <CardContent className="py-7 text-center text-sm text-muted-foreground">No scored predictions yet.</CardContent>
        </Card>
      )}
      {fixtures.map((fixture) => {
        const prediction = predictionByFixtureId.get(fixture.id) ?? null;
        return (
          <Link key={fixture.id} href={`/predict/${fixture.id}`}>
            <Card className="transition-colors hover:bg-white/5">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base">
                    {fixture.homeTeam.name} vs {fixture.awayTeam.name}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {fixture.competition.name} · <LocalTime iso={fixture.kickoffAt.toISOString()} dateOnly />
                  </p>
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
        );
      })}
    </div>
  );
}
