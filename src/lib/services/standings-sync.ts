import { prisma } from "@/lib/prisma";
import { footballDataClient, COMPETITION_CODES } from "@/lib/football-data/client";
import { upsertOpponentTeam } from "@/lib/services/fixture-sync";

/**
 * League table + season-long goals/assists leaderboard (rulebook §13). Deliberately does NOT
 * attempt a per-match goal-scorer timeline — confirmed directly against football-data.org's live
 * API (Sep 2026) that the free tier's single-match detail endpoint carries no goal events at all,
 * and API-Football's free plan explicitly rejects any current-season query outside a ~3-day
 * rolling window (fine for the lineup-check use case, useless for full-season match history).
 * This only ever syncs the current, aggregated standings/scorers snapshot.
 */
export async function syncStandingsAndScorers() {
  const competition = await prisma.competition.findUniqueOrThrow({
    where: { externalId: COMPETITION_CODES.PREMIER_LEAGUE },
  });

  const [standings, scorers] = await Promise.all([
    footballDataClient.getStandings(COMPETITION_CODES.PREMIER_LEAGUE),
    footballDataClient.getScorers(COMPETITION_CODES.PREMIER_LEAGUE, 20),
  ]);

  // Runs from both a cron and an admin manual-sync button (see the dual-trigger race class this
  // codebase has hit before — squad-enrichment-sync.ts, lineup-scoring.ts). Both writes below are
  // real upserts / a lock-guarded replace, not check-then-create, so two concurrent runs settle on
  // the same end state rather than racing.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"standings-sync:" + competition.id}))`;

      for (const row of standings) {
        const team = await upsertOpponentTeam(row.team, tx);
        await tx.leagueStanding.upsert({
          where: { competitionId_teamId: { competitionId: competition.id, teamId: team.id } },
          update: {
            position: row.position,
            played: row.playedGames,
            won: row.won,
            drawn: row.draw,
            lost: row.lost,
            goalsFor: row.goalsFor,
            goalsAgainst: row.goalsAgainst,
            goalDifference: row.goalDifference,
            points: row.points,
          },
          create: {
            competitionId: competition.id,
            teamId: team.id,
            position: row.position,
            played: row.playedGames,
            won: row.won,
            drawn: row.draw,
            lost: row.lost,
            goalsFor: row.goalsFor,
            goalsAgainst: row.goalsAgainst,
            goalDifference: row.goalDifference,
            points: row.points,
          },
        });
      }

      // The scorers list can reorder or drop a player entirely (overtaken, transferred out) —
      // replace wholesale rather than upserting by rank, same "latest sync wins" approach as
      // official lineups.
      await tx.topScorer.deleteMany({ where: { competitionId: competition.id } });
      for (const [index, scorer] of scorers.entries()) {
        const team = await upsertOpponentTeam(scorer.team, tx);
        await tx.topScorer.create({
          data: {
            competitionId: competition.id,
            playerExternalId: scorer.player.id,
            playerName: scorer.player.name,
            teamId: team.id,
            goals: scorer.goals,
            assists: scorer.assists ?? 0,
            rank: index + 1,
          },
        });
      }
    },
    { timeout: 20_000 },
  );

  return { standingsSynced: standings.length, scorersSynced: scorers.length };
}
