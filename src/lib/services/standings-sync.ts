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

  const [{ table: standings, season }, scorers] = await Promise.all([
    footballDataClient.getStandings(COMPETITION_CODES.PREMIER_LEAGUE),
    // 500 is well above any realistic season-end goal-scorer count — confirmed live (Sep 2026)
    // that this endpoint accepts limits this high with no error, and that its `count` field is
    // the true total of players with >=1 goal, not a page size (both 100 and 500 returned the
    // same 90 players). Raised from 20 so the assists column covers every current goal-scorer,
    // not just the top 20 by goals — see the assists page for the caveat this still can't fix:
    // a player with 0 goals but real assists never appears here at any limit, since this
    // endpoint's underlying dataset is goal-scorers with an assists column alongside, not a
    // general offensive-contribution list.
    footballDataClient.getScorers(COMPETITION_CODES.PREMIER_LEAGUE, 500),
  ]);

  // Resolve every distinct team referenced by either list ONCE, before the transaction —
  // standings covers all 20 PL clubs and scorers' teams are a subset of the same 20, so deduping
  // first turns what used to be up to 110 sequential team-upsert round trips *inside* the
  // transaction (one per standings row AND one per scorer) into at most 20, done upfront with no
  // lock held and no timeout pressure. This is exactly what broke once the scorers limit was
  // raised from 20 to 500 above — confirmed live: a 90-scorer response blew the transaction's
  // 20s timeout inside the old per-row-upsert loop (P2028, ~20.1s elapsed).
  // Season dates ride along on the standings response — kept current so account deletion can tell
  // whether a private-league creator's season is still running (lib/account-deletion.ts).
  if (season) {
    // On rollover to a new season, keep the outgoing season's dates rather than overwrite them —
    // its prizes may not have been confirmed yet (lib/season-prizes.ts).
    const rolledOver =
      competition.currentSeasonStartDate && competition.currentSeasonStartDate.toISOString().slice(0, 10) !== season.startDate;
    await prisma.competition.update({
      where: { id: competition.id },
      data: {
        currentSeasonStartDate: new Date(season.startDate),
        currentSeasonEndDate: new Date(season.endDate),
        ...(rolledOver
          ? { previousSeasonStartDate: competition.currentSeasonStartDate, previousSeasonEndDate: competition.currentSeasonEndDate }
          : {}),
      },
    });
  }

  const allTeamRefs = [...standings.map((s) => s.team), ...scorers.map((s) => s.team)];
  const uniqueTeamRefs = [...new Map(allTeamRefs.map((ref) => [ref.id, ref])).values()];
  const resolvedTeams = await Promise.all(uniqueTeamRefs.map((ref) => upsertOpponentTeam(ref)));
  const teamsByExternalId = new Map(uniqueTeamRefs.map((ref, i) => [ref.id, resolvedTeams[i]]));

  // Runs from both a cron and an admin manual-sync button (see the dual-trigger race class this
  // codebase has hit before — squad-enrichment-sync.ts, lineup-scoring.ts). Both writes below are
  // real upserts / a lock-guarded replace, not check-then-create, so two concurrent runs settle on
  // the same end state rather than racing.
  await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"standings-sync:" + competition.id}))`;

      for (const row of standings) {
        const team = teamsByExternalId.get(row.team.id)!;
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
      // official lineups. A single createMany instead of up to ~90 sequential creates.
      await tx.topScorer.deleteMany({ where: { competitionId: competition.id } });
      await tx.topScorer.createMany({
        data: scorers.map((scorer, index) => ({
          competitionId: competition.id,
          playerExternalId: scorer.player.id,
          playerName: scorer.player.name,
          teamId: teamsByExternalId.get(scorer.team.id)!.id,
          goals: scorer.goals,
          assists: scorer.assists ?? 0,
          rank: index + 1,
        })),
      });
    },
    { timeout: 30_000 },
  );

  return { standingsSynced: standings.length, scorersSynced: scorers.length };
}
