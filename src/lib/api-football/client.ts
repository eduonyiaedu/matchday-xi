/**
 * Thin client for API-Football (official lineups — rulebook §6).
 * Free tier: ~100 requests/day, hence the bounded lineup-check retry window in
 * lib/services/lineup-check.ts rather than continuous polling, AND the daily request cap
 * enforced below — the retry window alone wasn't enough (see reserveDailyRequestSlot).
 */

import { prisma } from "@/lib/prisma";

const BASE_URL = "https://v3.football.api-sports.io";

// Real free-tier ceiling is ~100/day; capped below that (and kept as an env var so raising it
// after a paid-tier upgrade is a config change, not a code change) after the ceiling was
// actually hit and got the account suspended. Tracked in the DB (ApiUsageCounter), not an
// in-memory counter, since that would reset on every serverless cold start and enforce nothing.
const DAILY_REQUEST_CAP = Number(process.env.API_FOOTBALL_DAILY_REQUEST_CAP ?? 90);

async function reserveDailyRequestSlot(): Promise<void> {
  const dateUtc = new Date().toISOString().slice(0, 10);
  const counter = await prisma.apiUsageCounter.upsert({
    where: { provider_dateUtc: { provider: "api-football", dateUtc } },
    update: { count: { increment: 1 } },
    create: { provider: "api-football", dateUtc, count: 1 },
  });
  if (counter.count > DAILY_REQUEST_CAP) {
    throw new Error(
      `API-Football daily request cap (${DAILY_REQUEST_CAP}) reached for ${dateUtc} — refusing further calls today.`,
    );
  }
}

export interface ApiFootballLineupPlayer {
  player: { id: number; name: string; number: number | null; pos: string | null };
}

export interface ApiFootballLineup {
  team: { id: number; name: string };
  formation: string | null;
  startXI: ApiFootballLineupPlayer[];
}

export interface ApiFootballFixture {
  fixture: { id: number; date: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
}

export interface ApiFootballSquadPlayer {
  id: number;
  name: string;
  number: number | null;
  position: string | null;
  photo: string | null;
}

class ApiFootballClient {
  private get apiKey(): string {
    const key = process.env.API_FOOTBALL_KEY;
    if (!key) throw new Error("API_FOOTBALL_KEY is not set");
    return key;
  }

  private async request<T>(path: string): Promise<T> {
    await reserveDailyRequestSlot();
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "x-apisports-key": this.apiKey },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`API-Football ${path} failed: ${res.status} ${body}`);
    }
    const body = await res.json();
    // API-Football returns HTTP 200 even when the request itself is rejected (wrong plan, date
    // outside the plan's allowed range, season not covered, etc.) — the rejection only shows up as
    // a non-empty `errors` object alongside an empty `response`. Left unchecked, every caller here
    // silently reads that as "nothing found yet" and retries forever without ever surfacing why.
    const errors = body?.errors;
    const hasErrors = errors && (Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0);
    if (hasErrors) {
      throw new Error(`API-Football ${path} rejected: ${JSON.stringify(errors)}`);
    }
    return body as T;
  }

  /** Find the API-Football fixture matching a football-data.org fixture by date + team names. */
  async findFixtureByDateAndTeams(
    isoDate: string,
    homeTeamName: string,
    awayTeamName: string,
  ): Promise<ApiFootballFixture | null> {
    const date = isoDate.slice(0, 10); // API-Football's `date` param is YYYY-MM-DD
    const data = await this.request<{ response: ApiFootballFixture[] }>(`/fixtures?date=${date}`);
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const home = normalize(homeTeamName);
    const away = normalize(awayTeamName);
    return (
      data.response.find(
        (f) => normalize(f.teams.home.name) === home && normalize(f.teams.away.name) === away,
      ) ?? null
    );
  }

  /** Official lineups for both sides of a fixture. Empty array if not yet announced. */
  async getLineups(apiFootballFixtureId: number): Promise<ApiFootballLineup[]> {
    const data = await this.request<{ response: ApiFootballLineup[] }>(
      `/fixtures/lineups?fixture=${apiFootballFixtureId}`,
    );
    return data.response;
  }

  /**
   * Full squad roster (with shirt numbers + photos) for one API-Football team id — works for
   * senior sides and U21 sides alike, confirmed on the free tier (see
   * lib/services/squad-enrichment-sync.ts, the only caller of this method).
   */
  async getSquad(apiFootballTeamId: number): Promise<ApiFootballSquadPlayer[]> {
    const data = await this.request<{ response: { players: ApiFootballSquadPlayer[] }[] }>(
      `/players/squads?team=${apiFootballTeamId}`,
    );
    return data.response[0]?.players ?? [];
  }
}

export const apiFootballClient = new ApiFootballClient();
