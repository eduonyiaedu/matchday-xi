import { notFound } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PitchBuilder } from "@/components/predict/pitch-builder";
import type { Formation } from "@/lib/formations";
import { GLOBAL_SCOPE } from "@/lib/prediction-scope";
import { getNextEligibleFixture, isPredictionWindowOpen, predictionOpensAt } from "@/lib/next-fixture";
import { getTeamColors } from "@/lib/team-colors";
import { getRecentForm, formFor } from "@/lib/player-form";
import { LocalTime } from "@/components/ui/local-time";
import { BackLink } from "@/components/ui/back-link";

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

  const locked = new Date() >= fixture.lockAt;

  // Defense in depth — the API is the authoritative gate, but a stale/guessed link shouldn't even
  // render a pitch builder for a fixture that would just 403 on submit.
  let windowNotYetOpen = false;
  if (!locked) {
    const nextFixture = await getNextEligibleFixture(user.favoriteTeamId);
    if (!nextFixture || nextFixture.id !== fixture.id) notFound();
    windowNotYetOpen = !isPredictionWindowOpen(fixture);
  }

  const [squadRaw, formMap, existing] = await Promise.all([
    prisma.squadPlayer.findMany({
      where: { teamId: user.favoriteTeamId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, position: true, shirtNumber: true, squadTier: true, photoUrl: true },
    }),
    getRecentForm(user.favoriteTeamId),
    prisma.prediction.findUnique({
      where: { userId_fixtureId_scopeKey: { userId: user.id, fixtureId, scopeKey: GLOBAL_SCOPE } },
      include: { slots: true },
    }),
  ]);
  const squad = squadRaw.map((p) => ({ ...p, form: formFor(formMap, p.id, 5) }));

  const scored = fixture.status === "SCORED";
  const officialLineup = scored
    ? (
        await prisma.officialLineup.findUnique({
          where: { fixtureId_teamId: { fixtureId, teamId: user.favoriteTeamId } },
          include: { players: { include: { squadPlayer: { select: { name: true, shirtNumber: true } } } } },
        })
      )?.players.map((p) => ({
        squadPlayerId: p.squadPlayerId,
        name: p.squadPlayer?.name ?? p.rawName,
        shirtNumber: p.squadPlayer?.shirtNumber ?? null,
      })) ?? []
    : undefined;

  const opponent = fixture.homeTeamId === user.favoriteTeamId ? fixture.awayTeam : fixture.homeTeam;
  const isHome = fixture.homeTeamId === user.favoriteTeamId;
  const myTeam = isHome ? fixture.homeTeam : fixture.awayTeam;
  const matchLabel =
    fixture.homeScore !== null && fixture.awayScore !== null
      ? `${fixture.homeTeam.shortName ?? fixture.homeTeam.name} ${fixture.homeScore}–${fixture.awayScore} ${fixture.awayTeam.shortName ?? fixture.awayTeam.name}`
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink fallbackHref="/fixtures" />
        <h1 className="text-2xl font-bold">
          {isHome ? "vs" : "@"} {opponent.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {fixture.competition.name} · Kickoff <LocalTime iso={fixture.kickoffAt.toISOString()} /> · Locks{" "}
          <LocalTime iso={fixture.lockAt.toISOString()} />
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
          teamId={user.favoriteTeamId}
          squad={squad}
          locked={locked}
          existingSlots={existing?.slots.map((s) => ({
            slotIndex: s.slotIndex,
            squadPlayerId: s.squadPlayerId,
            isCorrect: s.isCorrect,
          })) ?? []}
          initialFormation={(existing?.formation as Formation | undefined) ?? "4-4-2"}
          teamColors={getTeamColors(myTeam.externalId)}
          pointsAwarded={existing?.pointsAwarded ?? null}
          isPerfectXi={existing?.isPerfectXi ?? null}
          scored={scored}
          officialLineup={officialLineup}
          matchLabel={matchLabel}
          matchdayLabel={`${fixture.competition.name} · Final`}
          perfectXiCount={user.perfectXiCount}
          predictionId={existing?.id}
        />
      )}
    </div>
  );
}
