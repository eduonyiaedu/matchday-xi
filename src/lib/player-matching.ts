/**
 * Cross-provider player identity resolution.
 *
 * football-data.org and API-Football have no shared player id, so when a lineup comes back from
 * API-Football we have to match its player names against our SquadPlayer rows (sourced from
 * football-data.org) by name. This is inherently heuristic — see docs/README notes on the risk.
 * Pure, DB-free functions so they're easy to unit test; the caller (lib/lineup-service.ts) is
 * responsible for persisting a resolved match back onto SquadPlayer.apiFootballId so future
 * lookups for that player are an id lookup instead of a name match.
 */

export interface MatchCandidate {
  id: string;
  name: string;
}

/** Lowercase, strip diacritics/punctuation, collapse whitespace. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "") // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function surnameOf(normalized: string): string {
  const parts = normalized.split(" ").filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : normalized;
}

/**
 * Returns the best-matching candidate id, or null if no confident match was found.
 * Tries, in order: exact normalized full-name match, unique surname match, then
 * "initial + surname" match (API-Football sometimes reports lineup names like "M. Salah").
 */
export function matchPlayerName(
  targetName: string,
  candidates: MatchCandidate[],
): string | null {
  const target = normalizeName(targetName);
  if (!target) return null;

  const normalizedCandidates = candidates.map((c) => ({ ...c, normalized: normalizeName(c.name) }));

  const exact = normalizedCandidates.find((c) => c.normalized === target);
  if (exact) return exact.id;

  const targetSurname = surnameOf(target);
  const surnameMatches = normalizedCandidates.filter((c) => surnameOf(c.normalized) === targetSurname);
  if (surnameMatches.length === 1) return surnameMatches[0].id;

  const initialMatch = target.match(/^([a-z])[a-z]*\s+(.+)$/);
  if (initialMatch) {
    const [, initial, restSurname] = initialMatch;
    const initialCandidates = normalizedCandidates.filter((c) => {
      const parts = c.normalized.split(" ").filter(Boolean);
      if (parts.length < 2) return false;
      const candidateSurname = parts[parts.length - 1];
      return candidateSurname === restSurname && parts[0].startsWith(initial);
    });
    if (initialCandidates.length === 1) return initialCandidates[0].id;
  }

  return null;
}
