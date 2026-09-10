/**
 * Postgres unique constraints treat NULL as distinct from every other NULL, so
 * Prediction.scopeKey substitutes this sentinel for a null privateLeagueId — see the comment on
 * Prediction.scopeKey in schema.prisma for why this column exists at all.
 */
export const GLOBAL_SCOPE = "GLOBAL";

export function scopeKeyFor(privateLeagueId: string | null): string {
  return privateLeagueId ?? GLOBAL_SCOPE;
}
