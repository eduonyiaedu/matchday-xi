import { prisma } from "@/lib/prisma";
import { apiFootballClient, type ApiFootballLineup } from "@/lib/api-football/client";
import { matchPlayerName } from "@/lib/player-matching";
import { scorePrediction } from "@/lib/scoring";

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

async function storeOfficialLineupAndScore(
  fixtureId: string,
  teamId: string,
  lineup: ApiFootballLineup,
) {
  const resolvedPlayerIds: string[] = [];

  const officialLineup = await prisma.officialLineup.upsert({
    where: { fixtureId_teamId: { fixtureId, teamId } },
    update: { formation: lineup.formation ?? undefined, fetchedAt: new Date() },
    create: { fixtureId, teamId, formation: lineup.formation ?? undefined },
  });

  // Clear out any previous (e.g. earlier pre-kickoff) entries — the final confirmed XI at
  // kickoff supersedes an earlier announcement (rulebook §6).
  await prisma.officialLineupPlayer.deleteMany({ where: { officialLineupId: officialLineup.id } });

  for (const entry of lineup.startXI) {
    const squadPlayerId = await resolveSquadPlayerId(teamId, entry.player.id, entry.player.name);
    if (squadPlayerId) resolvedPlayerIds.push(squadPlayerId);
    await prisma.officialLineupPlayer.create({
      data: {
        officialLineupId: officialLineup.id,
        squadPlayerId,
        rawApiFootballPlayerId: entry.player.id,
        rawName: entry.player.name,
        isGoalkeeper: entry.player.pos === "G",
      },
    });
  }

  const predictions = await prisma.prediction.findMany({
    where: { fixtureId, teamId },
    include: { slots: true },
  });

  for (const prediction of predictions) {
    const predictedIds = prediction.slots.map((s) => s.squadPlayerId);
    const { correctSquadPlayerIds, pointsAwarded, isPerfectXi } = scorePrediction(
      predictedIds,
      resolvedPlayerIds,
    );
    const correctSet = new Set(correctSquadPlayerIds);

    await prisma.$transaction(async (tx) => {
      await tx.prediction.update({
        where: { id: prediction.id },
        data: { pointsAwarded, isPerfectXi, scoredAt: new Date() },
      });
      for (const slot of prediction.slots) {
        await tx.predictionSlot.update({
          where: { id: slot.id },
          data: { isCorrect: correctSet.has(slot.squadPlayerId) },
        });
      }
      // Private-league predictions score separately and never touch global/team totals (§12b).
      if (!prediction.privateLeagueId) {
        await tx.user.update({
          where: { id: prediction.userId },
          data: {
            totalPoints: { increment: pointsAwarded },
            perfectXiCount: { increment: isPerfectXi ? 1 : 0 },
          },
        });
      }
    });
  }

  return resolvedPlayerIds.length;
}

export async function checkLineupsAndScore() {
  const now = new Date();
  const windowStart = new Date(now.getTime() + WINDOW_END_MIN * 60_000);
  const windowEnd = new Date(now.getTime() + WINDOW_START_MIN * 60_000);

  // Eligible: kickoff is between now+55min and now+75min (i.e. we're 55-75 min out), OR we're
  // already past that window and still missing a lineup (safety-net retries up to kickoff).
  const fixtures = await prisma.fixture.findMany({
    where: {
      status: { in: ["LOCKED", "LINEUPS_FETCHED", "NEEDS_MANUAL_REVIEW"] },
      OR: [
        { kickoffAt: { gte: windowStart, lte: windowEnd } },
        { kickoffAt: { gt: now, lt: windowStart } },
      ],
    },
    include: { homeTeam: true, awayTeam: true, officialLineups: true },
  });

  const results: Array<{ fixtureId: string; outcome: string }> = [];

  for (const fixture of fixtures) {
    const hasHome = fixture.officialLineups.some((l) => l.teamId === fixture.homeTeamId);
    const hasAway = fixture.officialLineups.some((l) => l.teamId === fixture.awayTeamId);
    if (hasHome && hasAway) continue; // shouldn't normally be selected, but guard anyway

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
      continue;
    }

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
      await storeOfficialLineupAndScore(fixture.id, teamId, lineup);
      foundAny = true;
    }

    const refreshed = await prisma.officialLineup.findMany({ where: { fixtureId: fixture.id } });
    const bothDone =
      refreshed.some((l) => l.teamId === fixture.homeTeamId) &&
      refreshed.some((l) => l.teamId === fixture.awayTeamId);

    if (bothDone) {
      await prisma.fixture.update({ where: { id: fixture.id }, data: { status: "SCORED" } });
      results.push({ fixtureId: fixture.id, outcome: "scored" });
    } else if (foundAny) {
      await prisma.fixture.update({ where: { id: fixture.id }, data: { status: "LINEUPS_FETCHED" } });
      results.push({ fixtureId: fixture.id, outcome: "partial (one side found)" });
    } else if (now >= fixture.kickoffAt) {
      await prisma.fixture.update({ where: { id: fixture.id }, data: { status: "NEEDS_MANUAL_REVIEW" } });
      results.push({ fixtureId: fixture.id, outcome: "kickoff passed, no lineup — flagged for review" });
    } else {
      results.push({ fixtureId: fixture.id, outcome: "no lineup yet, will retry" });
    }
  }

  return { checked: fixtures.length, results };
}
