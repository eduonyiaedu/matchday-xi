/**
 * Thin client for football-data.org (fixtures, kickoff times, squads — rulebook §6).
 *
 * Free tier: 10 requests/minute, enforced by football-data.org itself (a 429 if exceeded).
 * This client self-throttles to a rolling max of 9 requests per 60s (one in reserve) so callers
 * don't need to think about pacing themselves — but callers should still avoid needlessly large
 * bursts (e.g. syncing 20 teams' squads in one call), both because self-throttling just makes
 * that slow rather than free, and because a single serverless invocation has its own timeout.
 * See lib/services/fixture-sync.ts for how squad syncing batches teams across multiple cron runs
 * instead of relying on this alone.
 */

const BASE_URL = "https://api.football-data.org/v4";
const MAX_REQUESTS_PER_WINDOW = 9;
const WINDOW_MS = 60_000;

/**
 * Rulebook §3 also calls for FA Cup and EFL Cup coverage, but football-data.org's free tier
 * (confirmed via a direct API call, Sep 2026) only grants ~13 top-flight leagues/cups and 403s
 * ("check your subscription") on both FAC and the actual EFL/League Cup code. API-Football's
 * free tier was checked too and can't discover cup fixture schedules more than a couple of days
 * ahead either. Per founder decision, cup coverage is deferred — Premier League only for now.
 * To re-enable: add the competition code back here, football-data.org's paid Standard tier
 * (~€49/mo, 30 competitions) is the most likely path to actually getting the data.
 */
export const COMPETITION_CODES = {
  PREMIER_LEAGUE: "PL",
} as const;

export interface FootballDataTeam {
  id: number;
  name: string;
  shortName: string | null;
  crest: string | null;
}

export interface FootballDataSquadPlayer {
  id: number;
  name: string;
  position: string | null; // e.g. "Goalkeeper", "Centre-Back", "Left Winger"
}

export interface FootballDataStandingRow {
  position: number;
  team: FootballDataTeam;
  playedGames: number;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface FootballDataScorer {
  player: { id: number; name: string };
  team: FootballDataTeam;
  goals: number;
  assists: number | null;
}

export interface FootballDataMatch {
  id: number;
  utcDate: string; // ISO 8601 kickoff time, UTC
  status: "SCHEDULED" | "TIMED" | "IN_PLAY" | "PAUSED" | "FINISHED" | "POSTPONED" | "SUSPENDED" | "CANCELLED";
  competition: { code: string };
  homeTeam: FootballDataTeam;
  awayTeam: FootballDataTeam;
  score: {
    fullTime: { home: number | null; away: number | null };
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class FootballDataClient {
  private requestTimestamps: number[] = [];

  private get apiKey(): string {
    const key = process.env.FOOTBALL_DATA_API_KEY;
    if (!key) throw new Error("FOOTBALL_DATA_API_KEY is not set");
    return key;
  }

  private async waitForRateLimitSlot(): Promise<void> {
    const now = Date.now();
    this.requestTimestamps = this.requestTimestamps.filter((t) => now - t < WINDOW_MS);
    if (this.requestTimestamps.length < MAX_REQUESTS_PER_WINDOW) return;

    const oldest = this.requestTimestamps[0];
    const waitMs = WINDOW_MS - (now - oldest) + 100; // small buffer past the window boundary
    await sleep(waitMs);
    return this.waitForRateLimitSlot();
  }

  private async request<T>(path: string, isRetry = false): Promise<T> {
    await this.waitForRateLimitSlot();
    this.requestTimestamps.push(Date.now());

    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { "X-Auth-Token": this.apiKey },
      // football-data.org data changes slowly; let cron jobs control freshness explicitly.
      cache: "no-store",
    });

    if (res.status === 429 && !isRetry) {
      // Belt-and-suspenders: our own throttle should prevent this, but honor the server's own
      // guidance if it still happens (e.g. another process sharing the same API key).
      const retryAfterSeconds = Number(res.headers.get("Retry-After")) || 20;
      await sleep(retryAfterSeconds * 1000 + 500);
      return this.request<T>(path, true);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`football-data.org ${path} failed: ${res.status} ${body}`);
    }
    return res.json() as Promise<T>;
  }

  /** All 20 current Premier League clubs. */
  async getPremierLeagueTeams(): Promise<FootballDataTeam[]> {
    const data = await this.request<{ teams: FootballDataTeam[] }>(
      `/competitions/${COMPETITION_CODES.PREMIER_LEAGUE}/teams`,
    );
    return data.teams;
  }

  /** Live squad list for one team — never hardcoded (rulebook §2). */
  async getTeamSquad(teamExternalId: number): Promise<FootballDataSquadPlayer[]> {
    const data = await this.request<{ squad: FootballDataSquadPlayer[] }>(`/teams/${teamExternalId}`);
    return data.squad;
  }

  /** Upcoming (and recently finished) fixtures for a competition, within a date window. */
  async getCompetitionMatches(
    competitionCode: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<FootballDataMatch[]> {
    const data = await this.request<{ matches: FootballDataMatch[] }>(
      `/competitions/${competitionCode}/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`,
    );
    return data.matches;
  }

  /** Current league table — free tier, confirmed working for the live current season. */
  async getStandings(competitionCode: string): Promise<FootballDataStandingRow[]> {
    const data = await this.request<{ standings: { type: string; table: FootballDataStandingRow[] }[] }>(
      `/competitions/${competitionCode}/standings`,
    );
    return data.standings.find((s) => s.type === "TOTAL")?.table ?? [];
  }

  /**
   * Season-long goals/assists leaderboard — free tier. No per-match goal-event breakdown exists
   * on this tier (confirmed directly against the live API, Sep 2026): a single match's detail
   * endpoint carries no goal events at all, only this aggregated season total per player.
   */
  async getScorers(competitionCode: string, limit = 20): Promise<FootballDataScorer[]> {
    const data = await this.request<{ scorers: FootballDataScorer[] }>(
      `/competitions/${competitionCode}/scorers?limit=${limit}`,
    );
    return data.scorers;
  }
}

export const footballDataClient = new FootballDataClient();
