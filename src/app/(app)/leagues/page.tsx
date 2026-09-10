import Link from "next/link";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LeagueSearch } from "@/components/leagues/league-search";

export default async function LeaguesPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  const [ownedLeague, memberships, allLeagues] = await Promise.all([
    prisma.privateLeague.findFirst({ where: { creatorId: user.id } }),
    prisma.privateLeagueMembership.findMany({
      where: { userId: user.id },
      include: { league: true },
    }),
    prisma.privateLeague.findMany({
      include: { creator: { select: { displayName: true } }, _count: { select: { memberships: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Private leagues</h1>
          <p className="text-sm text-muted-foreground">
            Free to create and join — separate scoring from the global/team leaderboards.
          </p>
        </div>
        {ownedLeague ? (
          <Button asChild variant="outline">
            <Link href={`/leagues/${ownedLeague.id}`}>Manage my league</Link>
          </Button>
        ) : (
          <Button asChild>
            <Link href="/leagues/create">Create a league</Link>
          </Button>
        )}
      </div>

      {memberships.length > 0 && (
        <div>
          <h2 className="mb-2 text-lg font-semibold">Your leagues</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {memberships.map((m) => (
              <Link key={m.id} href={`/leagues/${m.league.id}`}>
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">{m.league.name}</CardTitle>
                    <Badge variant={m.status === "APPROVED" ? "secondary" : "outline"}>
                      {m.status}
                    </Badge>
                  </CardHeader>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-lg font-semibold">Discover leagues</h2>
        <LeagueSearch initialLeagues={allLeagues.map((l) => ({
          id: l.id,
          name: l.name,
          creatorName: l.creator.displayName,
          memberCount: l._count.memberships,
        }))} />
      </div>

      <Card className="opacity-70">
        <CardHeader>
          <CardTitle className="text-base">Paid entry leagues</CardTitle>
          <CardDescription>
            Entry fees and prize pools for private leagues (15% platform / 15% creator / 70%
            prize pool) — coming once licensing is confirmed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Badge variant="outline">Coming soon</Badge>
        </CardContent>
      </Card>
    </div>
  );
}
