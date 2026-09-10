import { notFound } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PitchBuilder } from "@/components/predict/pitch-builder";
import { GLOBAL_SCOPE } from "@/lib/prediction-scope";

export default async function PredictPage({
  params,
}: {
  params: Promise<{ fixtureId: string }>;
}) {
  const { fixtureId } = await params;
  const user = await getOrCreateCurrentUser();
  if (!user?.favoriteTeamId) return null;

  const fixture = await prisma.fixture.findUnique({
    where: { id: fixtureId },
    include: { homeTeam: true, awayTeam: true, competition: true },
  });
  if (!fixture) notFound();
  if (fixture.homeTeamId !== user.favoriteTeamId && fixture.awayTeamId !== user.favoriteTeamId) {
    notFound();
  }

  const squad = await prisma.squadPlayer.findMany({
    where: { teamId: user.favoriteTeamId, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, position: true, photoUrl: true },
  });

  const existing = await prisma.prediction.findUnique({
    where: { userId_fixtureId_scopeKey: { userId: user.id, fixtureId, scopeKey: GLOBAL_SCOPE } },
    include: { slots: true },
  });

  const locked = new Date() >= fixture.lockAt;
  const opponent = fixture.homeTeamId === user.favoriteTeamId ? fixture.awayTeam : fixture.homeTeam;
  const isHome = fixture.homeTeamId === user.favoriteTeamId;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">
          {isHome ? "vs" : "@"} {opponent.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {fixture.competition.name} · Kickoff {fixture.kickoffAt.toLocaleString()} · Locks{" "}
          {fixture.lockAt.toLocaleString()}
        </p>
      </div>
      <PitchBuilder
        fixtureId={fixture.id}
        teamId={user.favoriteTeamId}
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
