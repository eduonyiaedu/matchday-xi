import { prisma } from "@/lib/prisma";

/**
 * "Started last 5" form dots — derived at request time from official lineups we already store,
 * per the founder's decision to ship only data-dependent UI that needs no new schema. Returns a
 * map of squadPlayerId -> boolean[] (oldest to newest, always length <= 5; shorter if the team
 * hasn't played 5 fixtures with a confirmed lineup yet).
 */
export async function getRecentForm(teamId: string): Promise<Map<string, boolean[]>> {
  const recentFixtures = await prisma.fixture.findMany({
    where: {
      OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      status: { in: ["LINEUPS_FETCHED", "SCORED"] },
    },
    orderBy: { kickoffAt: "desc" },
    take: 5,
    select: {
      officialLineups: {
        where: { teamId },
        select: { players: { select: { squadPlayerId: true } } },
      },
    },
  });

  const startedSets = recentFixtures
    .map((f) => new Set(f.officialLineups[0]?.players.map((p) => p.squadPlayerId).filter((id): id is string => !!id) ?? []))
    .reverse(); // oldest to newest

  // Set true at each fixture's own index (not just appended) so a player's array stays
  // positionally aligned with the fixture window even if they missed some games in between.
  const form = new Map<string, boolean[]>();
  startedSets.forEach((startedSet, fixtureIndex) => {
    for (const id of startedSet) {
      const arr = form.get(id) ?? [];
      arr[fixtureIndex] = true;
      form.set(id, arr);
    }
  });
  return form;
}

/** Reads a player's form array out of the map, defaulting to an all-false array of the same length as the fixture window. */
export function formFor(map: Map<string, boolean[]>, squadPlayerId: string, windowSize: number): boolean[] {
  const raw = map.get(squadPlayerId) ?? [];
  return Array.from({ length: windowSize }, (_, i) => raw[i] ?? false);
}
