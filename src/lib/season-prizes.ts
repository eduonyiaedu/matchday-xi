import { prisma } from "@/lib/prisma";
import { COMPETITION_CODES } from "@/lib/football-data/client";

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETED_EMAIL_SUFFIX = "@deleted.matchday-xi.app";
export const PRIZE_PLACES = 3;

export interface SeasonInfo {
  competitionId: string;
  label: string; // "2026-27"
  startDate: Date;
  endDate: Date;
  /** The season's last day has fully passed (UTC). */
  ended: boolean;
}

/** The Premier League's current season as last recorded by the standings sync, or null if unknown. */
export async function getCurrentSeason(now = new Date()): Promise<SeasonInfo | null> {
  const competition = await prisma.competition.findUnique({ where: { externalId: COMPETITION_CODES.PREMIER_LEAGUE } });
  if (!competition?.currentSeasonStartDate || !competition.currentSeasonEndDate) return null;
  const start = competition.currentSeasonStartDate;
  const end = competition.currentSeasonEndDate;
  return {
    competitionId: competition.id,
    label: `${start.getUTCFullYear()}-${String(end.getUTCFullYear()).slice(-2)}`,
    startDate: start,
    endDate: end,
    ended: now.getTime() >= end.getTime() + DAY_MS,
  };
}

/**
 * The top of the global leaderboard as prize placings: same order as the leaderboard itself
 * (points, then Perfect XIs, then earliest sign-up — rulebook §9), minus anyone who can't take a
 * prize — flagged duplicate accounts (rulebook §10), deleted/anonymized accounts, and anyone on
 * zero points.
 */
export async function provisionalPodium(client: Pick<typeof prisma, "user"> = prisma) {
  return client.user.findMany({
    where: {
      favoriteTeamId: { not: null },
      isFlaggedDuplicate: false,
      totalPoints: { gt: 0 },
      NOT: { email: { endsWith: DELETED_EMAIL_SUFFIX } },
    },
    orderBy: [{ totalPoints: "desc" }, { perfectXiCount: "desc" }, { createdAt: "asc" }],
    take: PRIZE_PLACES,
    select: { id: true, displayName: true, username: true, email: true, totalPoints: true, perfectXiCount: true },
  });
}

export class SeasonNotOverError extends Error {
  constructor(endDate: Date) {
    super(`The season hasn't finished yet — winners can be confirmed from the day after ${endDate.toISOString().slice(0, 10)}.`);
    this.name = "SeasonNotOverError";
  }
}

/**
 * Locks in the season's 1st/2nd/3rd, founder-confirmed from /admin/prizes. Refuses before the
 * season's last day has passed. Idempotent and race-safe: an advisory lock serializes concurrent
 * confirmations (a double-click, two tabs), and a season that's already confirmed just returns its
 * existing placings — so the podium is computed and written exactly once.
 */
export async function confirmSeasonPrizes(now = new Date()) {
  const season = await getCurrentSeason(now);
  if (!season) throw new Error("The current season's dates aren't known yet — the standings sync records them.");
  if (!season.ended) throw new SeasonNotOverError(season.endDate);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`season-prizes:${season.competitionId}:${season.label}`}))`;
    const existing = await tx.seasonPrize.findMany({ where: { competitionId: season.competitionId, season: season.label } });
    if (existing.length > 0) return { created: false, count: existing.length };

    const podium = await provisionalPodium(tx);
    await tx.seasonPrize.createMany({
      data: podium.map((u, i) => ({
        competitionId: season.competitionId,
        season: season.label,
        place: i + 1,
        userId: u.id,
        totalPoints: u.totalPoints,
        perfectXiCount: u.perfectXiCount,
      })),
    });
    return { created: true, count: podium.length };
  });
  return { season, ...result };
}
