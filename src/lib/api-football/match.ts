import { API_FOOTBALL_CLUB_TEAM_IDS } from "@/lib/api-football/club-team-ids";
import type { ApiFootballFixture } from "@/lib/api-football/client";

/**
 * Bridges football-data.org's world (our Team.externalId) and API-Football's, by team ID via the
 * static API_FOOTBALL_CLUB_TEAM_IDS table — never by name. Both previous name/ID comparisons in
 * lineup-check.ts silently never matched: fixture lookup compared normalized full names
 * ("arsenalfc" vs API-Football's "arsenal"), and lineup attribution compared API-Football's team
 * id against football-data's externalId (two unrelated id spaces). Confirmed 2026-09-23: not one
 * of the 130 fixtures had ever been resolved to an API-Football fixture id.
 */
export function apiFootballTeamId(footballDataExternalId: number): number | null {
  return API_FOOTBALL_CLUB_TEAM_IDS[footballDataExternalId]?.senior ?? null;
}

/** Picks the API-Football fixture for a given home/away pair out of a `/fixtures?date=` response. */
export function findApiFootballFixture(
  candidates: ApiFootballFixture[],
  homeExternalId: number,
  awayExternalId: number,
): ApiFootballFixture | null {
  const home = apiFootballTeamId(homeExternalId);
  const away = apiFootballTeamId(awayExternalId);
  if (home === null || away === null) return null;
  return candidates.find((f) => f.teams.home.id === home && f.teams.away.id === away) ?? null;
}

/** Which of our two Team ids an API-Football lineup belongs to, or null if neither. */
export function ourTeamIdForLineup(
  lineupApiFootballTeamId: number,
  fixture: { homeTeamId: string; awayTeamId: string; homeTeam: { externalId: number }; awayTeam: { externalId: number } },
): string | null {
  if (lineupApiFootballTeamId === apiFootballTeamId(fixture.homeTeam.externalId)) return fixture.homeTeamId;
  if (lineupApiFootballTeamId === apiFootballTeamId(fixture.awayTeam.externalId)) return fixture.awayTeamId;
  return null;
}
