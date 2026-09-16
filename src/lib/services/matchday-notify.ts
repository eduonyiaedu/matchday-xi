import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import { scopeKeyFor } from "@/lib/prediction-scope";
import type { Fixture, Team } from "@/generated/prisma/client";

/**
 * The 11am UTC "it's matchday" morning nudge (rulebook §5) — a once-daily job, entirely separate
 * from notify-sweep's 5-minute cadence, so it needs its own cron-job.org schedule entry hitting
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

  let globalNotified = 0;
  let leagueNotified = 0;

  for (const fixture of todaysFixtures) {
    const fixtureLabel = formatFixtureLine(fixture);

    // Global scope — the user's own favorite team, same "haven't predicted yet" gate as the
    // existing lock-warning push.
    const favoriteUsers = await prisma.user.findMany({
      where: { favoriteTeamId: { in: [fixture.homeTeamId, fixture.awayTeamId] } },
      select: { id: true },
    });
    if (favoriteUsers.length > 0) {
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
        title: "It's Matchday!",
        body: `It's Matchday today! Have you picked your Matchday XI? (${fixtureLabel})`,
        url: `/predict/${fixture.id}`,
      });
    }

    // Private-league scope — every APPROVED membership whose assigned team plays in this fixture
    // today, scoped to leagues where the fixture actually falls inside the league's active
    // window (a member's team can play plenty of matches outside the leagues they're in).
    const memberships = await prisma.privateLeagueMembership.findMany({
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
      const alreadySent = await prisma.privateLeagueMatchdayNotification.findUnique({
        where: { fixtureId_leagueId: { fixtureId: fixture.id, leagueId } },
      });
      if (alreadySent) continue;

      const userIds = leagueMemberships.map((m) => m.userId);
      const alreadyPredicted = await prisma.prediction.findMany({
        where: { fixtureId: fixture.id, scopeKey: scopeKeyFor(leagueId), userId: { in: userIds } },
        select: { userId: true },
      });
      const predictedSet = new Set(alreadyPredicted.map((p) => p.userId));
      const toNotify = userIds.filter((id) => !predictedSet.has(id));

      const leagueName = leagueMemberships[0].league.name;
      await sendPushToUsers(toNotify, {
        title: "It's Matchday!",
        body: `${leagueName}: It's Matchday today! Have you picked your Matchday XI? (${fixtureLabel})`,
        url: `/leagues/${leagueId}/predict/${fixture.id}`,
      });
      await prisma.privateLeagueMatchdayNotification.create({ data: { fixtureId: fixture.id, leagueId } });
      leagueNotified++;
    }

    await prisma.fixture.update({ where: { id: fixture.id }, data: { matchdayNotifiedAt: now } });
    globalNotified++;
  }

  return { fixturesProcessed: globalNotified, leaguesNotified: leagueNotified };
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
