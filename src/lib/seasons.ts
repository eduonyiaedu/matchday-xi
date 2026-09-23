import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { COMPETITION_CODES } from "@/lib/football-data/client";
import { REAL_FIXTURES_ONLY } from "@/lib/real-fixture";
import { chunked } from "@/lib/chunked";

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETED_EMAIL_SUFFIX = "@deleted.matchday-xi.app";

/**
 * Advisory-lock key serializing season-total writes. Scoring (lineup-scoring.ts) and voiding
 * (void-fixture.ts) take it SHARED — they can run alongside each other — while
 * recomputeCurrentSeasonTotals takes it EXCLUSIVE. Without it, a recompute computed from a
 * snapshot taken just before a scoring transaction commits would then overwrite that
 * transaction's increment, silently losing points.
 */
export const SEASON_TOTALS_LOCK = "season-totals";

export interface SeasonInfo {
  id: string;
  competitionId: string;
  label: string; // "2026-27"
  startDate: Date;
  endDate: Date;
  /** The season's last day has fully passed (UTC). */
  ended: boolean;
}

export function seasonLabel(start: Date, end: Date): string {
  return `${start.getUTCFullYear()}-${String(end.getUTCFullYear()).slice(-2)}`;
}

function toInfo(s: { id: string; competitionId: string; label: string; startDate: Date; endDate: Date }, now = new Date()): SeasonInfo {
  return { ...s, ended: now.getTime() >= s.endDate.getTime() + DAY_MS };
}

/** Every recorded Premier League season, newest first. The first is the current season. */
export async function listSeasons(now = new Date()): Promise<SeasonInfo[]> {
  const seasons = await prisma.season.findMany({
    where: { competition: { externalId: COMPETITION_CODES.PREMIER_LEAGUE } },
    orderBy: { startDate: "desc" },
  });
  return seasons.map((s) => toInfo(s, now));
}

export async function getCurrentSeason(now = new Date()): Promise<SeasonInfo | null> {
  return (await listSeasons(now))[0] ?? null;
}

export class SeasonFrozenError extends Error {
  constructor(label: string | null) {
    super(`The ${label ?? "previous"} season is closed — its results can be viewed but no longer changed.`);
    this.name = "SeasonFrozenError";
  }
}

async function seasonPrizesConfirmed(season: Pick<SeasonInfo, "competitionId" | "label">): Promise<boolean> {
  return (await prisma.seasonPrize.count({ where: { competitionId: season.competitionId, season: season.label } })) > 0;
}

/**
 * A past season is closed — view-only — once a newer season has started and its winners have been
 * confirmed (founder's rule, 2026-09-23: previous seasons can't be changed, only viewed). Until its
 * winners are confirmed it stays correctable, so a final-day match whose lineup failed to fetch
 * can still be entered — otherwise that season's prizes could never be confirmed at all.
 */
export async function isSeasonClosed(season: SeasonInfo, current: SeasonInfo | null): Promise<boolean> {
  if (!current || season.id === current.id) return false;
  return seasonPrizesConfirmed(season);
}

/**
 * For anything about to change a fixture's points (scoring a lineup, voiding): may it, and do its
 * points belong in User.totalPoints / perfectXiCount (the current season's totals)?
 */
export async function fixtureSeasonStatus(
  kickoffAt: Date,
): Promise<{ editable: boolean; inCurrentSeason: boolean; seasonLabel: string | null }> {
  const seasons = await listSeasons();
  const current = seasons[0];
  if (!current || kickoffAt >= current.startDate) {
    return { editable: true, inCurrentSeason: true, seasonLabel: current?.label ?? null };
  }
  const season = seasons.find((s) => kickoffAt >= s.startDate && kickoffAt.getTime() < s.endDate.getTime() + DAY_MS);
  if (!season) return { editable: true, inCurrentSeason: false, seasonLabel: null };
  return { editable: !(await isSeasonClosed(season, current)), inCurrentSeason: false, seasonLabel: season.label };
}

/** The recorded season a kickoff falls in (its last day included), or null. */
export async function seasonForKickoff(kickoffAt: Date): Promise<SeasonInfo | null> {
  const seasons = await listSeasons();
  return (
    seasons.find((s) => kickoffAt >= s.startDate && kickoffAt.getTime() < s.endDate.getTime() + DAY_MS) ?? null
  );
}

/**
 * The Perfect XI count shown alongside one prediction (the celebration takeover, the share card):
 * a private-league prediction counts that league's Perfect XIs; a global one counts that
 * prediction's own season, matching the leaderboard's tiers, which reset each season. Reading
 * User.perfectXiCount instead would show the *current* season's count on an old season's card.
 */
export async function perfectXiCountForPrediction(p: {
  userId: string;
  privateLeagueId: string | null;
  fixture: { kickoffAt: Date };
}): Promise<number> {
  if (p.privateLeagueId) {
    return prisma.prediction.count({ where: { userId: p.userId, privateLeagueId: p.privateLeagueId, isPerfectXi: true } });
  }
  const season = await seasonForKickoff(p.fixture.kickoffAt);
  return prisma.prediction.count({
    where: { userId: p.userId, isPerfectXi: true, ...(season ? seasonPredictionFilter(season) : { privateLeagueId: null }) },
  });
}

/** Records a season seen by the standings sync (idempotent). Returns whether it was new. */
export async function recordSeason(competitionId: string, startDate: Date, endDate: Date): Promise<boolean> {
  const label = seasonLabel(startDate, endDate);
  try {
    await prisma.season.create({ data: { competitionId, label, startDate, endDate } });
    return true;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Already known — keep its dates current in case the provider adjusted them.
      await prisma.season.update({
        where: { competitionId_label: { competitionId, label } },
        data: { startDate, endDate },
      });
      return false;
    }
    throw error;
  }
}

/** Global predictions for real fixtures kicking off within the season (its last day included). */
export function seasonPredictionFilter(season: Pick<SeasonInfo, "startDate" | "endDate">) {
  return {
    privateLeagueId: null,
    fixture: {
      ...REAL_FIXTURES_ONLY,
      kickoffAt: { gte: season.startDate, lt: new Date(season.endDate.getTime() + DAY_MS) },
    },
  };
}

export interface SeasonStandingRow {
  userId: string;
  displayName: string;
  username: string;
  email: string;
  createdAt: Date;
  isFlaggedDuplicate: boolean;
  isDeleted: boolean;
  /** The club this player predicted for that season (the one they scored most with). */
  teamId: string;
  totalPoints: number;
  perfectXiCount: number;
}

type StandingsClient = Pick<typeof prisma, "user" | "prediction">;

/**
 * A season's leaderboard, computed from that season's scored predictions — used for past seasons
 * (the current season's board reads the denormalized User.totalPoints instead) and for the season
 * prize podium. Always exact: built from the underlying results, so a later lineup correction is
 * reflected. Same order as the live leaderboard: points, then Perfect XIs, then earliest sign-up
 * (rulebook §9). `teamId` narrows it to one club's fans (by the club they predicted for).
 */
export async function seasonStandings(
  season: Pick<SeasonInfo, "startDate" | "endDate">,
  opts: { teamId?: string } = {},
  client: StandingsClient = prisma,
): Promise<SeasonStandingRow[]> {
  const where = {
    ...seasonPredictionFilter(season),
    pointsAwarded: { not: null },
    ...(opts.teamId ? { teamId: opts.teamId } : {}),
  };
  const [points, perfect] = await Promise.all([
    client.prediction.groupBy({ by: ["userId", "teamId"], where, _sum: { pointsAwarded: true } }),
    client.prediction.groupBy({ by: ["userId"], where: { ...where, isPerfectXi: true }, _count: { _all: true } }),
  ]);

  const byUser = new Map<string, { total: number; teamId: string; teamPoints: number }>();
  for (const row of points) {
    const pts = row._sum.pointsAwarded ?? 0;
    const cur = byUser.get(row.userId) ?? { total: 0, teamId: row.teamId, teamPoints: -1 };
    cur.total += pts;
    if (pts > cur.teamPoints) {
      cur.teamId = row.teamId;
      cur.teamPoints = pts;
    }
    byUser.set(row.userId, cur);
  }
  const perfectByUser = new Map(perfect.map((p) => [p.userId, p._count._all]));

  const users = await client.user.findMany({
    where: { id: { in: [...byUser.keys()] } },
    select: { id: true, displayName: true, username: true, email: true, createdAt: true, isFlaggedDuplicate: true },
  });
  return users
    .map((u) => ({
      userId: u.id,
      displayName: u.displayName,
      username: u.username,
      email: u.email,
      createdAt: u.createdAt,
      isFlaggedDuplicate: u.isFlaggedDuplicate,
      isDeleted: u.email.endsWith(DELETED_EMAIL_SUFFIX),
      teamId: byUser.get(u.id)!.teamId,
      totalPoints: byUser.get(u.id)!.total,
      perfectXiCount: perfectByUser.get(u.id) ?? 0,
    }))
    .sort((a, b) => b.totalPoints - a.totalPoints || b.perfectXiCount - a.perfectXiCount || a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Saves a closed season's final table to SeasonStandingSnapshot, once — after that, viewing that
 * season's leaderboard is an indexed read instead of re-adding up every prediction of the season.
 * Only for closed seasons (isSeasonClosed), whose results can no longer change. Safe to call
 * concurrently: a lock plus a re-check means the table is written exactly once.
 */
export async function ensureSeasonSnapshot(season: SeasonInfo): Promise<void> {
  const { standingsSnapshotAt } = await prisma.season.findUniqueOrThrow({
    where: { id: season.id },
    select: { standingsSnapshotAt: true },
  });
  if (standingsSnapshotAt) return;

  const standings = await seasonStandings(season);
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"season-snapshot:" + season.id}))`;
      const fresh = await tx.season.findUniqueOrThrow({ where: { id: season.id }, select: { standingsSnapshotAt: true } });
      if (fresh.standingsSnapshotAt) return;
      const rows = standings.map((s, i) => ({
        seasonId: season.id,
        userId: s.userId,
        teamId: s.teamId,
        totalPoints: s.totalPoints,
        perfectXiCount: s.perfectXiCount,
        position: i + 1,
      }));
      // 7 columns a row — 4,000 rows keeps each statement under Postgres's bind-parameter limit.
      for (const chunk of chunked(rows, 4_000)) await tx.seasonStandingSnapshot.createMany({ data: chunk, skipDuplicates: true });
      await tx.season.update({ where: { id: season.id }, data: { standingsSnapshotAt: new Date() } });
    },
    { timeout: 30_000 },
  );
}

/** Players per recompute batch — each batch is its own short transaction. */
const RECOMPUTE_BATCH_SIZE = 2_000;

/**
 * Makes every player's User.totalPoints / perfectXiCount exactly their CURRENT season's totals —
 * the global leaderboard resets each season (founder's decision, 2026-09-23), and those two
 * columns are what the live leaderboard, ranks and nav badge read. Runs at a new season's rollover
 * (the reset) and nightly from the daily rollup (a self-check that corrects any drift).
 *
 * Works through players in batches of RECOMPUTE_BATCH_SIZE, each in its own short transaction
 * holding the exclusive season-totals lock, so the time any one transaction takes (and how long
 * scoring waits on it) stays the same however many players there are — one UPDATE over everyone
 * would eventually outgrow any transaction timeout. Each batch is exact on its own: scoring can't
 * change a batch's players while it holds the lock, and a scoring run between batches is either
 * already reflected in a later batch's read or only touched players already done (both correct).
 * Returns how many rows it changed.
 */
export async function recomputeCurrentSeasonTotals(batchSize = RECOMPUTE_BATCH_SIZE): Promise<number> {
  const season = await getCurrentSeason();
  if (!season) return 0;
  const endExclusive = new Date(season.endDate.getTime() + DAY_MS);

  let changed = 0;
  let afterId = "";
  for (;;) {
    const batch = await prisma.user.findMany({
      where: { id: { gt: afterId } },
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true },
    });
    if (batch.length === 0) break;
    const ids = batch.map((u) => u.id);
    afterId = ids[ids.length - 1];

    changed += await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SEASON_TOTALS_LOCK}))`;
        return tx.$executeRaw`
          WITH season_totals AS (
            SELECT p."userId",
                   SUM(p."pointsAwarded")::int AS pts,
                   COUNT(*) FILTER (WHERE p."isPerfectXi")::int AS pxi
            FROM "Prediction" p
            JOIN "Fixture" f ON f.id = p."fixtureId"
            WHERE p."userId" = ANY(${ids})
              AND p."privateLeagueId" IS NULL
              AND p."pointsAwarded" IS NOT NULL
              AND f."externalId" > 0
              AND f."kickoffAt" >= ${season.startDate}
              AND f."kickoffAt" < ${endExclusive}
            GROUP BY p."userId"
          )
          UPDATE "User" u
          SET "totalPoints" = COALESCE(t.pts, 0), "perfectXiCount" = COALESCE(t.pxi, 0)
          FROM "User" u2
          LEFT JOIN season_totals t ON t."userId" = u2.id
          WHERE u.id = u2.id
            AND u2.id = ANY(${ids})
            AND (u."totalPoints" <> COALESCE(t.pts, 0) OR u."perfectXiCount" <> COALESCE(t.pxi, 0))`;
      },
      { timeout: 15_000 },
    );
    if (batch.length < batchSize) break;
  }
  return changed;
}
