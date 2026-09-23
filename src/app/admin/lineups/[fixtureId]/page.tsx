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

  const lineupFor = (teamId: string) => fixture.officialLineups.find((l) => l.teamId === teamId);
  const savedIds = (teamId: string) =>
    lineupFor(teamId)?.players.map((p) => p.squadPlayerId).filter((id): id is string => !!id) ?? [];

  // Active squad PLUS anyone already in this fixture's saved lineup, even if a squad sync has
  // since deactivated them — otherwise re-saving a correction would silently drop a real starter
  // and force the founder to pick a wrong 11th player to get back to 11.
  const [homeSquad, awaySquad] = await Promise.all([
    prisma.squadPlayer.findMany({
      where: { teamId: fixture.homeTeamId, OR: [{ isActive: true }, { id: { in: savedIds(fixture.homeTeamId) } }] },
      orderBy: { name: "asc" },
    }),
    prisma.squadPlayer.findMany({
      where: { teamId: fixture.awayTeamId, OR: [{ isActive: true }, { id: { in: savedIds(fixture.awayTeamId) } }] },
      orderBy: { name: "asc" },
    }),
  ]);

  // Previously saved starters who weren't in the squad data at all (recorded by name only).
  const savedUnlisted = (teamId: string) =>
    lineupFor(teamId)
      ?.players.filter((p) => !p.squadPlayerId)
      .map((p) => ({ name: p.rawName, isGoalkeeper: p.isGoalkeeper })) ?? [];
  const lineupEntryOpen =
    ["LOCKED", "LINEUPS_FETCHED", "NEEDS_MANUAL_REVIEW", "SCORED"].includes(fixture.status) &&
    new Date() >= fixture.lockAt;

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

        {!lineupEntryOpen && (
          <Card>
            <CardContent className="pt-4 text-sm text-muted-foreground">
              Lineups can only be entered once a fixture has locked, and never for a voided fixture.
              This one is currently {fixture.status}.
            </CardContent>
          </Card>
        )}

        {lineupEntryOpen &&
          [
            { teamId: fixture.homeTeamId, label: `${fixture.homeTeam.name} (home)`, squad: homeSquad },
            { teamId: fixture.awayTeamId, label: `${fixture.awayTeam.name} (away)`, squad: awaySquad },
          ].map((side) => (
            <Card key={side.teamId}>
              <CardHeader>
                <CardTitle className="text-base">{side.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <ManualLineupForm
                  fixtureId={fixture.id}
                  teamId={side.teamId}
                  squad={side.squad.map((p) => ({ id: p.id, name: p.name, shirtNumber: p.shirtNumber, position: p.position }))}
                  initialSelected={savedIds(side.teamId)}
                  initialUnlisted={savedUnlisted(side.teamId)}
                />
              </CardContent>
            </Card>
          ))}
      </div>
      <Footer />
    </div>
  );
}
