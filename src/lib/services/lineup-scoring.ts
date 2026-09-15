import { prisma } from "@/lib/prisma";
import { scorePrediction } from "@/lib/scoring";
import type { LineupSource } from "@/generated/prisma/enums";

export interface LineupEntryInput {
  squadPlayerId: string | null;
  rawApiFootballPlayerId: number | null;
  rawName: string;
  isGoalkeeper: boolean;
}

/**
 * Records one side's official starting XI and scores every prediction made for that team in
 * this fixture — shared by the automated API-Football path (lib/services/lineup-check.ts) and
 * the admin manual-entry fallback (app/api/admin/lineups/[fixtureId]/route.ts), so a manually
 * entered lineup produces exactly the same downstream effects (points, Perfect XI count, slot
 * correctness) as an automated one.
 */
export async function applyOfficialLineup(
  fixtureId: string,
  teamId: string,
  entries: LineupEntryInput[],
  options: { formation?: string | null; source: LineupSource } = { source: "AUTOMATED" },
) {
  const resolvedPlayerIds = entries.map((e) => e.squadPlayerId).filter((id): id is string => !!id);

  const officialLineup = await prisma.officialLineup.upsert({
    where: { fixtureId_teamId: { fixtureId, teamId } },
    update: { formation: options.formation ?? undefined, source: options.source, fetchedAt: new Date() },
    create: { fixtureId, teamId, formation: options.formation ?? undefined, source: options.source },
  });

  // Clear out any previous (e.g. earlier pre-kickoff, or a prior manual entry being corrected)
  // entries — the latest confirmed XI always supersedes what came before (rulebook §6).
  await prisma.officialLineupPlayer.deleteMany({ where: { officialLineupId: officialLineup.id } });

  for (const entry of entries) {
    await prisma.officialLineupPlayer.create({
      data: {
        officialLineupId: officialLineup.id,
        squadPlayerId: entry.squadPlayerId,
        rawApiFootballPlayerId: entry.rawApiFootballPlayerId,
        rawName: entry.rawName,
        isGoalkeeper: entry.isGoalkeeper,
      },
    });
  }

  const predictions = await prisma.prediction.findMany({
    where: { fixtureId, teamId },
    include: { slots: true },
  });

  for (const prediction of predictions) {
    const predictedIds = prediction.slots.map((s) => s.squadPlayerId);
    const { correctSquadPlayerIds, pointsAwarded, isPerfectXi } = scorePrediction(
      predictedIds,
      resolvedPlayerIds,
    );
    const correctSet = new Set(correctSquadPlayerIds);

    await prisma.$transaction(async (tx) => {
      await tx.prediction.update({
        where: { id: prediction.id },
        data: { pointsAwarded, isPerfectXi, scoredAt: new Date() },
      });
      for (const slot of prediction.slots) {
        await tx.predictionSlot.update({
          where: { id: slot.id },
          data: { isCorrect: correctSet.has(slot.squadPlayerId) },
        });
      }
      // Private-league predictions score separately and never touch global/team totals (§12b).
      if (!prediction.privateLeagueId) {
        await tx.user.update({
          where: { id: prediction.userId },
          data: {
            totalPoints: { increment: pointsAwarded },
            perfectXiCount: { increment: isPerfectXi ? 1 : 0 },
          },
        });
      }
    });
  }

  const refreshed = await prisma.officialLineup.findMany({ where: { fixtureId } });
  const fixture = await prisma.fixture.findUniqueOrThrow({
    where: { id: fixtureId },
    select: { homeTeamId: true, awayTeamId: true },
  });
  const bothDone =
    refreshed.some((l) => l.teamId === fixture.homeTeamId) &&
    refreshed.some((l) => l.teamId === fixture.awayTeamId);

  if (bothDone) {
    await prisma.fixture.update({ where: { id: fixtureId }, data: { status: "SCORED" } });
  }

  return { resolvedCount: resolvedPlayerIds.length, predictionsScored: predictions.length, bothDone };
}
