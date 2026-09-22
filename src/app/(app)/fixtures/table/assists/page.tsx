import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { FixturesTabs } from "@/components/fixtures/fixtures-tabs";
import { TableSubTabs } from "@/components/fixtures/table-sub-tabs";
import { ScorerList } from "@/components/fixtures/scorer-list";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AssistsPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  // Same synced rows as the goal-scorers page, just re-sorted — football-data.org's free tier has
  // no separate "top assists" endpoint, only this one goals-ranked list with an assists column
  // alongside it (see standings-sync.ts). The sync now pulls every player with >=1 goal (raised
  // from a top-20-by-goals cap), so this is a complete, independent assists ranking among
  // goal-scorers — but a player with 0 goals and real assists still can't appear at all, since
  // this data source's underlying dataset excludes them entirely, not just past some page limit.
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
          <CardDescription>
            Only includes players who&apos;ve scored at least one goal this season — a data-source limit, not a ranking choice.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          <ScorerList rows={scorers} emphasize="assists" favoriteTeamId={user.favoriteTeamId} />
        </CardContent>
      </Card>
    </div>
  );
}
