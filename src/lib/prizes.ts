import { prisma } from "@/lib/prisma";
import crypto from "node:crypto";

function monthKey(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

function monthRangeUtc(monthKeyStr: string): { start: Date; end: Date; dayCount: number } {
  const [year, month] = monthKeyStr.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1)); // exclusive
  const dayCount = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return { start, end, dayCount };
}

/**
 * Read-only "so far this month" progress for the prizes page — unlike computeMonthlyEligibility
 * (which only ever runs once a month, for the month that just fully elapsed, and persists a row),
 * this compares against days/fixtures that have actually happened yet so it's meaningful mid-month.
 * Nothing here is persisted — it's recomputed on every page view.
 */
export async function computeLiveMonthlyProgress(userId: string, favoriteTeamId: string) {
  const now = new Date();
  const monthKeyStr = monthKey(now.getUTCFullYear(), now.getUTCMonth());
  const { start } = monthRangeUtc(monthKeyStr);
  const elapsedDays = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  const loginCount = await prisma.dailyLoginLog.count({
    where: { userId, loginDate: { gte: start, lte: now } },
  });
  const loggedInEveryDaySoFar = loginCount >= elapsedDays;

  const teamFixturesSoFar = await prisma.fixture.findMany({
    where: {
      kickoffAt: { gte: start, lte: now },
      status: { not: "VOIDED" },
      OR: [{ homeTeamId: favoriteTeamId }, { awayTeamId: favoriteTeamId }],
    },
    select: { id: true },
  });

  let predictedEveryMatchdaySoFar = true;
  if (teamFixturesSoFar.length > 0) {
    const predictedCount = await prisma.prediction.count({
      where: { userId, privateLeagueId: null, fixtureId: { in: teamFixturesSoFar.map((f) => f.id) } },
    });
    predictedEveryMatchdaySoFar = predictedCount >= teamFixturesSoFar.length;
  }

  return { month: monthKeyStr, loggedInEveryDaySoFar, predictedEveryMatchdaySoFar };
}

/**
 * Rulebook §9: eligible for the monthly random draw if the user (a) submitted a global/team
 * prediction for every one of their team's matchdays that month, and (b) logged in every day
 * of that month. Only ever run for a month that has fully elapsed.
 */
export async function computeMonthlyEligibility(monthKeyStr: string) {
  const { start, end, dayCount } = monthRangeUtc(monthKeyStr);

  // A handful of whole-month queries, not ~3 per user: this used to loop user by user, which at a
  // few thousand users would outrun the daily-rollup route's 60s limit (~3 round trips each). The
  // rules are unchanged — (a) logged in on every day of the month, (b) a global prediction for
  // every non-voided fixture of their current favourite team that month (vacuously true if the
  // team had none).
  const [users, logins, monthFixtures] = await Promise.all([
    prisma.user.findMany({ where: { favoriteTeamId: { not: null } }, select: { id: true, favoriteTeamId: true } }),
    prisma.dailyLoginLog.groupBy({ by: ["userId"], where: { loginDate: { gte: start, lt: end } }, _count: { _all: true } }),
    prisma.fixture.findMany({
      where: { kickoffAt: { gte: start, lt: end }, status: { not: "VOIDED" } },
      select: { id: true, homeTeamId: true, awayTeamId: true },
    }),
  ]);
  const predictions = await prisma.prediction.findMany({
    where: { privateLeagueId: null, fixtureId: { in: monthFixtures.map((f) => f.id) } },
    select: { userId: true, fixtureId: true },
  });

  const loginCountByUser = new Map(logins.map((l) => [l.userId, l._count._all]));
  const fixtureIdsByTeam = new Map<string, Set<string>>();
  for (const f of monthFixtures) {
    for (const teamId of [f.homeTeamId, f.awayTeamId]) {
      const ids = fixtureIdsByTeam.get(teamId) ?? new Set<string>();
      ids.add(f.id);
      fixtureIdsByTeam.set(teamId, ids);
    }
  }
  const predictedFixturesByUser = new Map<string, Set<string>>();
  for (const p of predictions) {
    const ids = predictedFixturesByUser.get(p.userId) ?? new Set<string>();
    ids.add(p.fixtureId);
    predictedFixturesByUser.set(p.userId, ids);
  }

  const rows = users.map((user) => {
    const loggedInEveryDay = (loginCountByUser.get(user.id) ?? 0) >= dayCount;
    const teamFixtureIds = fixtureIdsByTeam.get(user.favoriteTeamId!) ?? new Set<string>();
    const predicted = predictedFixturesByUser.get(user.id) ?? new Set<string>();
    const predictedEveryMatchday = [...teamFixtureIds].every((id) => predicted.has(id));
    return {
      userId: user.id,
      month: monthKeyStr,
      loggedInEveryDay,
      predictedEveryMatchday,
      isEligible: loggedInEveryDay && predictedEveryMatchday,
      computedAt: new Date(),
    };
  });

  // Replace the month's rows wholesale (a retry must overwrite an earlier partial run). Locked so
  // two overlapping rollup calls can't interleave their delete/insert and collide on the
  // (userId, month) unique key.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"monthly-eligibility:" + monthKeyStr}))`;
      await tx.monthlyPrizeEligibility.deleteMany({ where: { month: monthKeyStr } });
      for (let i = 0; i < rows.length; i += 5_000) {
        await tx.monthlyPrizeEligibility.createMany({ data: rows.slice(i, i + 5_000) });
      }
    },
    { timeout: 30_000 },
  );

  return { month: monthKeyStr, usersChecked: users.length, eligibleCount: rows.filter((r) => r.isEligible).length };
}

/** Random draw among eligible, non-duplicate-flagged users (rulebook §9-§10). Idempotent per month. */
export async function performMonthlyDraw(monthKeyStr: string) {
  return prisma.$transaction(async (tx) => {
    // Guards against two overlapping invocations (a retried daily-rollup call, or a request
    // that outlives Vercel's timeout and gets re-fired) both passing the "not drawn yet" check
    // before either commits — without the lock, the second call's upsert would silently overwrite
    // the first call's already-picked (and possibly already-notified) winner with a new random
    // pick, since eligible.length > 0 makes crypto.randomInt non-deterministic across calls.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"monthly-draw:" + monthKeyStr}))`;

    const existing = await tx.monthlyPrizeDraw.findUnique({ where: { month: monthKeyStr } });
    if (existing?.drawnAt) return existing;

    const eligible = await tx.monthlyPrizeEligibility.findMany({
      where: { month: monthKeyStr, isEligible: true, user: { isFlaggedDuplicate: false } },
      select: { userId: true },
    });

    const winnerUserId =
      eligible.length > 0 ? eligible[crypto.randomInt(eligible.length)].userId : null;

    return tx.monthlyPrizeDraw.upsert({
      where: { month: monthKeyStr },
      update: { winnerUserId, eligibleCount: eligible.length, drawnAt: new Date() },
      create: { month: monthKeyStr, winnerUserId, eligibleCount: eligible.length, drawnAt: new Date() },
    });
  });
}

// How long into a new month a missed draw for the month before is still retried.
const DRAW_CATCH_UP_DAYS = 7;

/**
 * Runs daily; computes eligibility + draws a winner for the month that just ended. Normally does
 * its work on the 1st, but it keeps retrying daily through the first week until that month's draw
 * has actually completed — it used to act ONLY on the 1st, so one failed call that day (a DB blip,
 * a timeout, a missed cron trigger) meant that month's prize was simply never drawn. The catch-up
 * is capped at the first week so it can't reach back to a month from before the app existed.
 * Safe to re-run (performMonthlyDraw short-circuits once a month is already drawn).
 */
export async function runMonthlyPrizeRollupIfDue() {
  const now = new Date();
  if (now.getUTCDate() > DRAW_CATCH_UP_DAYS) {
    return { ran: false, reason: `past day ${DRAW_CATCH_UP_DAYS} of the month (UTC)` };
  }

  const prevMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const key = monthKey(prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth());

  const existingDraw = await prisma.monthlyPrizeDraw.findUnique({ where: { month: key }, select: { drawnAt: true } });
  if (existingDraw?.drawnAt) return { ran: false, reason: `${key} already drawn` };

  const eligibility = await computeMonthlyEligibility(key);
  const draw = await performMonthlyDraw(key);
  return { ran: true, month: key, eligibility, draw };
}
