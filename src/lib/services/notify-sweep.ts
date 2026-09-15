import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import { scopeKeyFor } from "@/lib/prediction-scope";

const LOCK_WARNING_MINUTES = 30;

/**
 * Push notifications scoped to a user's own favorite team (global scope) — a private-league
 * member predicting for a different club isn't covered here yet, since a single fixture can be
 * "open" for many different leagues on different schedules. Runs alongside lock-sweep (same 5-min
 * cadence already in place), so both dedup fields below only need coarse (~5 min) precision.
 */
export async function notifySweep() {
  const now = new Date();
  let opened = 0;
  let lockWarned = 0;

  // "Predictions are open" — fires the moment a fixture crosses its 24h-before-kickoff window.
  const candidatesForOpen = await prisma.fixture.findMany({
    where: { status: "SCHEDULED", openNotifiedAt: null, kickoffAt: { gt: now } },
    include: { homeTeam: true, awayTeam: true },
  });
  for (const fixture of candidatesForOpen) {
    const opensAt = new Date(fixture.kickoffAt.getTime() - 24 * 60 * 60 * 1000);
    if (now < opensAt) continue;

    const users = await prisma.user.findMany({
      where: { favoriteTeamId: { in: [fixture.homeTeamId, fixture.awayTeamId] } },
      select: { id: true },
    });
    await sendPushToUsers(users.map((u) => u.id), {
      title: "Predictions are open",
      body: `${fixture.homeTeam.shortName ?? fixture.homeTeam.name} vs ${fixture.awayTeam.shortName ?? fixture.awayTeam.name} — build your lineup before it locks.`,
      url: `/predict/${fixture.id}`,
    });
    await prisma.fixture.update({ where: { id: fixture.id }, data: { openNotifiedAt: now } });
    opened++;
  }

  // "30 minutes to lock" — only to users who haven't submitted yet, so it's a nudge, not noise.
  const warningCutoff = new Date(now.getTime() + LOCK_WARNING_MINUTES * 60_000);
  const candidatesForLockWarning = await prisma.fixture.findMany({
    where: {
      status: { in: ["SCHEDULED", "LOCKED"] },
      lockWarningNotifiedAt: null,
      lockAt: { gt: now, lte: warningCutoff },
    },
    include: { homeTeam: true, awayTeam: true },
  });
  for (const fixture of candidatesForLockWarning) {
    const favoriteUsers = await prisma.user.findMany({
      where: { favoriteTeamId: { in: [fixture.homeTeamId, fixture.awayTeamId] } },
      select: { id: true },
    });
    const alreadyPredicted = await prisma.prediction.findMany({
      where: {
        fixtureId: fixture.id,
        scopeKey: scopeKeyFor(null),
        userId: { in: favoriteUsers.map((u) => u.id) },
      },
      select: { userId: true },
    });
    const predictedSet = new Set(alreadyPredicted.map((p) => p.userId));
    const toNotify = favoriteUsers.map((u) => u.id).filter((id) => !predictedSet.has(id));

    await sendPushToUsers(toNotify, {
      title: "Lock in 30 minutes",
      body: `${fixture.homeTeam.shortName ?? fixture.homeTeam.name} vs ${fixture.awayTeam.shortName ?? fixture.awayTeam.name} closes for predictions soon.`,
      url: `/predict/${fixture.id}`,
    });
    await prisma.fixture.update({ where: { id: fixture.id }, data: { lockWarningNotifiedAt: now } });
    lockWarned++;
  }

  return { opened, lockWarned };
}
