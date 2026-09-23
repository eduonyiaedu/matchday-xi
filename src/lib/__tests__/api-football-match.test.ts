import { describe, expect, it } from "vitest";
import { findApiFootballFixture, ourTeamIdForLineup } from "@/lib/api-football/match";
import type { ApiFootballFixture } from "@/lib/api-football/client";

// Shaped like a real /fixtures?date= response: API-Football's own short club names and team ids,
// mixed in with matches from other competitions.
const response: ApiFootballFixture[] = [
  { fixture: { id: 900001, date: "2026-10-10T14:00:00+00:00" }, teams: { home: { id: 541, name: "Real Madrid" }, away: { id: 529, name: "Barcelona" } } },
  { fixture: { id: 900002, date: "2026-10-10T14:00:00+00:00" }, teams: { home: { id: 42, name: "Arsenal" }, away: { id: 66, name: "Aston Villa" } } },
  { fixture: { id: 900003, date: "2026-10-10T16:30:00+00:00" }, teams: { home: { id: 50, name: "Manchester City" }, away: { id: 40, name: "Liverpool" } } },
];

// football-data.org externalIds (our Team.externalId): Arsenal 57, Aston Villa 58, Man City 65, Liverpool 64.
describe("findApiFootballFixture", () => {
  it("matches by club id even though the names differ ('Arsenal FC' vs 'Arsenal')", () => {
    expect(findApiFootballFixture(response, 57, 58)?.fixture.id).toBe(900002);
    expect(findApiFootballFixture(response, 65, 64)?.fixture.id).toBe(900003);
  });

  it("respects home/away order", () => {
    expect(findApiFootballFixture(response, 58, 57)).toBeNull();
  });

  it("returns null for a club missing from the id table", () => {
    expect(findApiFootballFixture(response, 999999, 58)).toBeNull();
  });
});

describe("ourTeamIdForLineup", () => {
  const fixture = {
    homeTeamId: "home-uuid",
    awayTeamId: "away-uuid",
    homeTeam: { externalId: 57 },
    awayTeam: { externalId: 58 },
  };

  it("maps API-Football team ids (not football-data ids) to our home/away teams", () => {
    expect(ourTeamIdForLineup(42, fixture)).toBe("home-uuid");
    expect(ourTeamIdForLineup(66, fixture)).toBe("away-uuid");
  });

  it("does not confuse a football-data id with an API-Football one", () => {
    expect(ourTeamIdForLineup(57, fixture)).toBeNull();
  });
});
