import { prisma } from "@/lib/prisma";

/**
 * No leaderboard page keeps a persisted rank — both existing leaderboards just fetch top-100 and
 * derive rank from array index. For a user who may not be in that top slice, this computes their
 * exact rank via a count query using the same tiebreak order (rulebook §9: total points, then
 * Perfect XIs, then earliest account creation).
 */
export async function computeGlobalRank(
  user: { id: string; totalPoints: number; perfectXiCount: number; createdAt: Date },
  favoriteTeamId?: string,
): Promise<number> {
  const higherCount = await prisma.user.count({
    where: {
      ...(favoriteTeamId ? { favoriteTeamId } : {}),
      OR: [
        { totalPoints: { gt: user.totalPoints } },
        { totalPoints: user.totalPoints, perfectXiCount: { gt: user.perfectXiCount } },
        {
          totalPoints: user.totalPoints,
          perfectXiCount: user.perfectXiCount,
          createdAt: { lt: user.createdAt },
        },
      ],
    },
  });
  return higherCount + 1;
}

/**
 * Per-league standings, computed at read time from Prediction.pointsAwarded scoped to that
 * league — same "no materialized leaderboard needed at this scale" reasoning already used for
 * the global/team leaderboards, since private-league membership counts are small.
 */
export async function computeLeagueStandings(
  privateLeagueId: string,
): Promise<{ userId: string; points: number }[]> {
  const rows = await prisma.prediction.groupBy({
    by: ["userId"],
    where: { privateLeagueId },
    _sum: { pointsAwarded: true },
  });
  return rows
    .map((r) => ({ userId: r.userId, points: r._sum.pointsAwarded ?? 0 }))
    .sort((a, b) => b.points - a.points);
}
