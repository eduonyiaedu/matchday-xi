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

/**
 * Full leaderboard rows for a private league's own table — same fields as the public
 * global/team leaderboards (see components/leaderboard/leaderboard-table.tsx) but scoped to
 * this league's own points and Perfect XI count, and using the team each member picked *for
 * this league* rather than their global favorite team (the two can differ).
 */
export async function getLeagueLeaderboardRows(privateLeagueId: string) {
  const [standings, memberships, perfectXiCounts] = await Promise.all([
    computeLeagueStandings(privateLeagueId),
    prisma.privateLeagueMembership.findMany({
      where: { leagueId: privateLeagueId, status: "APPROVED" },
      include: { user: { select: { displayName: true, username: true } }, team: { select: { externalId: true } } },
    }),
    prisma.prediction.groupBy({
      by: ["userId"],
      where: { privateLeagueId, isPerfectXi: true },
      _count: true,
    }),
  ]);

  const pointsByUserId = new Map(standings.map((s) => [s.userId, s.points]));
  const perfectXiByUserId = new Map(perfectXiCounts.map((p) => [p.userId, p._count]));

  // Every approved member appears, even with zero points (no prediction yet) — matches the
  // public leaderboards, which likewise show every user rather than only ones who've scored.
  return memberships
    .map((m) => ({
      userId: m.userId,
      displayName: m.user.displayName,
      username: m.user.username,
      teamExternalId: m.team?.externalId ?? 0,
      totalPoints: pointsByUserId.get(m.userId) ?? 0,
      perfectXiCount: perfectXiByUserId.get(m.userId) ?? 0,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints || b.perfectXiCount - a.perfectXiCount)
    .map((row, i) => ({ ...row, rank: i + 1 }));
}
