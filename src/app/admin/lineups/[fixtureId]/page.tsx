import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Footer } from "@/components/layout/footer";
import { LocalTime } from "@/components/ui/local-time";
import { ManualLineupForm } from "@/components/admin/manual-lineup-form";

export default async function ManualLineupPage({
  params,
}: {
  params: Promise<{ fixtureId: string }>;
}) {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/fixtures");

  const { fixtureId } = await params;
  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: {
      homeTeam: true,
      awayTeam: true,
      officialLineups: { include: { players: true } },
    },
  });
  if (!fixture) notFound();

  const [homeSquad, awaySquad] = await Promise.all([
    prisma.squadPlayer.findMany({
      where: { teamId: fixture.homeTeamId, isActive: true },
      orderBy: { name: "asc" },
    }),
    prisma.squadPlayer.findMany({
      where: { teamId: fixture.awayTeamId, isActive: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const lineupFor = (teamId: string) => fixture.officialLineups.find((l) => l.teamId === teamId);
  // A player picked in a prior manual entry may have since been deactivated (e.g. transferred
  // out) by the squad sync — drop them from the pre-checked set rather than pre-checking someone
  // who no longer has a checkbox to uncheck, which would otherwise block ever re-saving.
  const homeActiveIds = new Set(homeSquad.map((p) => p.id));
  const awayActiveIds = new Set(awaySquad.map((p) => p.id));

  return (
    <div className="flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
        <div>
          <Link href="/admin" className="text-sm text-muted-foreground hover:underline">
            ← Back to admin
          </Link>
          <h1 className="text-2xl font-bold">
            {fixture.homeTeam.name} vs {fixture.awayTeam.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Kickoff <LocalTime iso={fixture.kickoffAt.toISOString()} /> · Status: {fixture.status}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{fixture.homeTeam.name} (home)</CardTitle>
          </CardHeader>
          <CardContent>
            <ManualLineupForm
              fixtureId={fixture.id}
              teamId={fixture.homeTeamId}
              squad={homeSquad.map((p) => ({ id: p.id, name: p.name, shirtNumber: p.shirtNumber, position: p.position }))}
              initialSelected={lineupFor(fixture.homeTeamId)?.players.map((p) => p.squadPlayerId).filter((id): id is string => !!id && homeActiveIds.has(id)) ?? []}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{fixture.awayTeam.name} (away)</CardTitle>
          </CardHeader>
          <CardContent>
            <ManualLineupForm
              fixtureId={fixture.id}
              teamId={fixture.awayTeamId}
              squad={awaySquad.map((p) => ({ id: p.id, name: p.name, shirtNumber: p.shirtNumber, position: p.position }))}
              initialSelected={lineupFor(fixture.awayTeamId)?.players.map((p) => p.squadPlayerId).filter((id): id is string => !!id && awayActiveIds.has(id)) ?? []}
            />
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
