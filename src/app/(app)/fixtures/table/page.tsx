import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { FixturesTabs } from "@/components/fixtures/fixtures-tabs";
import { TableSubTabs } from "@/components/fixtures/table-sub-tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export default async function FixturesTablePage() {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  const standings = await prisma.leagueStanding.findMany({
    where: { competition: { externalId: "PL" } },
    include: { team: { select: { name: true, shortName: true } } },
    orderBy: { position: "asc" },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold uppercase">Fixtures</h1>
      <FixturesTabs active="table" />
      <TableSubTabs active="table" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Premier League table</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pt-0">
          {standings.length === 0 ? (
            <p className="px-6 py-7 text-center text-sm text-muted-foreground">
              The table hasn&apos;t synced yet — check back soon.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8">#</TableHead>
                  <TableHead>Club</TableHead>
                  <TableHead className="text-right">P</TableHead>
                  <TableHead className="text-right">W</TableHead>
                  <TableHead className="text-right">D</TableHead>
                  <TableHead className="text-right">L</TableHead>
                  <TableHead className="text-right">GD</TableHead>
                  <TableHead className="text-right">Pts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {standings.map((row) => (
                  <TableRow key={row.id} className={cn(user.favoriteTeamId === row.teamId && "bg-club/10")}>
                    <TableCell className="font-mono text-xs text-muted-foreground">{row.position}</TableCell>
                    <TableCell className="font-medium">{row.team.shortName ?? row.team.name}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{row.played}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{row.won}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{row.drawn}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{row.lost}</TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm font-bold">{row.points}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
