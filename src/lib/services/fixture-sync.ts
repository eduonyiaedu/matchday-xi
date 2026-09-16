import { prisma } from "@/lib/prisma";
import {
  footballDataClient,
  COMPETITION_CODES,
  type FootballDataMatch,
} from "@/lib/football-data/client";
import type { PlayerPosition } from "@/generated/prisma/enums";
import { voidFixtureAndReversePoints } from "@/lib/services/void-fixture";

// 45 days wasn't always enough to keep 5 upcoming fixtures in view for every club — international
// breaks and cup rounds can leave a 3+ week gap between a club's league fixtures, so a shorter
// window sometimes surfaced only 3-4. 90 days comfortably covers that in practice.
const SYNC_WINDOW_DAYS = 90;
// football-data.org's free tier is 10 requests/minute. Squads rarely change (only during
// transfer windows), so instead of resyncing all 20 clubs' squads every run — which would burst
// well past the rate limit and take minutes even with the client's own throttling — each run
// only refreshes the least-recently-synced few teams. At every-6-hours cron cadence this still
// keeps every team's squad at most ~1-2 days stale, which is more than fresh enough.
const MAX_SQUADS_PER_SYNC_RUN = 6;

function normalizePosition(raw: string | null): PlayerPosition {
  const s = (raw ?? "").toLowerCase();
  if (s.includes("keeper")) return "GOALKEEPER";
  if (s.includes("back") || s.includes("defence") || s.includes("defender")) return "DEFENDER";
  if (s.includes("midfield")) return "MIDFIELDER";
  return "FORWARD";
}

const VOIDED_UPSTREAM_STATUSES = new Set(["POSTPONED", "SUSPENDED", "CANCELLED"]);
// Fixture statuses our own pipeline owns — never overwritten by a football-data.org re-sync.
const LOCKED_FORWARD_STATUSES = new Set(["LOCKED", "LINEUPS_FETCHED", "SCORED", "NEEDS_MANUAL_REVIEW"]);

async function ensureCompetitions() {
  // FA Cup / EFL Cup deferred — see the comment on COMPETITION_CODES in the football-data client.
  const rows = [{ externalId: COMPETITION_CODES.PREMIER_LEAGUE, name: "Premier League" }];
  for (const row of rows) {
    await prisma.competition.upsert({
      where: { externalId: row.externalId },
      update: { name: row.name },
      create: row,
    });
  }
}

async function syncPremierLeagueTeamsAndSquads() {
  const teams = await footballDataClient.getPremierLeagueTeams();

  // Cheap metadata upsert (name/crest) for all 20 — this is a single already-fetched payload,
  // no extra requests. Squad fetching (one request per team) is what's batched below.
  const dbTeams = await Promise.all(
    teams.map((team) =>
      prisma.team.upsert({
        where: { externalId: team.id },
        update: {
          name: team.name,
          shortName: team.shortName ?? undefined,
          crestUrl: team.crest ?? undefined,
          isPremierLeagueClub: true,
          isActive: true,
        },
        create: {
          externalId: team.id,
          name: team.name,
          shortName: team.shortName ?? undefined,
          crestUrl: team.crest ?? undefined,
          isPremierLeagueClub: true,
        },
      }),
    ),
  );

  const teamsDueForSquadSync = [...dbTeams]
    .sort((a, b) => (a.squadLastSyncedAt?.getTime() ?? 0) - (b.squadLastSyncedAt?.getTime() ?? 0))
    .slice(0, MAX_SQUADS_PER_SYNC_RUN);

  for (const dbTeam of teamsDueForSquadSync) {
    const squad = await footballDataClient.getTeamSquad(dbTeam.externalId);
    const seenFootballDataIds = new Set<number>();

    for (const player of squad) {
      seenFootballDataIds.add(player.id);
      await prisma.squadPlayer.upsert({
        where: { footballDataId: player.id },
        update: {
          name: player.name,
          position: normalizePosition(player.position),
          teamId: dbTeam.id,
          isActive: true,
        },
        create: {
          footballDataId: player.id,
          name: player.name,
          position: normalizePosition(player.position),
          teamId: dbTeam.id,
        },
      });
    }

    // Deactivate (never delete — preserves prediction history) players no longer on this squad.
    await prisma.squadPlayer.updateMany({
      where: {
        teamId: dbTeam.id,
        isActive: true,
        footballDataId: { notIn: Array.from(seenFootballDataIds) },
      },
      data: { isActive: false },
    });

    await prisma.team.update({ where: { id: dbTeam.id }, data: { squadLastSyncedAt: new Date() } });
  }

  return { teamsSynced: teams.length, squadsSynced: teamsDueForSquadSync.map((t) => t.name) };
}

export async function upsertOpponentTeam(team: FootballDataMatch["homeTeam"]) {
  return prisma.team.upsert({
    where: { externalId: team.id },
    update: { name: team.name, shortName: team.shortName ?? undefined, crestUrl: team.crest ?? undefined },
    create: {
      externalId: team.id,
      name: team.name,
      shortName: team.shortName ?? undefined,
      crestUrl: team.crest ?? undefined,
      isPremierLeagueClub: false,
    },
  });
}

async function syncFixturesForCompetition(code: string) {
  const competition = await prisma.competition.findUniqueOrThrow({ where: { externalId: code } });
  const now = new Date();
  const dateFrom = now.toISOString().slice(0, 10);
  const dateTo = new Date(now.getTime() + SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const matches = await footballDataClient.getCompetitionMatches(code, dateFrom, dateTo);
  let upserted = 0;

  for (const match of matches) {
    const homeTeam = await upsertOpponentTeam(match.homeTeam);
    const awayTeam = await upsertOpponentTeam(match.awayTeam);

    const existing = await prisma.fixture.findUnique({ where: { externalId: match.id } });
    const kickoffAt = new Date(match.utcDate);
    const lockAt = new Date(kickoffAt.getTime() - 2 * 60 * 60 * 1000);
    const isVoidedUpstream = VOIDED_UPSTREAM_STATUSES.has(match.status);

    // football-data.org's `score.fullTime` is live, not "final" — it reflects the current
    // cumulative score from kickoff onward (e.g. 0-0 moments into the match), not just the result
    // once the match ends. Writing it unconditionally let an interim in-play score get persisted
    // and then shown as if final (a shared card read "Sunderland 0-0 Arsenal" hours before the
    // actual 0-2 finish, simply because the last sync before full-time landed mid-match). Only
    // trust it once the upstream status says the match has actually finished.
    const finalHomeScore = match.status === "FINISHED" ? (match.score.fullTime.home ?? undefined) : undefined;
    const finalAwayScore = match.status === "FINISHED" ? (match.score.fullTime.away ?? undefined) : undefined;

    // Postponement/abandonment can be reported at any pipeline stage, including after scoring —
    // void unconditionally and reverse any already-awarded points (rulebook §10).
    if (existing && isVoidedUpstream) {
      await voidFixtureAndReversePoints(existing.id);
      upserted += 1;
      continue;
    }

    if (existing && LOCKED_FORWARD_STATUSES.has(existing.status)) {
      // Our pipeline has already taken over this fixture's lifecycle — only sync final scores.
      await prisma.fixture.update({
        where: { id: existing.id },
        data: {
          homeScore: finalHomeScore,
          awayScore: finalAwayScore,
        },
      });
      continue;
    }

    await prisma.fixture.upsert({
      where: { externalId: match.id },
      update: {
        // Don't move kickoff/lock times for a fixture the founder may already be looking at as
        // "scheduled" — only apply once, on the pre-lock SCHEDULED path.
        kickoffAt,
        lockAt,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        status: isVoidedUpstream ? "VOIDED" : "SCHEDULED",
        homeScore: finalHomeScore,
        awayScore: finalAwayScore,
      },
      create: {
        externalId: match.id,
        competitionId: competition.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        kickoffAt,
        lockAt,
        status: isVoidedUpstream ? "VOIDED" : "SCHEDULED",
      },
    });
    upserted += 1;
  }

  return { competition: code, fixturesUpserted: upserted };
}

/**
 * Used by the sync-squads cron route and admin button. Deliberately kept separate from fixture
 * syncing (never combined into one call) — see MAX_SQUADS_PER_SYNC_RUN above and the football-data
 * client's rate limiting for why bursting both together in one invocation is worth avoiding.
 */
export async function syncTeamsAndSquads() {
  return syncPremierLeagueTeamsAndSquads();
}

/**
 * Used by the sync-fixtures cron route and admin button. Each competition is synced
 * independently — e.g. a football-data.org plan that doesn't include a given competition
 * (a 403 "check your subscription") shouldn't stop the others (in particular Premier League)
 * from syncing.
 */
export async function syncAllCompetitionFixtures() {
  await ensureCompetitions();
  const fixtureResults = [];
  for (const code of Object.values(COMPETITION_CODES)) {
    try {
      fixtureResults.push(await syncFixturesForCompetition(code));
    } catch (error) {
      fixtureResults.push({
        competition: code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { fixtureResults };
}
