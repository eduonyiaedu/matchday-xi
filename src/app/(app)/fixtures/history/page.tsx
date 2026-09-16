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

  const predictions = await prisma.prediction.findMany({
    where: { userId: user.id, privateLeagueId: null, pointsAwarded: { not: null } },
    include: {
      fixture: { include: { homeTeam: true, awayTeam: true, competition: true } },
    },
    orderBy: { fixture: { kickoffAt: "desc" } },
    take: 50,
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold uppercase">Fixtures</h1>
      <FixturesTabs active="history" />
      {predictions.length === 0 && (
        <Card>
          <CardContent className="py-7 text-center text-sm text-muted-foreground">No scored predictions yet.</CardContent>
        </Card>
      )}
      {predictions.map((p) => (
        <Link key={p.id} href={`/predict/${p.fixtureId}`}>
          <Card className="transition-colors hover:bg-white/5">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base">
                  {p.fixture.homeTeam.name} vs {p.fixture.awayTeam.name}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {p.fixture.competition.name} · <LocalTime iso={p.fixture.kickoffAt.toISOString()} dateOnly />
                </p>
              </div>
              <div className="flex items-center gap-2">
                {p.fixture.status === "VOIDED" ? (
                  <Badge variant="outline">Voided</Badge>
                ) : (
                  <>
                    <Badge>{p.pointsAwarded} pts</Badge>
                    {p.isPerfectXi && <Badge variant="secondary">Perfect XI</Badge>}
                  </>
                )}
              </div>
            </CardHeader>
          </Card>
        </Link>
      ))}
    </div>
  );
}
