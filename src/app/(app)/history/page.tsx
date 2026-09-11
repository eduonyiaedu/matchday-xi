import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/ui/local-time";

export default async function HistoryPage() {
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
      <h1 className="text-2xl font-bold">Your prediction history</h1>
      {predictions.length === 0 && (
        <p className="text-sm text-muted-foreground">No scored predictions yet.</p>
      )}
      {predictions.map((p) => (
        <Card key={p.id}>
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
      ))}
    </div>
  );
}
