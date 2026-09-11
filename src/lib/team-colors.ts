/**
 * Approximate club colors for the generic jersey graphic (components/predict/jersey.tsx) — not
 * exact official kit specs, just enough for a recognizable, legally-safe team-colored jersey
 * (real kit artwork/sponsor branding is a separate IP surface we're deliberately not touching).
 * Keyed by Team.externalId (football-data.org id). Hardcoded, same reasoning as
 * lib/api-football/club-team-ids.ts — static reference data, no admin UI needed.
 *
 * A couple of clubs whose actual primary shirt color is white (Fulham, Leeds, Tottenham) use
 * their accent color as `primary` instead, so a filled jersey never looks identical to an empty
 * (plain white) one.
 */
export interface TeamColors {
  primary: string;
  secondary: string;
}

export const TEAM_COLORS: Record<number, TeamColors> = {
  1044: { primary: "#DA291C", secondary: "#000000" }, // AFC Bournemouth
  57: { primary: "#EF0107", secondary: "#FFFFFF" }, // Arsenal FC
  58: { primary: "#670E36", secondary: "#95BFE5" }, // Aston Villa FC
  402: { primary: "#E30613", secondary: "#FFFFFF" }, // Brentford FC
  397: { primary: "#0057B8", secondary: "#FFFFFF" }, // Brighton & Hove Albion FC
  61: { primary: "#034694", secondary: "#FFFFFF" }, // Chelsea FC
  1076: { primary: "#78B9E7", secondary: "#000000" }, // Coventry City FC
  354: { primary: "#C4122E", secondary: "#1B458F" }, // Crystal Palace FC
  62: { primary: "#003399", secondary: "#FFFFFF" }, // Everton FC
  63: { primary: "#000000", secondary: "#FFFFFF" }, // Fulham FC (home kit is white — using black instead)
  322: { primary: "#F5A100", secondary: "#000000" }, // Hull City AFC
  349: { primary: "#0044A9", secondary: "#FFFFFF" }, // Ipswich Town FC
  341: { primary: "#FFCD00", secondary: "#1D428A" }, // Leeds United FC (home kit is white — using badge gold instead)
  64: { primary: "#C8102E", secondary: "#FFFFFF" }, // Liverpool FC
  65: { primary: "#6CABDD", secondary: "#1C2C5B" }, // Manchester City FC
  66: { primary: "#DA291C", secondary: "#FBE122" }, // Manchester United FC
  67: { primary: "#241F20", secondary: "#FFFFFF" }, // Newcastle United FC
  351: { primary: "#DD0000", secondary: "#FFFFFF" }, // Nottingham Forest FC
  71: { primary: "#EB172B", secondary: "#FFFFFF" }, // Sunderland AFC
  73: { primary: "#132257", secondary: "#FFFFFF" }, // Tottenham Hotspur FC (home kit is white — using navy instead)
};

export const DEFAULT_TEAM_COLORS: TeamColors = { primary: "#64748B", secondary: "#FFFFFF" };

export function getTeamColors(externalId: number): TeamColors {
  return TEAM_COLORS[externalId] ?? DEFAULT_TEAM_COLORS;
}
