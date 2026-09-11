/**
 * Maps each PL club's football-data.org Team.externalId to its API-Football team ids — one for
 * the senior side, one for the U21 side. football-data.org has no concept of U21 squads at all,
 * so this is the only way to source them (see lib/services/squad-enrichment-sync.ts).
 *
 * Looked up once via API-Football's `/teams?search=` (Sep 2026) — static reference data, not
 * synced, since club identities essentially never change. Keyed by football-data externalId so
 * callers can go straight from a `Team` row to both API-Football ids without a second lookup.
 */
export const API_FOOTBALL_CLUB_TEAM_IDS: Record<number, { senior: number; u21: number }> = {
  1044: { senior: 35, u21: 20000 }, // AFC Bournemouth
  57: { senior: 42, u21: 7189 }, // Arsenal FC
  58: { senior: 66, u21: 7190 }, // Aston Villa FC
  402: { senior: 55, u21: 20079 }, // Brentford FC
  397: { senior: 51, u21: 7191 }, // Brighton & Hove Albion FC
  61: { senior: 49, u21: 7192 }, // Chelsea FC
  1076: { senior: 1346, u21: 20092 }, // Coventry City FC
  354: { senior: 52, u21: 17000 }, // Crystal Palace FC
  62: { senior: 45, u21: 7193 }, // Everton FC
  63: { senior: 36, u21: 7194 }, // Fulham FC
  322: { senior: 64, u21: 20084 }, // Hull City AFC
  349: { senior: 57, u21: 20094 }, // Ipswich Town FC
  341: { senior: 63, u21: 14430 }, // Leeds United FC
  64: { senior: 40, u21: 7196 }, // Liverpool FC
  65: { senior: 50, u21: 7197 }, // Manchester City FC
  66: { senior: 33, u21: 7198 }, // Manchester United FC
  67: { senior: 34, u21: 7199 }, // Newcastle United FC
  351: { senior: 65, u21: 19746 }, // Nottingham Forest FC
  71: { senior: 746, u21: 11915 }, // Sunderland AFC
  73: { senior: 47, u21: 7202 }, // Tottenham Hotspur FC
};
