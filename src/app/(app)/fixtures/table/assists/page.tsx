import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { FixturesTabs } from "@/components/fixtures/fixtures-tabs";
import { TableSubTabs } from "@/components/fixtures/table-sub-tabs";
import { ScorerList } from "@/components/fixtures/scorer-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AssistsPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  // Same synced rows as the goal-scorers page, just re-sorted — football-data.org's free tier has
  // no separate "top assists" endpoint, only this one goals-ranked list with an assists column
  // alongside it (see standings-sync.ts), so a prolific-assist/low-goals player outside that top
  // 20 by goals won't appear here either.
  const scorers = await prisma.topScorer.findMany({
    where: { competition: { externalId: "PL" } },
    include: { team: { select: { name: true, shortName: true } } },
    orderBy: [{ assists: "desc" }, { playerName: "asc" }],
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold uppercase">Fixtures</h1>
      <FixturesTabs active="table" />
      <TableSubTabs active="assists" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top assists</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          <ScorerList rows={scorers} emphasize="assists" favoriteTeamId={user.favoriteTeamId} />
        </CardContent>
      </Card>
    </div>
  );
}
