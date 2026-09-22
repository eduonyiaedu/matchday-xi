/**
 * Pure grouping/percentage logic for the "X% of users picked the exact lineup you did" lock
 * nudge (see lib/services/lock-sweep.ts). No I/O — takes plain (userId, lineupSignature) pairs,
 * returns one group per distinct signature with each group's share of the total. Predictions
 * with no signature (submitted before that field existed) are excluded from both the grouping
 * and the denominator, since they can't be compared.
 */
export interface LineupMatchGroup {
  userIds: string[];
  percentage: number;
}

export function groupBySignaturePercentage(
  predictions: { userId: string; lineupSignature: string | null }[],
): LineupMatchGroup[] {
  const withSignature = predictions.filter(
    (p): p is { userId: string; lineupSignature: string } => p.lineupSignature !== null,
  );
  if (withSignature.length === 0) return [];

  const userIdsBySignature = new Map<string, string[]>();
  for (const p of withSignature) {
    const ids = userIdsBySignature.get(p.lineupSignature) ?? [];
    ids.push(p.userId);
    userIdsBySignature.set(p.lineupSignature, ids);
  }

  const total = withSignature.length;
  return [...userIdsBySignature.values()].map((userIds) => ({
    userIds,
    percentage: Math.round((userIds.length / total) * 100),
  }));
}
