import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import { scopeKeyFor } from "@/lib/prediction-scope";
import { groupBySignaturePercentage } from "@/lib/lineup-match";
import { REAL_FIXTURES_ONLY } from "@/lib/real-fixture";

/**
 * Flips SCHEDULED fixtures to LOCKED once their lockAt time has passed, for UI/query convenience.
 * NOT the authoritative lock check — that's always a live `now() >= fixture.lockAt` comparison
 * at prediction write-time (see app/api/predictions/route.ts). This sweep just keeps `status`
 * accurate for anyone browsing fixtures.
 */
export async function lockSweep() {
  const result = await prisma.fixture.updateMany({
    where: { ...REAL_FIXTURES_ONLY, status: "SCHEDULED", lockAt: { lte: new Date() } },
    data: { status: "LOCKED" },
  });

  const lockNudged = await sendLockNudges();
  return { locked: result.count, lockNudged };
}

/**
 * "You can now share your predicted XI" / "you didn't submit" nudge, global scope only (matching
 * notify-sweep.ts's documented scope limitation — a private-league member predicting for a
 * different club isn't covered here yet). Fires once per fixture, best-effort with NO retry on a
 * partial send failure: the natural fan-out here is one push per distinct lineup-signature group
 * plus one for non-submitters, which doesn't fit a single fixture-level dedup flag cleanly —
 * clearing it on one group's failure would re-send to every already-succeeded group too. Rather
 * than build a second per-group dedup table (matchday-notify.ts's PrivateLeagueMatchdayNotification
 * pattern) for a low-stakes reminder push, lockNotifiedAt is marked unconditionally before sending
 * — the same precedent lineup-scoring.ts's "scoring is in" push already sets in this codebase.
 */
async function sendLockNudges(): Promise<number> {
  const now = new Date();
  const fixtures = await prisma.fixture.findMany({
    where: { ...REAL_FIXTURES_ONLY, status: "LOCKED", lockNotifiedAt: null, lockAt: { lte: now } },
    select: { id: true, homeTeamId: true, awayTeamId: true },
  });

  let nudged = 0;
  for (const fixture of fixtures) {
    // Locked + re-checked inside the transaction, same reasoning as notify-sweep.ts: this job
    // shares lock-sweep's own 5-min cron tick and has no hard time budget of its own, so an
    // overlapping/retried invocation could otherwise read lockNotifiedAt as null twice before
    // either commits and double-send. The pushes themselves happen after commit.
    const claimed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"lock-notify:" + fixture.id}))`;
      const fresh = await tx.fixture.findUniqueOrThrow({ where: { id: fixture.id } });
      if (fresh.lockNotifiedAt) return null;

      const favoriteUsers = await tx.user.findMany({
        where: { favoriteTeamId: { in: [fixture.homeTeamId, fixture.awayTeamId] } },
        select: { id: true },
      });
      const predictions = await tx.prediction.findMany({
        where: {
          fixtureId: fixture.id,
          scopeKey: scopeKeyFor(null),
          userId: { in: favoriteUsers.map((u) => u.id) },
        },
        select: { userId: true, lineupSignature: true },
      });
      const predictedIds = new Set(predictions.map((p) => p.userId));
      const notSubmitted = favoriteUsers.map((u) => u.id).filter((id) => !predictedIds.has(id));

      await tx.fixture.update({ where: { id: fixture.id }, data: { lockNotifiedAt: now } });
      return { predictions, notSubmitted };
    });
    if (!claimed) continue; // already handled by a prior/concurrent run

    for (const group of groupBySignaturePercentage(claimed.predictions)) {
      await sendPushToUsers(group.userIds, {
        title: "Matchday XI",
        body: `You can now share your predicted Matchday XI. ${group.percentage}% of users picked the exact lineup you did today!`,
        url: `/predict/${fixture.id}`,
      });
    }
    if (claimed.notSubmitted.length > 0) {
      await sendPushToUsers(claimed.notSubmitted, {
        title: "Matchday XI",
        body: "You didn't submit your Matchday XI today 💔. Looking forward to your prediction when the next fixture opens.",
        url: "/fixtures",
      });
    }
    nudged++;
  }
  return nudged;
}
