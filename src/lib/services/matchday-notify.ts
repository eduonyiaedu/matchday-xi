import { prisma } from "@/lib/prisma";
import { sendPushToUsers, type PushPayload } from "@/lib/push";
import { scopeKeyFor } from "@/lib/prediction-scope";
import type { Fixture, Team } from "@/generated/prisma/client";

interface PendingPush {
  notPredicted: string[];
  predicted: string[];
  notPredictedBody: string;
  predictedBody: string;
  url: string;
}

/**
 * The 11am UTC "it's matchday" push (rulebook §5) — one of two messages depending on whether the
 * recipient has already submitted a prediction for today's fixture: a nudge to pick one, or a
 * "good luck" for the XI they already picked. A once-daily job, entirely separate from
 * notify-sweep's 5-minute cadence, so it needs its own cron-job.org schedule entry hitting
 * /api/cron/matchday-notify at "0 11 * * *" (see that route's comment).
 */
export async function matchdayNotifySweep() {
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  // Only fixtures still open for picks — a match kicking off before ~1pm UTC would already be
  // locked (lockAt = kickoffAt - 2h) by the time this runs, and nudging someone to "pick your XI"
  // for a fixture they can no longer predict for would just be confusing.
  const todaysFixtures = await prisma.fixture.findMany({
    where: {
      status: "SCHEDULED",
      matchdayNotifiedAt: null,
      lockAt: { gt: now },
      kickoffAt: { gte: todayStart, lt: todayEnd },
    },
    include: { homeTeam: true, awayTeam: true },
  });

  let fixturesProcessed = 0;
  let leaguesNotified = 0;

  for (const fixture of todaysFixtures) {
    try {
      // Everything that decides WHO gets notified and marks the dedup flags happens inside one
      // transaction guarded by a per-fixture advisory lock — a retried/overlapping invocation for
      // the same fixture (this job has no hard time budget once a Saturday's worth of fixtures and
      // leagues fan out webpush sends past the route's 60s maxDuration) blocks until the first
      // finishes, then re-checks matchdayNotifiedAt fresh and finds it already set instead of
      // recomputing "who hasn't predicted" against stale state and double-sending. The actual
      // network sends happen AFTER commit, same reasoning as lineup-scoring.ts's push-after-commit
      // split: a delivery failure shouldn't roll back dedup state that already committed, since
      // under-notifying once beats double-notifying every time.
      const plan = await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"matchday-notify:" + fixture.id}))`;

          const fresh = await tx.fixture.findUniqueOrThrow({ where: { id: fixture.id } });
          if (fresh.matchdayNotifiedAt !== null) {
            return null;
          }

          const fixtureLabel = formatFixtureLine(fixture);
          const globalPushes: PendingPush | null = await buildGlobalPush(tx, fixture, fixtureLabel);

          const leaguePushes: (PendingPush & { leagueId: string })[] = [];
          const memberships = await tx.privateLeagueMembership.findMany({
            where: {
              status: "APPROVED",
              teamId: { in: [fixture.homeTeamId, fixture.awayTeamId] },
              league: { startDate: { lte: fixture.kickoffAt }, endDate: { gt: fixture.kickoffAt } },
            },
            include: { league: true },
          });
          const membershipsByLeague = new Map<string, typeof memberships>();
          for (const m of memberships) {
            if (!membershipsByLeague.has(m.leagueId)) membershipsByLeague.set(m.leagueId, []);
            membershipsByLeague.get(m.leagueId)!.push(m);
          }

          for (const [leagueId, leagueMemberships] of membershipsByLeague) {
            const alreadySent = await tx.privateLeagueMatchdayNotification.findUnique({
              where: { fixtureId_leagueId: { fixtureId: fixture.id, leagueId } },
            });
            if (alreadySent) continue;

            const userIds = leagueMemberships.map((m) => m.userId);
            const alreadyPredicted = await tx.prediction.findMany({
              where: { fixtureId: fixture.id, scopeKey: scopeKeyFor(leagueId), userId: { in: userIds } },
              select: { userId: true },
            });
            const predictedSet = new Set(alreadyPredicted.map((p) => p.userId));
            const leagueName = leagueMemberships[0].league.name;
            leaguePushes.push({
              leagueId,
              notPredicted: userIds.filter((id) => !predictedSet.has(id)),
              predicted: userIds.filter((id) => predictedSet.has(id)),
              notPredictedBody: `${leagueName}: It's Matchday today! Have you picked your Matchday XI? (${fixtureLabel})`,
              predictedBody: `${leagueName}: It's Matchday today! Good luck with your selected Matchday XI! (${fixtureLabel})`,
              url: `/leagues/${leagueId}/predict/${fixture.id}`,
            });
            await tx.privateLeagueMatchdayNotification.create({ data: { fixtureId: fixture.id, leagueId } });
          }

          await tx.fixture.update({ where: { id: fixture.id }, data: { matchdayNotifiedAt: now } });

          return { globalPushes, leaguePushes };
        },
        { timeout: 30_000 },
      );

      if (!plan) continue; // Already handled by a prior/concurrent run.

      if (plan.globalPushes) {
        await sendPush(plan.globalPushes);
      }
      for (const leaguePush of plan.leaguePushes) {
        await sendPush(leaguePush);
        leaguesNotified++;
      }
      fixturesProcessed++;
    } catch (error) {
      // One fixture's failure (a transient DB error, a lock timeout) shouldn't starve every other
      // fixture queued after it for the day — each fixture already outside "today" by tomorrow's
      // run, so isolate failures the same way syncAllCompetitionFixtures isolates per-competition.
      console.error(`[matchday-notify] failed for fixture ${fixture.id}:`, error);
    }
  }

  return { fixturesProcessed, leaguesNotified };
}

async function buildGlobalPush(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  fixture: Fixture,
  fixtureLabel: string,
): Promise<PendingPush | null> {
  const favoriteUsers = await tx.user.findMany({
    where: { favoriteTeamId: { in: [fixture.homeTeamId, fixture.awayTeamId] } },
    select: { id: true },
  });
  if (favoriteUsers.length === 0) return null;

  const alreadyPredicted = await tx.prediction.findMany({
    where: {
      fixtureId: fixture.id,
      scopeKey: scopeKeyFor(null),
      userId: { in: favoriteUsers.map((u) => u.id) },
    },
    select: { userId: true },
  });
  const predictedSet = new Set(alreadyPredicted.map((p) => p.userId));
  const allIds = favoriteUsers.map((u) => u.id);

  return {
    notPredicted: allIds.filter((id) => !predictedSet.has(id)),
    predicted: allIds.filter((id) => predictedSet.has(id)),
    notPredictedBody: `It's Matchday today! Have you picked your Matchday XI? (${fixtureLabel})`,
    predictedBody: `It's Matchday today! Good luck with your selected Matchday XI! (${fixtureLabel})`,
    url: `/predict/${fixture.id}`,
  };
}

async function sendPush(plan: PendingPush): Promise<void> {
  const base: Omit<PushPayload, "body"> = { title: "It's Matchday!", url: plan.url };
  await sendPushToUsers(plan.notPredicted, { ...base, body: plan.notPredictedBody });
  await sendPushToUsers(plan.predicted, { ...base, body: plan.predictedBody });
}

// Matches the app's own "day/month/year, HH:mm (HH:mm GMT)" convention (see ui/local-time.tsx) as
// closely as a single static push body can — a push payload is composed once server-side and
// can't be reformatted per recipient's timezone the way the in-app UI is, so this renders the
// UTC/GMT time only rather than guessing a viewer's local timezone.
function formatFixtureLine(fixture: Fixture & { homeTeam: Team; awayTeam: Team }): string {
  const matchup = `${fixture.homeTeam.shortName ?? fixture.homeTeam.name} vs ${fixture.awayTeam.shortName ?? fixture.awayTeam.name}`;
  const kickoff = fixture.kickoffAt.toLocaleString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${matchup}, ${kickoff} GMT`;
}
