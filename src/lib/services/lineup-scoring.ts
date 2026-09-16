import { prisma } from "@/lib/prisma";
import { scorePrediction } from "@/lib/scoring";
import { sendPushToUsers } from "@/lib/push";
import type { LineupSource } from "@/generated/prisma/enums";

export interface LineupEntryInput {
  squadPlayerId: string | null;
  rawApiFootballPlayerId: number | null;
  rawName: string;
  isGoalkeeper: boolean;
}

/**
 * Records one side's official starting XI and scores every prediction made for that team in
 * this fixture — shared by the automated API-Football path (lib/services/lineup-check.ts) and
 * the admin manual-entry fallback (app/api/admin/lineups/[fixtureId]/route.ts), so a manually
 * entered lineup produces exactly the same downstream effects (points, Perfect XI count, slot
 * correctness) as an automated one.
 */
export async function applyOfficialLineup(
  fixtureId: string,
  teamId: string,
  entries: LineupEntryInput[],
  options: { formation?: string | null; source: LineupSource } = { source: "AUTOMATED" },
) {
  const resolvedPlayerIds = entries.map((e) => e.squadPlayerId).filter((id): id is string => !!id);

  // This runs from both the automated cron (every 5 min, up to kickoff) and the admin manual-entry
  // fallback — which exists specifically for when the automated fetch looks slow, i.e. exactly the
  // moment an admin is most likely to trigger it while a cron run is already in flight. Without a
  // lock, two concurrent calls for the same fixture+team both read the same prior pointsAwarded,
  // both compute the same delta, and both apply it — double-counting the user's points. A Postgres
  // advisory lock scoped to (fixtureId, teamId) makes the whole read-score-write sequence exclusive:
  // the second caller blocks until the first transaction commits, then reads the already-updated
  // pointsAwarded and correctly computes a zero (or true incremental) delta instead.
  const { predictionsScored, bothDone, justScored } = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${fixtureId} || ':' || ${teamId}))`;

      const officialLineup = await tx.officialLineup.upsert({
        where: { fixtureId_teamId: { fixtureId, teamId } },
        update: { formation: options.formation ?? undefined, source: options.source, fetchedAt: new Date() },
        create: { fixtureId, teamId, formation: options.formation ?? undefined, source: options.source },
      });

      // Clear out any previous (e.g. earlier pre-kickoff, or a prior manual entry being corrected)
      // entries — the latest confirmed XI always supersedes what came before (rulebook §6).
      await tx.officialLineupPlayer.deleteMany({ where: { officialLineupId: officialLineup.id } });

      for (const entry of entries) {
        await tx.officialLineupPlayer.create({
          data: {
            officialLineupId: officialLineup.id,
            squadPlayerId: entry.squadPlayerId,
            rawApiFootballPlayerId: entry.rawApiFootballPlayerId,
            rawName: entry.rawName,
            isGoalkeeper: entry.isGoalkeeper,
          },
        });
      }

      const predictions = await tx.prediction.findMany({
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
        // This same prediction may already have been scored once (a corrected lineup, or a second
        // automated pass) — apply only the NET change against the user's denormalized totals rather
        // than incrementing again on top of a prior award, which would double-count every re-score.
        const pointsDelta = pointsAwarded - (prediction.pointsAwarded ?? 0);
        const perfectXiDelta = (isPerfectXi ? 1 : 0) - (prediction.isPerfectXi ? 1 : 0);

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
        if (!prediction.privateLeagueId && (pointsDelta !== 0 || perfectXiDelta !== 0)) {
          await tx.user.update({
            where: { id: prediction.userId },
            data: {
              totalPoints: { increment: pointsDelta },
              perfectXiCount: { increment: perfectXiDelta },
            },
          });
        }
      }

      const refreshed = await tx.officialLineup.findMany({ where: { fixtureId } });
      const fixture = await tx.fixture.findUniqueOrThrow({ where: { id: fixtureId } });
      const bothDone =
        refreshed.some((l) => l.teamId === fixture.homeTeamId) &&
        refreshed.some((l) => l.teamId === fixture.awayTeamId);
      const justScored = bothDone && fixture.status !== "SCORED";

      if (justScored) {
        await tx.fixture.update({ where: { id: fixtureId }, data: { status: "SCORED" } });
      }

      return { predictionsScored: predictions.length, bothDone, justScored };
    },
    { timeout: 20_000 },
  );

  if (justScored) {
    // Sent after the transaction commits, and guarded by the same "wasn't already SCORED" check
    // computed inside it — re-saving an already-scored lineup (e.g. an admin correction) never
    // re-notifies. Kept outside the transaction since a push-delivery failure shouldn't roll back
    // scoring that already committed.
    const fixture = await prisma.fixture.findUniqueOrThrow({
      where: { id: fixtureId },
      include: { homeTeam: true, awayTeam: true },
    });
    const allPredictors = await prisma.prediction.findMany({ where: { fixtureId }, select: { userId: true } });
    const userIds = [...new Set(allPredictors.map((p) => p.userId))];
    await sendPushToUsers(userIds, {
      title: "Scoring is in",
      body: `${fixture.homeTeam.shortName ?? fixture.homeTeam.name} vs ${fixture.awayTeam.shortName ?? fixture.awayTeam.name} has been scored.`,
      url: "/history",
    });
  }

  return { resolvedCount: resolvedPlayerIds.length, predictionsScored, bothDone };
}
