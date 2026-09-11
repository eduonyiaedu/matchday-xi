import { prisma } from "@/lib/prisma";

const OPEN_HOURS_BEFORE_KICKOFF = 24;

/**
 * The single fixture a team's prediction UI should ever offer for lineup-building. Filters on
 * `kickoffAt > now()` rather than fixture status, so a fixture that's already locked but not yet
 * scored (the pipeline scores ~55-75min pre-kickoff in the typical case, but can run later) still
 * correctly stops being "next" the moment its kickoff passes — the following fixture becomes
 * pickable immediately rather than waiting on scoring to finish.
 */
export async function getNextEligibleFixture(teamId: string) {
  return prisma.fixture.findFirst({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      kickoffAt: { gt: new Date() },
      status: { notIn: ["VOIDED", "POSTPONED", "ABANDONED", "SCORED"] },
    },
    orderBy: { kickoffAt: "asc" },
    include: { homeTeam: true, awayTeam: true, competition: true },
  });
}

export function predictionOpensAt(fixture: { kickoffAt: Date }): Date {
  return new Date(fixture.kickoffAt.getTime() - OPEN_HOURS_BEFORE_KICKOFF * 60 * 60 * 1000);
}

/** Authoritative "can this fixture be predicted right now" check — never trust client-sent state. */
export function isPredictionWindowOpen(fixture: { kickoffAt: Date; lockAt: Date }): boolean {
  const now = new Date();
  return now >= predictionOpensAt(fixture) && now < fixture.lockAt;
}
