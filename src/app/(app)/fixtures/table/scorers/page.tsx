import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { FixturesTabs } from "@/components/fixtures/fixtures-tabs";
import { TableSubTabs } from "@/components/fixtures/table-sub-tabs";
import { ScorerList } from "@/components/fixtures/scorer-list";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function GoalScorersPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  const scorers = await prisma.topScorer.findMany({
    where: { competition: { externalId: "PL" } },
    include: { team: { select: { name: true, shortName: true } } },
    orderBy: [{ goals: "desc" }, { playerName: "asc" }],
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold uppercase">Fixtures</h1>
      <FixturesTabs active="table" />
      <TableSubTabs active="scorers" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top goal scorers</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          <ScorerList rows={scorers} emphasize="goals" favoriteTeamId={user.favoriteTeamId} />
        </CardContent>
      </Card>
    </div>
  );
}
