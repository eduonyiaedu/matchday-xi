import { prisma } from "@/lib/prisma";
import { listSeasons, seasonPredictionFilter, seasonStandings, type SeasonInfo } from "@/lib/seasons";

export const PRIZE_PLACES = 3;
export type { SeasonInfo } from "@/lib/seasons";

/**
 * The season whose prizes are up for confirmation: the oldest season that has ended, had any
 * scoring, and hasn't been confirmed yet — so a season not confirmed before football-data.org
 * rolls over to the next one can still be confirmed afterwards. Otherwise the current season
 * (shown with live standings until it ends). Seasons nobody scored in are skipped, so they can't
 * sit "awaiting confirmation" forever and block the next one. Null if no seasons are known yet.
 */
export async function getPrizeSeason(now = new Date()): Promise<SeasonInfo | null> {
  const seasons = await listSeasons(now);
  if (seasons.length === 0) return null;
  for (const season of [...seasons].reverse()) {
    if (!season.ended) continue;
    const [confirmed, scored] = await Promise.all([
      prisma.seasonPrize.count({ where: { competitionId: season.competitionId, season: season.label } }),
      prisma.prediction.count({ where: { ...seasonPredictionFilter(season), pointsAwarded: { gt: 0 } } }),
    ]);
    if (confirmed === 0 && scored > 0) return season;
  }
  return seasons[0];
}

type PodiumClient = Pick<typeof prisma, "user" | "prediction">;

/**
 * The season's top 3 as prize placings: the top of that season's own standings (points scored in
 * the season — see seasonStandings — never the all-time totals), minus anyone who can't take a
 * prize: flagged duplicate accounts (rulebook §10), deleted/anonymized accounts, and anyone on
 * zero points.
 */
export async function provisionalPodium(season: SeasonInfo, client: PodiumClient = prisma) {
  const standings = await seasonStandings(season, {}, client);
  return standings
    .filter((row) => !row.isFlaggedDuplicate && !row.isDeleted && row.totalPoints > 0)
    .slice(0, PRIZE_PLACES)
    .map((row) => ({
      id: row.userId,
      displayName: row.displayName,
      username: row.username,
      email: row.email,
      totalPoints: row.totalPoints,
      perfectXiCount: row.perfectXiCount,
    }));
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
