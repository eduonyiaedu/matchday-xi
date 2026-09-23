import { prisma } from "@/lib/prisma";
import { fixtureSeasonStatus, SEASON_TOTALS_LOCK, SeasonFrozenError } from "@/lib/seasons";
import { chunked } from "@/lib/chunked";

/**
 * Voids a fixture: postponed/abandoned matches get no points awarded either way (rulebook §10).
 * If points were already awarded (lineup arrived, then the match was abandoned), reverses them
 * from the denormalized user totals rather than leaving stale points on the leaderboard.
 * Idempotent — safe to call on a fixture that's already VOIDED. Refuses a closed season's fixture
 * (view-only — lib/seasons.ts), and a previous season's points aren't in the current totals, so
 * those are left alone.
 */
export async function voidFixtureAndReversePoints(fixtureId: string) {
  const { kickoffAt, status } = await prisma.fixture.findUniqueOrThrow({
    where: { id: fixtureId },
    select: { kickoffAt: true, status: true },
  });
  if (status === "VOIDED") return;
  const seasonStatus = await fixtureSeasonStatus(kickoffAt);
  if (!seasonStatus.editable) throw new SeasonFrozenError(seasonStatus.seasonLabel);

  await prisma.$transaction(
    async (tx) => {
      // This runs from both the 6-hourly cron and the admin "sync now" button (both call
      // syncAllCompetitionFixtures), so two overlapping calls for the same just-postponed fixture
      // could otherwise both read status !== "VOIDED" before either commits and both decrement the
      // same user's totalPoints — the lock (plus re-reading status after acquiring it) makes the
      // second caller correctly see VOIDED and return without double-reversing.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"void-fixture:" + fixtureId}))`;
      // Shared, same as scoring: never overlaps a season-totals recompute (lib/seasons.ts).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${SEASON_TOTALS_LOCK}))`;
      const fixture = await tx.fixture.findUniqueOrThrow({ where: { id: fixtureId } });
      if (fixture.status === "VOIDED") return;

      // Grouped writes, same reasoning as lineup-scoring.ts: one statement per distinct
      // (points, Perfect XI) outcome rather than one per prediction, so a heavily predicted
      // fixture can't outgrow the transaction timeout.
      if (seasonStatus.inCurrentSeason) {
        // Private-league predictions never touched user.totalPoints/perfectXiCount.
        const scoredGlobal = await tx.prediction.findMany({
          where: { fixtureId, privateLeagueId: null, pointsAwarded: { not: null } },
          select: { userId: true, pointsAwarded: true, isPerfectXi: true },
        });
        const usersByReversal = new Map<string, { points: number; perfectXi: number; ids: string[] }>();
        for (const p of scoredGlobal) {
          const points = p.pointsAwarded ?? 0;
          const perfectXi = p.isPerfectXi ? 1 : 0;
          if (points === 0 && perfectXi === 0) continue;
          const key = `${points}:${perfectXi}`;
          const group = usersByReversal.get(key) ?? { points, perfectXi, ids: [] };
          group.ids.push(p.userId);
          usersByReversal.set(key, group);
        }
        for (const { points, perfectXi, ids } of usersByReversal.values()) {
          for (const chunk of chunked(ids)) {
            await tx.user.updateMany({
              where: { id: { in: chunk } },
              data: { totalPoints: { decrement: points }, perfectXiCount: { decrement: perfectXi } },
            });
          }
        }
      }

      await tx.prediction.updateMany({
        where: { fixtureId, pointsAwarded: { not: null } },
        data: { pointsAwarded: 0, isPerfectXi: false },
      });
      await tx.fixture.update({ where: { id: fixtureId }, data: { status: "VOIDED" } });
    },
    { timeout: 20_000 },
  );
}
