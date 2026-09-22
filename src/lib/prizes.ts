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

  const users = await prisma.user.findMany({
    where: { favoriteTeamId: { not: null } },
    select: { id: true, favoriteTeamId: true },
  });

  let eligibleCount = 0;

  for (const user of users) {
    const loginCount = await prisma.dailyLoginLog.count({
      where: { userId: user.id, loginDate: { gte: start, lt: end } },
    });
    const loggedInEveryDay = loginCount >= dayCount;

    const teamFixtures = await prisma.fixture.findMany({
      where: {
        kickoffAt: { gte: start, lt: end },
        status: { not: "VOIDED" },
        OR: [{ homeTeamId: user.favoriteTeamId! }, { awayTeamId: user.favoriteTeamId! }],
      },
      select: { id: true },
    });

    let predictedEveryMatchday = true;
    if (teamFixtures.length > 0) {
      const predictedCount = await prisma.prediction.count({
        where: {
          userId: user.id,
          privateLeagueId: null,
          fixtureId: { in: teamFixtures.map((f) => f.id) },
        },
      });
      predictedEveryMatchday = predictedCount >= teamFixtures.length;
    }

    const isEligible = loggedInEveryDay && predictedEveryMatchday;
    if (isEligible) eligibleCount += 1;

    await prisma.monthlyPrizeEligibility.upsert({
      where: { userId_month: { userId: user.id, month: monthKeyStr } },
      update: { predictedEveryMatchday, loggedInEveryDay, isEligible, computedAt: new Date() },
      create: { userId: user.id, month: monthKeyStr, predictedEveryMatchday, loggedInEveryDay, isEligible },
    });
  }

  return { month: monthKeyStr, usersChecked: users.length, eligibleCount };
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

/**
 * Runs daily; only does real work on the 1st of a month, computing eligibility + drawing a
 * winner for the month that just ended. Cheap no-op on every other day, and safe to re-run
 * (performMonthlyDraw short-circuits once a month is already drawn).
 */
export async function runMonthlyPrizeRollupIfDue() {
  const now = new Date();
  if (now.getUTCDate() !== 1) return { ran: false, reason: "not the 1st of the month (UTC)" };

  const prevMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const key = monthKey(prevMonthDate.getUTCFullYear(), prevMonthDate.getUTCMonth());

  const eligibility = await computeMonthlyEligibility(key);
  const draw = await performMonthlyDraw(key);
  return { ran: true, month: key, eligibility, draw };
}
