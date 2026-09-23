import { prisma } from "@/lib/prisma";
import { drainPushOutbox, sendPushToUsers } from "@/lib/push";
import { scopeKeyFor } from "@/lib/prediction-scope";
import { REAL_FIXTURES_ONLY } from "@/lib/real-fixture";

const LOCK_WARNING_MINUTES = 30;

/**
 * Push notifications scoped to a user's own favorite team (global scope) — a private-league
 * member predicting for a different club isn't covered here yet, since a single fixture can be
 * "open" for many different leagues on different schedules. Runs alongside lock-sweep (same 5-min
 * cadence already in place). Each fixture's dedup check-and-claim is lock-guarded the same way as
 * lineup-check.ts/matchday-notify.ts, since this job's own cron route documents that a busy tick
 * can exceed the 5-min trigger interval and overlap with the next one.
 */
export async function notifySweep() {
  const now = new Date();
  let opened = 0;
  let lockWarned = 0;

  // "Predictions are open" — fires the moment a fixture crosses its 24h-before-kickoff window.
  const candidatesForOpen = await prisma.fixture.findMany({
    where: { ...REAL_FIXTURES_ONLY, status: "SCHEDULED", openNotifiedAt: null, kickoffAt: { gt: now } },
    include: { homeTeam: true, awayTeam: true },
  });
  for (const fixture of candidatesForOpen) {
    const opensAt = new Date(fixture.kickoffAt.getTime() - 24 * 60 * 60 * 1000);
    if (now < opensAt) continue;

    // Locked + re-checked inside the transaction: this job shares lock-sweep's 5-min cron tick
    // and has no hard time budget of its own (see the cron route's comment on maxDuration), so an
    // overlapping/retried invocation for the same fixture could otherwise read openNotifiedAt as
    // null twice before either commits and double-push the same users. The send itself happens
    // after commit, same reasoning as lineup-check.ts/matchday-notify.ts.
    const userIds = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"notify-open:" + fixture.id}))`;
      const fresh = await tx.fixture.findUniqueOrThrow({ where: { id: fixture.id } });
      if (fresh.openNotifiedAt) return null;

      const users = await tx.user.findMany({
        where: { favoriteTeamId: { in: [fixture.homeTeamId, fixture.awayTeamId] } },
        select: { id: true },
      });
      await tx.fixture.update({ where: { id: fixture.id }, data: { openNotifiedAt: now } });
      return users.map((u) => u.id);
    });
    if (!userIds) continue; // already handled by a prior/concurrent run

    const sent = await sendPushToUsers(userIds, {
      title: "Matchday XI",
      body: `Predictions are open\n${fixture.homeTeam.shortName ?? fixture.homeTeam.name} vs ${fixture.awayTeam.shortName ?? fixture.awayTeam.name} — build your lineup before it locks.`,
      url: `/predict/${fixture.id}`,
    });
    if (!sent) {
      await prisma.fixture.update({ where: { id: fixture.id }, data: { openNotifiedAt: null } });
      continue;
    }
    opened++;
  }

  // "30 minutes to lock" — only to users who haven't submitted yet, so it's a nudge, not noise.
  const warningCutoff = new Date(now.getTime() + LOCK_WARNING_MINUTES * 60_000);
  const candidatesForLockWarning = await prisma.fixture.findMany({
    where: {
      ...REAL_FIXTURES_ONLY,
      status: { in: ["SCHEDULED", "LOCKED"] },
      lockWarningNotifiedAt: null,
      lockAt: { gt: now, lte: warningCutoff },
    },
    include: { homeTeam: true, awayTeam: true },
  });
  for (const fixture of candidatesForLockWarning) {
    const toNotify = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"notify-lock-warn:" + fixture.id}))`;
      const fresh = await tx.fixture.findUniqueOrThrow({ where: { id: fixture.id } });
      if (fresh.lockWarningNotifiedAt) return null;

      const favoriteUsers = await tx.user.findMany({
        where: { favoriteTeamId: { in: [fixture.homeTeamId, fixture.awayTeamId] } },
        select: { id: true },
      });
      const alreadyPredicted = await tx.prediction.findMany({
        where: {
          fixtureId: fixture.id,
          scopeKey: scopeKeyFor(null),
          userId: { in: favoriteUsers.map((u) => u.id) },
        },
        select: { userId: true },
      });
      const predictedSet = new Set(alreadyPredicted.map((p) => p.userId));
      const notified = favoriteUsers.map((u) => u.id).filter((id) => !predictedSet.has(id));

      await tx.fixture.update({ where: { id: fixture.id }, data: { lockWarningNotifiedAt: now } });
      return notified;
    });
    if (!toNotify) continue; // already handled by a prior/concurrent run

    const sent = await sendPushToUsers(toNotify, {
      title: "Matchday XI",
      body: `Lock in 30 minutes\n${fixture.homeTeam.shortName ?? fixture.homeTeam.name} vs ${fixture.awayTeam.shortName ?? fixture.awayTeam.name} closes for predictions soon.`,
      url: `/predict/${fixture.id}`,
    });
    if (!sent) {
      await prisma.fixture.update({ where: { id: fixture.id }, data: { lockWarningNotifiedAt: null } });
      continue;
    }
    lockWarned++;
  }

  // Deliver whatever is still queued (a send too big for one run, or retries) — lib/push.ts.
  const delivery = await drainPushOutbox(20_000);

  return { opened, lockWarned, delivery };
}
