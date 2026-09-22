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
      // Matches the leaderboard list's own filter — otherwise a user who never finished
      // onboarding (no team, always 0 points) still counts toward everyone else's rank via the
      // tiebreak, inflating it with accounts that never actually appear on the board.
      favoriteTeamId: favoriteTeamId ?? { not: null },
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
 * the global/team leaderboards, since private-league membership counts are small. Every
 * approved member appears, even with zero points (no prediction yet), so a member's own rank is
 * always well-defined rather than needing a "not found" fallback. Same 3-level tiebreak as
 * computeGlobalRank (points, then Perfect XIs, then earliest account creation) — without one,
 * tied members (the common case at 0/0 early in a season) sorted in whatever order Postgres
 * happened to return an un-ordered query in, which isn't guaranteed stable across requests and
 * could visibly swap two tied members' rank on nothing but a reload. getLeagueLeaderboardRows
 * below builds directly on this so the two never disagree on how to rank a given tied pair.
 */
export async function computeLeagueStandings(privateLeagueId: string): Promise<
  { userId: string; points: number; perfectXiCount: number; createdAt: Date }[]
> {
  const [memberships, pointsRows, perfectXiRows] = await Promise.all([
    prisma.privateLeagueMembership.findMany({
      where: { leagueId: privateLeagueId, status: "APPROVED" },
      select: { userId: true, user: { select: { createdAt: true } } },
    }),
    prisma.prediction.groupBy({ by: ["userId"], where: { privateLeagueId }, _sum: { pointsAwarded: true } }),
    prisma.prediction.groupBy({ by: ["userId"], where: { privateLeagueId, isPerfectXi: true }, _count: true }),
  ]);

  const pointsByUserId = new Map(pointsRows.map((r) => [r.userId, r._sum.pointsAwarded ?? 0]));
  const perfectXiByUserId = new Map(perfectXiRows.map((r) => [r.userId, r._count]));

  return memberships
    .map((m) => ({
      userId: m.userId,
      points: pointsByUserId.get(m.userId) ?? 0,
      perfectXiCount: perfectXiByUserId.get(m.userId) ?? 0,
      createdAt: m.user.createdAt,
    }))
    .sort(
      (a, b) =>
        b.points - a.points ||
        b.perfectXiCount - a.perfectXiCount ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
}

/**
 * Full leaderboard rows for a private league's own table — same fields as the public
 * global/team leaderboards (see components/leaderboard/leaderboard-table.tsx) but scoped to
 * this league's own points and Perfect XI count, and using the team each member picked *for
 * this league* rather than their global favorite team (the two can differ).
 */
export async function getLeagueLeaderboardRows(privateLeagueId: string) {
  const [standings, memberships] = await Promise.all([
    computeLeagueStandings(privateLeagueId),
    prisma.privateLeagueMembership.findMany({
      where: { leagueId: privateLeagueId, status: "APPROVED" },
      include: { user: { select: { displayName: true, username: true } }, team: { select: { externalId: true } } },
    }),
  ]);

  const membershipByUserId = new Map(memberships.map((m) => [m.userId, m]));

  // Rank order already comes from computeLeagueStandings' own tiebreak — just attach display
  // fields and a 1-based rank in that same order, rather than re-deriving/re-sorting separately.
  return standings.map((s, i) => {
    const membership = membershipByUserId.get(s.userId)!;
    return {
      userId: s.userId,
      displayName: membership.user.displayName,
      username: membership.user.username,
      teamExternalId: membership.team?.externalId ?? 0,
      totalPoints: s.points,
      perfectXiCount: s.perfectXiCount,
      rank: i + 1,
    };
  });
}
