/**
 * Thin client for API-Football (official lineups — rulebook §6).
 * Free tier: 100 requests/day AND 10 requests/minute. Both are enforced below, before every
 * request, by DB-backed counters (reserveRequestSlot) — on top of the bounded lineup-check retry
 * window in lib/services/lineup-check.ts, which alone wasn't enough.
 */

import { prisma } from "@/lib/prisma";

const BASE_URL = "https://v3.football.api-sports.io";
const PROVIDER = "api-football";

// Real free-tier ceiling is 100/day; capped below that (and kept as an env var so raising it
// after a paid-tier upgrade is a config change, not a code change) after the ceiling was
// actually hit and got the account suspended. Tracked in the DB (ApiUsageCounter), not an
// in-memory counter, since that would reset on every serverless cold start and enforce nothing.
const DAILY_REQUEST_CAP = Number(process.env.API_FOOTBALL_DAILY_REQUEST_CAP ?? 90);

// Real free-tier ceiling is 10/minute. Counted per UTC calendar minute, and deliberately capped
// at 3 rather than 9: API-Football's own window may be a rolling 60s rather than aligned to our
// calendar minutes, and any 60-second span of time touches at most 3 calendar minutes even
// allowing for a request that takes a while to actually go out after reserving its slot — so
// 3 per calendar minute guarantees at most 9 in ANY 60 seconds, however bursts line up. Also an
// env var, for the paid-tier upgrade.
const PER_MINUTE_REQUEST_CAP = Number(process.env.API_FOOTBALL_PER_MINUTE_CAP ?? 3);

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Thrown BEFORE any request is sent when a cap is already used up — nothing reached
 * API-Football. `window: "minute"` is routine back-pressure (callers defer to their next run);
 * `window: "day"` means nothing more can be fetched until 00:00 UTC.
 */
export class ApiFootballBudgetError extends Error {
  constructor(
    readonly window: "minute" | "day",
    message: string,
  ) {
    super(message);
    this.name = "ApiFootballBudgetError";
  }
}

/** Atomically counts one request against a (provider, window) row; returns the new count. */
async function countRequest(provider: string, windowKey: string): Promise<number> {
  const counter = await prisma.apiUsageCounter.upsert({
    where: { provider_dateUtc: { provider, dateUtc: windowKey } },
    update: { count: { increment: 1 } },
    create: { provider, dateUtc: windowKey, count: 1 },
  });
  return counter.count;
}

/**
 * Reserves one request against both caps. The per-minute check runs first so a request refused
 * for the minute doesn't also burn a slot of the scarcer daily budget. Exported (with the provider
 * name as a parameter) only so the limiter can be verified against throwaway counter rows.
 */
export async function reserveRequestSlot(
  provider = PROVIDER,
  caps = { perMinute: PER_MINUTE_REQUEST_CAP, perDay: DAILY_REQUEST_CAP },
  now = new Date(),
): Promise<void> {
  const iso = now.toISOString();
  const minuteKey = iso.slice(0, 16); // "2026-09-23T13:05"
  const dayKey = iso.slice(0, 10); // "2026-09-23"

  if ((await countRequest(`${provider}:minute`, minuteKey)) > caps.perMinute) {
    throw new ApiFootballBudgetError(
      "minute",
      `API-Football per-minute cap (${caps.perMinute}) reached for ${minuteKey} UTC — deferring.`,
    );
  }

  const dailyCount = await countRequest(provider, dayKey);
  if (dailyCount === 1) {
    // First request of a new UTC day: clear out old per-minute rows so they don't pile up.
    await prisma.apiUsageCounter.deleteMany({ where: { provider: `${provider}:minute`, dateUtc: { lt: dayKey } } });
  }
  if (dailyCount > caps.perDay) {
    throw new ApiFootballBudgetError(
      "day",
      `API-Football daily request cap (${caps.perDay}) reached for ${dayKey} — refusing further calls today.`,
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
    await reserveRequestSlot();
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "x-apisports-key": this.apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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

  /**
   * Every fixture API-Football has on one UTC date (all competitions) — one request covers every
   * PL match that day; see lib/api-football/match.ts for picking ours out of it.
   */
  async getFixturesByDate(dateUtc: string): Promise<ApiFootballFixture[]> {
    const data = await this.request<{ response: ApiFootballFixture[] }>(`/fixtures?date=${dateUtc}`);
    return data.response;
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
