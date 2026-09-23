import { prisma } from "@/lib/prisma";
import { COMPETITION_CODES } from "@/lib/football-data/client";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DeletionBlock {
  /** The creator's leagues that (or whose season) are still in progress. */
  leagueNames: string[];
  /** The first day deletion becomes possible, or null if unknown. */
  allowedFrom: Date | null;
}

/**
 * A private league's creator is the only one who can approve join requests, so they can't delete
 * their account while any league they created belongs to a season still in progress — founder's
 * rule (2026-09-23): not until the competition the league uses is over. Otherwise a league
 * mid-season would be left with join requests nobody can ever approve.
 *
 * Returns null when deletion is allowed. Each league blocks until its own end date AND (if its
 * window overlaps the competition's current season) the season's end have both passed, so
 * leagues from a finished season don't keep blocking once the next season starts, and a league
 * running past its season's end keeps blocking until the league itself is over. If the season
 * dates aren't known yet (the standings sync hasn't recorded them), deletion is blocked rather
 * than risk the orphaned-league case.
 */
export async function leagueCreatorDeletionBlock(userId: string): Promise<DeletionBlock | null> {
  const leagues = await prisma.privateLeague.findMany({
    where: { creatorId: userId },
    select: { name: true, endDate: true, restrictedCompetitionId: true },
  });
  if (leagues.length === 0) return null;

  // Every league runs on the Premier League today; restrictedCompetitionId is the hook for more.
  const competitions = await prisma.competition.findMany({
    select: { id: true, externalId: true, currentSeasonStartDate: true, currentSeasonEndDate: true },
  });
  const defaultCompetition = competitions.find((c) => c.externalId === COMPETITION_CODES.PREMIER_LEAGUE);

  const now = Date.now();
  const blocking: { name: string; allowedFrom: Date | null }[] = [];
  for (const league of leagues) {
    const competition = competitions.find((c) => c.id === league.restrictedCompetitionId) ?? defaultCompetition;
    const start = competition?.currentSeasonStartDate;
    const end = competition?.currentSeasonEndDate;
    if (!start || !end) {
      blocking.push({ name: league.name, allowedFrom: null });
      continue;
    }
    // Blocked until BOTH the league's own window and (if it overlaps the current season) that
    // season are over — whichever is later. Using only the season end let a creator delete while a
    // league running past it (Jan–Dec, or one created for next season before football-data rolls
    // over) still had months to go. The last day of each still counts.
    const leagueOver = new Date(league.endDate.getTime() + DAY_MS);
    const seasonOver = new Date(end.getTime() + DAY_MS);
    const leagueInThisSeason = league.endDate.getTime() >= start.getTime();
    const allowedFrom = leagueInThisSeason && seasonOver > leagueOver ? seasonOver : leagueOver;
    if (now < allowedFrom.getTime()) blocking.push({ name: league.name, allowedFrom });
  }
  if (blocking.length === 0) return null;

  const dates = blocking.map((b) => b.allowedFrom);
  return {
    leagueNames: blocking.map((b) => b.name),
    allowedFrom: dates.some((d) => d === null) ? null : new Date(Math.max(...dates.map((d) => d!.getTime()))),
  };
}

export function formatDeletionBlock(block: DeletionBlock): string {
  const leagues = block.leagueNames.length === 1 ? `the private league "${block.leagueNames[0]}"` : `${block.leagueNames.length} private leagues`;
  const when = block.allowedFrom
    ? `from ${block.allowedFrom.toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" })}, once your league and its season have finished`
    : "once your league and the current season have finished";
  return `You created ${leagues}, and as its creator you're the only one who can approve people joining. You can delete your account ${when}.`;
}
