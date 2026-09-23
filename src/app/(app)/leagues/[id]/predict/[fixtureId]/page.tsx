import { notFound } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PitchBuilder } from "@/components/predict/pitch-builder";
import type { Formation } from "@/lib/formations";
import { scopeKeyFor } from "@/lib/prediction-scope";
import { getNextEligibleFixture, isPredictionWindowOpen, predictionOpensAt } from "@/lib/next-fixture";
import { getTeamColors } from "@/lib/team-colors";
import { getRecentForm, formFor } from "@/lib/player-form";
import { LocalTime } from "@/components/ui/local-time";
import { BackLink } from "@/components/ui/back-link";

export default async function LeaguePredictPage({
  params,
}: {
  params: Promise<{ id: string; fixtureId: string }>;
}) {
  const { id: leagueId, fixtureId } = await params;
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  const league = await prisma.privateLeague.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  // The member's team is now permanent, set at join/creation — never trust a client-supplied
  // teamId (the old ?teamId= query param let a member hand-edit the URL to another team).
  const membership = await prisma.privateLeagueMembership.findUnique({
    where: { leagueId_userId: { leagueId, userId: user.id } },
  });
  if (!membership || membership.status !== "APPROVED" || !membership.teamId) notFound();
  const teamId = membership.teamId;

  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: { homeTeam: true, awayTeam: true, competition: true },
  });
  if (!fixture) notFound();
  if (fixture.homeTeamId !== teamId && fixture.awayTeamId !== teamId) notFound();

  const locked = new Date() >= fixture.lockAt;

  // Defense in depth, same reasoning as the global predict page — the API is authoritative.
  let windowNotYetOpen = false;
  if (!locked) {
    const nextFixture = await getNextEligibleFixture(teamId);
    if (!nextFixture || nextFixture.id !== fixture.id) notFound();
    windowNotYetOpen = !isPredictionWindowOpen(fixture);
  }

  const existing = await prisma.prediction.findUnique({
    where: { userId_fixtureId_scopeKey: { userId: user.id, fixtureId, scopeKey: scopeKeyFor(leagueId) } },
    include: { slots: true },
  });
  // Same as the global predict page: once locked, include saved picks even if since deactivated.
  const savedPlayerIds = locked ? (existing?.slots.map((s) => s.squadPlayerId) ?? []) : [];
  const [squadRaw, formMap] = await Promise.all([
    prisma.squadPlayer.findMany({
      where: { teamId, OR: [{ isActive: true }, { id: { in: savedPlayerIds } }] },
      orderBy: { name: "asc" },
      select: { id: true, name: true, position: true, shirtNumber: true, squadTier: true, photoUrl: true },
    }),
    getRecentForm(teamId),
  ]);
  const squad = squadRaw.map((p) => ({ ...p, form: formFor(formMap, p.id, 5) }));

  const scored = fixture.status === "SCORED";
  const officialLineup = scored
    ? (
        await prisma.officialLineup.findUnique({
          where: { fixtureId_teamId: { fixtureId, teamId } },
          include: { players: { include: { squadPlayer: { select: { name: true, shirtNumber: true } } } } },
        })
      )?.players.map((p) => ({
        squadPlayerId: p.squadPlayerId,
        name: p.squadPlayer?.name ?? p.rawName,
        shirtNumber: p.squadPlayer?.shirtNumber ?? null,
        isGoalkeeper: p.isGoalkeeper,
      })) ?? []
    : undefined;

  const team = fixture.homeTeamId === teamId ? fixture.homeTeam : fixture.awayTeam;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink fallbackHref={`/leagues/${leagueId}`} />
        <h1 className="text-2xl font-bold">
          {fixture.homeTeam.name} vs {fixture.awayTeam.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {league.name} · {fixture.competition.name} · Kickoff{" "}
          <LocalTime iso={fixture.kickoffAt.toISOString()} />
        </p>
      </div>
      {windowNotYetOpen ? (
        <p className="text-sm text-muted-foreground">
          Predictions for this fixture open <LocalTime iso={predictionOpensAt(fixture).toISOString()} /> —
          24 hours before kickoff.
        </p>
      ) : (
        <PitchBuilder
          fixtureId={fixture.id}
          teamId={teamId}
          privateLeagueId={leagueId}
          squad={squad}
          locked={locked}
          existingSlots={existing?.slots.map((s) => ({
            slotIndex: s.slotIndex,
            squadPlayerId: s.squadPlayerId,
            isCorrect: s.isCorrect,
          })) ?? []}
          initialFormation={(existing?.formation as Formation | undefined) ?? "4-4-2"}
          teamColors={getTeamColors(team.externalId)}
          pointsAwarded={existing?.pointsAwarded ?? null}
          scored={scored}
          officialLineup={officialLineup}
          predictionId={existing?.id}
        />
      )}
    </div>
  );
}
