import { prisma } from "@/lib/prisma";

/**
 * Voids a fixture: postponed/abandoned matches get no points awarded either way (rulebook §10).
 * If points were already awarded (lineup arrived, then the match was abandoned), reverses them
 * from the denormalized user totals rather than leaving stale points on the leaderboard.
 * Idempotent — safe to call on a fixture that's already VOIDED.
 */
export async function voidFixtureAndReversePoints(fixtureId: string) {
  await prisma.$transaction(async (tx) => {
    const fixture = await tx.fixture.findUniqueOrThrow({ where: { id: fixtureId } });
    if (fixture.status === "VOIDED") return;

    const scoredPredictions = await tx.prediction.findMany({
      where: { fixtureId, pointsAwarded: { not: null } },
    });

    for (const prediction of scoredPredictions) {
      // Private-league predictions never touched user.totalPoints/perfectXiCount, so only reverse
      // the denormalized aggregates for global/team predictions.
      if (!prediction.privateLeagueId) {
        await tx.user.update({
          where: { id: prediction.userId },
          data: {
            totalPoints: { decrement: prediction.pointsAwarded ?? 0 },
            perfectXiCount: { decrement: prediction.isPerfectXi ? 1 : 0 },
          },
        });
      }
      await tx.prediction.update({
        where: { id: prediction.id },
        data: { pointsAwarded: 0, isPerfectXi: false },
      });
    }

    await tx.fixture.update({ where: { id: fixtureId }, data: { status: "VOIDED" } });
  });
}
