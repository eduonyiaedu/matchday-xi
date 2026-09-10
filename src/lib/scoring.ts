/**
 * Pure scoring logic (rulebook §7). No I/O — takes plain id lists, returns a result.
 * +1 per predicted player found in the official starting XI, +3 bonus if all 11 match.
 */
export interface ScoringResult {
  correctSquadPlayerIds: string[];
  pointsAwarded: number;
  isPerfectXi: boolean;
}

const REQUIRED_SLOT_COUNT = 11;
const PERFECT_XI_BONUS = 3;

export function scorePrediction(
  predictedSquadPlayerIds: string[],
  officialSquadPlayerIds: string[],
): ScoringResult {
  const officialSet = new Set(officialSquadPlayerIds);
  const correctSquadPlayerIds = predictedSquadPlayerIds.filter((id) => officialSet.has(id));
  const isPerfectXi =
    predictedSquadPlayerIds.length === REQUIRED_SLOT_COUNT &&
    correctSquadPlayerIds.length === REQUIRED_SLOT_COUNT;
  const pointsAwarded = correctSquadPlayerIds.length + (isPerfectXi ? PERFECT_XI_BONUS : 0);

  return { correctSquadPlayerIds, pointsAwarded, isPerfectXi };
}
