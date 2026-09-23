import { prisma } from "@/lib/prisma";
import { computeGlobalRank } from "@/lib/rank";
import { listSeasons, seasonStandings } from "@/lib/seasons";

export interface LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  username: string;
  teamExternalId: number;
  totalPoints: number;
  perfectXiCount: number;
}

const TOP_N = 100;

/**
 * Everything the global and per-club leaderboard pages show, for the chosen season. The current
 * season reads the denormalized User.totalPoints (reset each season — see lib/seasons.ts), so it
 * stays a fast indexed query. A past season is computed from that season's scored predictions,
 * with a club's board meaning the fans who predicted for that club that season.
 */
export async function getLeaderboard(opts: {
  teamId?: string;
  seasonParam?: string;
  viewer: { id: string; displayName: string; username: string; favoriteTeamId: string | null; totalPoints: number; perfectXiCount: number; createdAt: Date } | null;
}) {
  const [seasons, teams] = await Promise.all([
    listSeasons(),
    prisma.team.findMany({ where: { isPremierLeagueClub: true }, orderBy: { name: "asc" }, select: { id: true, name: true, externalId: true } }),
  ]);
  const externalIdByTeam = new Map(teams.map((t) => [t.id, t.externalId]));
  const current = seasons[0] ?? null;
  const selected = (opts.seasonParam && seasons.find((s) => s.label === opts.seasonParam)) || current;
  const isPast = !!selected && !!current && selected.label !== current.label;
  const { viewer } = opts;

  let rows: LeaderboardRow[];
  let viewerRow: LeaderboardRow | null = null;

  if (isPast && selected) {
    const standings = await seasonStandings(selected, { teamId: opts.teamId });
    const all = standings.map((s, i) => ({
      rank: i + 1,
      userId: s.userId,
      displayName: s.displayName,
      username: s.username,
      teamExternalId: externalIdByTeam.get(s.teamId) ?? 0,
      totalPoints: s.totalPoints,
      perfectXiCount: s.perfectXiCount,
    }));
    rows = all.slice(0, TOP_N);
    viewerRow = viewer ? (all.find((r) => r.userId === viewer.id) ?? null) : null;
  } else {
    const users = await prisma.user.findMany({
      where: { favoriteTeamId: opts.teamId ?? { not: null } },
      // Rulebook §9 tiebreaker: Perfect XIs, then earliest account creation.
      orderBy: [{ totalPoints: "desc" }, { perfectXiCount: "desc" }, { createdAt: "asc" }],
      take: TOP_N,
      select: { id: true, displayName: true, username: true, totalPoints: true, perfectXiCount: true, favoriteTeamId: true },
    });
    rows = users.map((u, i) => ({
      rank: i + 1,
      userId: u.id,
      displayName: u.displayName,
      username: u.username,
      teamExternalId: externalIdByTeam.get(u.favoriteTeamId!) ?? 0,
      totalPoints: u.totalPoints,
      perfectXiCount: u.perfectXiCount,
    }));
    const viewerOnBoard = viewer?.favoriteTeamId && (!opts.teamId || viewer.favoriteTeamId === opts.teamId);
    if (viewer && viewerOnBoard) {
      viewerRow = {
        rank: await computeGlobalRank(viewer, opts.teamId),
        userId: viewer.id,
        displayName: viewer.displayName,
        username: viewer.username,
        teamExternalId: externalIdByTeam.get(viewer.favoriteTeamId!) ?? 0,
        totalPoints: viewer.totalPoints,
        perfectXiCount: viewer.perfectXiCount,
      };
    }
  }

  return {
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    seasonLabels: seasons.map((s) => s.label),
    selectedSeason: selected?.label ?? null,
    isPast,
    rows,
    viewerRow,
  };
}
