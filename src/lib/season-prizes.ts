import { prisma } from "@/lib/prisma";
import { COMPETITION_CODES } from "@/lib/football-data/client";
import { REAL_FIXTURES_ONLY } from "@/lib/real-fixture";

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

function seasonInfo(competitionId: string, start: Date, end: Date, now: Date): SeasonInfo {
  return {
    competitionId,
    label: `${start.getUTCFullYear()}-${String(end.getUTCFullYear()).slice(-2)}`,
    startDate: start,
    endDate: end,
    ended: now.getTime() >= end.getTime() + DAY_MS,
  };
}

/**
 * The season whose prizes are up for confirmation. Normally the Premier League's current season
 * (as last recorded by the standings sync) — but if football-data.org has already rolled over to
 * the next season and the previous one's prizes were never confirmed, it's that previous season:
 * otherwise a season not confirmed before the summer rollover could never be confirmed at all.
 * Null if no season dates are known yet.
 */
export async function getPrizeSeason(now = new Date()): Promise<SeasonInfo | null> {
  const competition = await prisma.competition.findUnique({ where: { externalId: COMPETITION_CODES.PREMIER_LEAGUE } });
  if (!competition) return null;

  if (competition.previousSeasonStartDate && competition.previousSeasonEndDate) {
    const previous = seasonInfo(competition.id, competition.previousSeasonStartDate, competition.previousSeasonEndDate, now);
    const [confirmed, scored] = await Promise.all([
      prisma.seasonPrize.count({ where: { competitionId: competition.id, season: previous.label } }),
      // A season nobody scored in has no podium to confirm — without this check it would sit
      // "awaiting confirmation" forever and block the current season from ever being confirmed.
      prisma.prediction.count({ where: { ...seasonPredictionFilter(previous), pointsAwarded: { gt: 0 } } }),
    ]);
    if (confirmed === 0 && scored > 0) return previous;
  }
  if (!competition.currentSeasonStartDate || !competition.currentSeasonEndDate) return null;
  return seasonInfo(competition.id, competition.currentSeasonStartDate, competition.currentSeasonEndDate, now);
}

type PodiumClient = Pick<typeof prisma, "user" | "prediction">;

/** Global predictions for real fixtures kicking off within the season (its last day included). */
function seasonPredictionFilter(season: SeasonInfo) {
  return {
    privateLeagueId: null,
    fixture: {
      ...REAL_FIXTURES_ONLY,
      kickoffAt: { gte: season.startDate, lt: new Date(season.endDate.getTime() + DAY_MS) },
    },
  };
}

/**
 * The season's top 3 as prize placings, ranked on points scored IN THAT SEASON — the sum of
 * global predictions for fixtures kicking off within the season's dates — not User.totalPoints,
 * which never resets and would carry one season's points into the next. Same tiebreaks as the
 * leaderboard (Perfect XIs in the season, then earliest sign-up — rulebook §9), minus anyone who
 * can't take a prize: flagged duplicate accounts (rulebook §10), deleted/anonymized accounts, and
 * anyone on zero points.
 */
export async function provisionalPodium(season: SeasonInfo, client: PodiumClient = prisma) {
  const inSeason = { ...seasonPredictionFilter(season), pointsAwarded: { not: null } };
  const [pointsByUser, perfectByUser] = await Promise.all([
    client.prediction.groupBy({ by: ["userId"], where: inSeason, _sum: { pointsAwarded: true } }),
    client.prediction.groupBy({ by: ["userId"], where: { ...inSeason, isPerfectXi: true }, _count: { _all: true } }),
  ]);
  const points = new Map(pointsByUser.map((p) => [p.userId, p._sum.pointsAwarded ?? 0]));
  const perfect = new Map(perfectByUser.map((p) => [p.userId, p._count._all]));

  const users = await client.user.findMany({
    where: {
      id: { in: [...points.entries()].filter(([, pts]) => pts > 0).map(([id]) => id) },
      isFlaggedDuplicate: false,
      NOT: { email: { endsWith: DELETED_EMAIL_SUFFIX } },
    },
    select: { id: true, displayName: true, username: true, email: true, createdAt: true },
  });

  return users
    .map((u) => ({ ...u, totalPoints: points.get(u.id) ?? 0, perfectXiCount: perfect.get(u.id) ?? 0 }))
    .sort((a, b) => b.totalPoints - a.totalPoints || b.perfectXiCount - a.perfectXiCount || a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, PRIZE_PLACES);
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
  const season = await getPrizeSeason(now);
  if (!season) throw new Error("The current season's dates aren't known yet — the standings sync records them.");
  if (!season.ended) throw new SeasonNotOverError(season.endDate);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`season-prizes:${season.competitionId}:${season.label}`}))`;
    const existing = await tx.seasonPrize.findMany({ where: { competitionId: season.competitionId, season: season.label } });
    if (existing.length > 0) return { created: false, count: existing.length };

    const podium = await provisionalPodium(season, tx);
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
