import { prisma } from "@/lib/prisma";
import { apiFootballClient } from "@/lib/api-football/client";
import { matchPlayerName } from "@/lib/player-matching";
import { applyOfficialLineup, type LineupEntryInput } from "@/lib/services/lineup-scoring";
import { sendLineupAlert } from "@/lib/notify";

// Rulebook §6: bounded retry window ~75 to 60 minutes before kickoff, checking every ~10 min.
// This job runs every 5 min (GitHub Actions granularity) and widens the window slightly (to 55)
// as a buffer; if nothing is found by then it keeps retrying every 5 min up to kickoff as a
// safety net beyond the rulebook's typical-case window, then flags for manual review.
const WINDOW_START_MIN = 75;
const WINDOW_END_MIN = 55;

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

/** Sends the founder exactly one alert per fixture, the first time automated fetching fails. */
async function alertOnce(fixture: { id: string; lineupAlertSentAt: Date | null; kickoffAt: Date }, matchLabel: string, reason: string) {
  if (fixture.lineupAlertSentAt) return;
  await sendLineupAlert({ fixtureId: fixture.id, matchLabel, kickoffAt: fixture.kickoffAt, reason });
  await prisma.fixture.update({ where: { id: fixture.id }, data: { lineupAlertSentAt: new Date() } });
}

export async function checkLineupsAndScore() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + WINDOW_END_MIN * 60_000);
  const windowEnd = new Date(now.getTime() + WINDOW_START_MIN * 60_000);

  // Eligible: kickoff is between now+55min and now+75min (i.e. we're 55-75 min out), OR we're
  // already past that window and still missing a lineup (safety-net retries up to kickoff) — and,
  // per the comment above (which this condition previously didn't actually implement), for a
  // bounded stretch AFTER kickoff too, since a fixture stuck at LOCKED with kickoffAt now in the
  // past would otherwise drop out of every future query forever, silently, without ever reaching
  // the "flag for manual review" branch below.
  const pastKickoffCutoff = new Date(now.getTime() - 6 * 60 * 60_000);
  const fixtures = await prisma.fixture.findMany({
    where: {
      status: { in: ["LOCKED", "LINEUPS_FETCHED", "NEEDS_MANUAL_REVIEW"] },
      OR: [
        { kickoffAt: { gte: windowStart, lte: windowEnd } },
        { kickoffAt: { gt: now, lt: windowStart } },
        { kickoffAt: { gte: pastKickoffCutoff, lte: now } },
      ],
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
