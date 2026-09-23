/**
 * Pure grouping/percentage logic for the "X% of users picked the exact lineup you did" lock
 * nudge (see lib/services/lock-sweep.ts). No I/O — takes plain (userId, teamId, lineupSignature)
 * rows, returns one group per distinct signature with each group's share of the total. Predictions
 * with no signature (submitted before that field existed) are excluded from both the grouping
 * and the denominator, since they can't be compared.
 *
 * The denominator is per club: a fixture has two teams' fans predicting two different XIs, and an
 * Arsenal lineup can only ever match other Arsenal predictions. Dividing by both clubs' predictions
 * (as this once did) told 10 Arsenal fans who all picked the same XI that "50%" matched them.
 */
export interface LineupMatchGroup {
  userIds: string[];
  percentage: number;
}

export function groupBySignaturePercentage(
  predictions: { userId: string; teamId: string; lineupSignature: string | null }[],
): LineupMatchGroup[] {
  const withSignature = predictions.filter(
    (p): p is { userId: string; teamId: string; lineupSignature: string } => p.lineupSignature !== null,
  );

  const totalByTeam = new Map<string, number>();
  const groups = new Map<string, { teamId: string; userIds: string[] }>();
  for (const p of withSignature) {
    totalByTeam.set(p.teamId, (totalByTeam.get(p.teamId) ?? 0) + 1);
    const key = `${p.teamId}|${p.lineupSignature}`;
    const group = groups.get(key) ?? { teamId: p.teamId, userIds: [] };
    group.userIds.push(p.userId);
    groups.set(key, group);
  }

  return [...groups.values()].map(({ teamId, userIds }) => ({
    userIds,
    // Never "0%": the recipient themself picked this lineup, so a one-of-a-kind XI among many
    // predictions (which would round to 0) still reads as at least 1%.
    percentage: Math.max(1, Math.round((userIds.length / totalByTeam.get(teamId)!) * 100)),
  }));
}
