import { prisma } from "@/lib/prisma";
import { apiFootballClient } from "@/lib/api-football/client";
import { matchPlayerName } from "@/lib/player-matching";
import { applyOfficialLineup, type LineupEntryInput } from "@/lib/services/lineup-scoring";
import { sendLineupAlert } from "@/lib/notify";

// Rulebook §6: exactly 3 automated attempts per fixture — at ~70 min and ~60 min before kickoff,
// then once more at kickoff — not continuous polling. The previous design retried every 5 min
// from kickoff-75 through kickoff, then kept going for a further 6h as a safety net for anything
// still unresolved; on a busy matchday that plausibly ran up ~100+ requests against API-Football's
// ~100/day free-tier cap and got the account suspended (confirmed Sep 2026). Index into this array
// is the fixture's `lineupCheckAttempts` count going into that check, so attempt 1 fires once
// kickoff is <=70min away, attempt 2 once <=60min away, attempt 3 once kickoff has passed. If the
// 3rd attempt still finds nothing, the fixture is flagged NEEDS_MANUAL_REVIEW and the founder is
// alerted — no further automated attempts are made for it after that.
const CHECKPOINT_MINUTES_BEFORE_KICKOFF = [70, 60, 0] as const;

async function resolveSquadPlayerId(
  teamId: string,
  apiFootballPlayerId: number,
  rawName: string,
): Promise<string | null> {
  const cached = await prisma.squadPlayer.findUnique({ where: { apiFootballId: apiFootballPlayerId } });
  if (cached) return cached.id;

  const candidates = await prisma.squadPlayer.findMany({
    where: { teamId, isActive: true, apiFootballId: null },
    select: { id: true, name: true },
  });
  const matchedId = matchPlayerName(rawName, candidates);
  if (matchedId) {
    await prisma.squadPlayer.update({ where: { id: matchedId }, data: { apiFootballId: apiFootballPlayerId } });
  }
  return matchedId;
}

/**
 * Sends the founder exactly one alert per fixture, the first time automated fetching fails.
 * The dedup check-and-claim is lock-guarded (this cron runs every 5 min and a slow tick can still
 * be in flight when the next one fires, which would otherwise let both read `lineupAlertSentAt`
 * as null and both send); the actual email send happens after that transaction commits, since a
 * network call has no business holding a DB lock open. If the send genuinely fails (not just
 * "not configured" — see notify.ts), the claim is released so the next tick retries instead of
 * the founder silently and permanently losing their only signal that a fixture needs manual entry.
 */
async function alertOnce(fixture: { id: string; lineupAlertSentAt: Date | null; kickoffAt: Date }, matchLabel: string, reason: string) {
  const claimed = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"lineup-alert:" + fixture.id}))`;
    const fresh = await tx.fixture.findUniqueOrThrow({ where: { id: fixture.id } });
    if (fresh.lineupAlertSentAt) return false;
    await tx.fixture.update({ where: { id: fixture.id }, data: { lineupAlertSentAt: new Date() } });
    return true;
  });
  if (!claimed) return;

  const sent = await sendLineupAlert({ fixtureId: fixture.id, matchLabel, kickoffAt: fixture.kickoffAt, reason });
  if (!sent) {
    await prisma.fixture.update({ where: { id: fixture.id }, data: { lineupAlertSentAt: null } });
  }
}

export async function checkLineupsAndScore() {
  const now = new Date();

  // Attempt N (1-indexed) is due once kickoff is within CHECKPOINT_MINUTES_BEFORE_KICKOFF[N-1]
  // minutes — expressed here as lineupCheckAttempts === N-1 (i.e. exactly N-1 attempts made so
  // far) so each fixture gets each checkpoint exactly once, not on every 5-min tick until it fires.
  const fixtures = await prisma.fixture.findMany({
    where: {
      status: { in: ["LOCKED", "LINEUPS_FETCHED", "NEEDS_MANUAL_REVIEW"] },
      OR: CHECKPOINT_MINUTES_BEFORE_KICKOFF.map((minutesBefore, attemptsSoFar) => ({
        lineupCheckAttempts: attemptsSoFar,
        kickoffAt: { lte: new Date(now.getTime() + minutesBefore * 60_000) },
      })),
    },
    include: { homeTeam: true, awayTeam: true, officialLineups: true },
  });

  const results: Array<{ fixtureId: string; outcome: string }> = [];

  for (const fixture of fixtures) {
    const hasHome = fixture.officialLineups.some((l) => l.teamId === fixture.homeTeamId);
    const hasAway = fixture.officialLineups.some((l) => l.teamId === fixture.awayTeamId);
    if (hasHome && hasAway) continue; // shouldn't normally be selected, but guard anyway

    const matchLabel = `${fixture.homeTeam.name} vs ${fixture.awayTeam.name}`;

    // Isolated per fixture — one fixture's failure (e.g. a data-source outage) must not stop the
    // rest of this batch from being checked, and every failure path here gets exactly one alert
    // email so the founder can step in with the manual-entry admin tool.
    try {
      await prisma.fixture.update({
        where: { id: fixture.id },
        data: { lineupCheckAttempts: { increment: 1 } },
      });

      let apiFootballFixtureId = fixture.apiFootballFixtureId;
      if (!apiFootballFixtureId) {
        const found = await apiFootballClient.findFixtureByDateAndTeams(
          fixture.kickoffAt.toISOString(),
          fixture.homeTeam.name,
          fixture.awayTeam.name,
        );
        if (found) {
          apiFootballFixtureId = found.fixture.id;
          await prisma.fixture.update({ where: { id: fixture.id }, data: { apiFootballFixtureId } });
        }
      }

      if (!apiFootballFixtureId) {
        results.push({ fixtureId: fixture.id, outcome: "api-football fixture not found yet" });
      } else {
        const lineups = await apiFootballClient.getLineups(apiFootballFixtureId);
        let foundAny = false;

        for (const lineup of lineups) {
          const teamId =
            lineup.team.id === fixture.homeTeam.externalId
              ? fixture.homeTeamId
              : lineup.team.id === fixture.awayTeam.externalId
                ? fixture.awayTeamId
                : null;
          if (!teamId) continue;
          const already = teamId === fixture.homeTeamId ? hasHome : hasAway;
          if (already) continue;

          const entries: LineupEntryInput[] = await Promise.all(
            lineup.startXI.map(async (entry) => ({
              squadPlayerId: await resolveSquadPlayerId(teamId, entry.player.id, entry.player.name),
              rawApiFootballPlayerId: entry.player.id,
              rawName: entry.player.name,
              isGoalkeeper: entry.player.pos === "G",
            })),
          );
          await applyOfficialLineup(fixture.id, teamId, entries, {
            formation: lineup.formation,
            source: "AUTOMATED",
          });
          foundAny = true;
        }

        if (foundAny) {
          const refreshed = await prisma.fixture.findUniqueOrThrow({ where: { id: fixture.id } });
          if (refreshed.status !== "SCORED") {
            await prisma.fixture.update({ where: { id: fixture.id }, data: { status: "LINEUPS_FETCHED" } });
          }
          results.push({ fixtureId: fixture.id, outcome: refreshed.status === "SCORED" ? "scored" : "partial (one side found)" });
        } else if (now >= fixture.kickoffAt) {
          await prisma.fixture.update({ where: { id: fixture.id }, data: { status: "NEEDS_MANUAL_REVIEW" } });
          await alertOnce(fixture, matchLabel, "Kickoff passed with no official lineup found after retrying.");
          results.push({ fixtureId: fixture.id, outcome: "kickoff passed, no lineup — flagged for review" });
        } else {
          results.push({ fixtureId: fixture.id, outcome: "no lineup yet, will retry" });
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await alertOnce(fixture, matchLabel, reason);
      results.push({ fixtureId: fixture.id, outcome: `error: ${reason}` });
    }
  }

  return { checked: fixtures.length, results };
}
