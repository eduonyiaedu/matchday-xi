import { prisma } from "@/lib/prisma";
import { queuePushes } from "@/lib/push";
import type { PlannedPush } from "@/lib/prize-notify";
import { recomputeCurrentSeasonTotals, type SeasonInfo } from "@/lib/seasons";

const DELETED_EMAIL_SUFFIX = "@deleted.matchday-xi.app";
/** A rollover claim older than this that never finished (the function was killed) can be retaken. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * New-season club choice (founder's decision, 2026-09-23): a player's club is locked by their
 * first prediction, and that lock used to be permanent — nobody could ever switch club for a new
 * season. When a new season starts, locks are cleared, returning players get a push asking them to
 * keep or change their club, and Home shows the same question until they answer or make their
 * first prediction of the new season (which locks the club again — predictions/route.ts).
 *
 * Only clears the locks of players who haven't predicted in the new season yet: football-data.org
 * may only switch to the new season after its first predictions (they open 24h before kickoff), and
 * clearing a lock set by a new-season prediction would let that player switch club mid-season with
 * their points already on the old club.
 */
export async function clearClubLocksForNewSeason(startDate: Date): Promise<number> {
  const { count } = await prisma.user.updateMany({
    where: {
      favoriteTeamLockedAt: { not: null },
      predictions: { none: { privateLeagueId: null, fixture: { kickoffAt: { gte: startDate } } } },
    },
    data: { favoriteTeamLockedAt: null },
  });
  return count;
}

/**
 * Who gets the "new season — keep or change your club?" push: returning players whose club is now
 * unlocked (so not anyone who already predicted this season). Planning only; sends nothing.
 */
export async function planNewSeasonPushes(season: Pick<SeasonInfo, "label" | "startDate">): Promise<PlannedPush[]> {
  const players = await prisma.user.findMany({
    where: {
      favoriteTeamId: { not: null },
      favoriteTeamLockedAt: null,
      createdAt: { lt: season.startDate }, // returning players — anyone newer picked their club just now
      NOT: { email: { endsWith: DELETED_EMAIL_SUFFIX } },
    },
    select: { id: true, favoriteTeam: { select: { name: true, shortName: true } } },
  });
  const byClub = new Map<string, string[]>();
  for (const p of players) {
    const club = p.favoriteTeam?.shortName ?? p.favoriteTeam?.name ?? "your club";
    byClub.set(club, [...(byClub.get(club) ?? []), p.id]);
  }
  return [...byClub.entries()].map(([club, userIds]) => ({
    userIds,
    payload: {
      title: "Matchday XI",
      body: `The ${season.label} season is here! ⚽\nKeep supporting ${club}, or switch clubs before your first prediction.`,
      url: "/home",
    },
  }));
}

/**
 * Start-of-season work, run by the standings sync on every run until it has succeeded once for
 * the current season: reset everyone's totals to the new season's, and — unless this is the very
 * first season ever recorded — clear club locks and announce. Claimed atomically (cron and the
 * admin sync button can overlap); a failure releases the claim so the next sync retries, rather
 * than the rollover silently never happening (it used to hang off "was the Season row just
 * created?", which is true for exactly one run). Pushes go out after the work is marked done:
 * best-effort, never retried, so a retry can't announce twice.
 */
export async function runSeasonRolloverIfNeeded(
  season: Pick<SeasonInfo, "id" | "label" | "startDate">,
  opts: { firstSeasonEver: boolean },
) {
  const now = new Date();
  const { count } = await prisma.season.updateMany({
    where: {
      id: season.id,
      rolloverDoneAt: null,
      OR: [{ rolloverClaimedAt: null }, { rolloverClaimedAt: { lt: new Date(now.getTime() - STALE_CLAIM_MS) } }],
    },
    data: { rolloverClaimedAt: now },
  });
  if (count === 0) return null;

  let seasonTotalsReset: number;
  let unlocked = 0;
  try {
    seasonTotalsReset = await recomputeCurrentSeasonTotals();
    if (!opts.firstSeasonEver) unlocked = await clearClubLocksForNewSeason(season.startDate);
    await prisma.season.update({ where: { id: season.id }, data: { rolloverDoneAt: new Date() } });
  } catch (error) {
    await prisma.season.update({ where: { id: season.id }, data: { rolloverClaimedAt: null } });
    throw error;
  }

  let pushed = 0;
  if (!opts.firstSeasonEver) {
    const plan = await planNewSeasonPushes(season);
    if (await queuePushes(plan, "broadcast")) pushed = plan.reduce((n, p) => n + p.userIds.length, 0);
  }
  return { seasonTotalsReset, unlocked, pushed };
}
