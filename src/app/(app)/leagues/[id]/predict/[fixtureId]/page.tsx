import { notFound } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PitchBuilder } from "@/components/predict/pitch-builder";
import { scopeKeyFor } from "@/lib/prediction-scope";

export default async function LeaguePredictPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; fixtureId: string }>;
  searchParams: Promise<{ teamId?: string }>;
}) {
  const { id: leagueId, fixtureId } = await params;
  const { teamId } = await searchParams;
  const user = await getOrCreateCurrentUser();
  if (!user || !teamId) return null;

  const league = await prisma.privateLeague.findUnique({ where: { id: leagueId } });
  if (!league) notFound();

  const membership = await prisma.privateLeagueMembership.findUnique({
    where: { leagueId_userId: { leagueId, userId: user.id } },
  });
  const isApproved = league.creatorId === user.id || membership?.status === "APPROVED";
  if (!isApproved) notFound();

  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: { homeTeam: true, awayTeam: true, competition: true },
  });
  if (!fixture) notFound();
  if (fixture.homeTeamId !== teamId && fixture.awayTeamId !== teamId) notFound();
  if (league.teamRule === "SINGLE_TEAM" && league.restrictedTeamId !== teamId) notFound();

  const squad = await prisma.squadPlayer.findMany({
    where: { teamId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, position: true, photoUrl: true },
  });

  const existing = await prisma.prediction.findUnique({
    where: { userId_fixtureId_scopeKey: { userId: user.id, fixtureId, scopeKey: scopeKeyFor(leagueId) } },
    include: { slots: true },
  });

  const locked = new Date() >= fixture.lockAt;
  const team = fixture.homeTeamId === teamId ? fixture.homeTeam : fixture.awayTeam;
  const opponent = fixture.homeTeamId === teamId ? fixture.awayTeam : fixture.homeTeam;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">
          {team.name} vs {opponent.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {league.name} · {fixture.competition.name} · Kickoff {fixture.kickoffAt.toLocaleString()}
        </p>
      </div>
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
        pointsAwarded={existing?.pointsAwarded ?? null}
        isPerfectXi={existing?.isPerfectXi ?? null}
        scored={fixture.status === "SCORED"}
      />
    </div>
  );
}
