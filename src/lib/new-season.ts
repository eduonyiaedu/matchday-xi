import { prisma } from "@/lib/prisma";
import { sendPushToUsers } from "@/lib/push";
import type { PlannedPush } from "@/lib/prize-notify";
import type { SeasonInfo } from "@/lib/seasons";

const DELETED_EMAIL_SUFFIX = "@deleted.matchday-xi.app";

/**
 * New-season club choice (founder's decision, 2026-09-23): a player's club is locked by their
 * first prediction, and that lock used to be permanent — nobody could ever switch club for a new
 * season. When a new season starts, every lock is cleared, returning players get a push asking
 * them to keep or change their club, and Home shows the same question until they answer or make
 * their first prediction of the new season (which locks the club again — predictions/route.ts).
 */
export async function clearClubLocksForNewSeason(): Promise<number> {
  const { count } = await prisma.user.updateMany({
    where: { favoriteTeamLockedAt: { not: null } },
    data: { favoriteTeamLockedAt: null },
  });
  return count;
}

/** Who gets the "new season — keep or change your club?" push. Planning only; sends nothing. */
export async function planNewSeasonPushes(season: Pick<SeasonInfo, "label" | "startDate">): Promise<PlannedPush[]> {
  const players = await prisma.user.findMany({
    where: {
      favoriteTeamId: { not: null },
      createdAt: { lt: season.startDate }, // returning players — anyone newer picked their club just now
      NOT: { email: { endsWith: DELETED_EMAIL_SUFFIX } },
    },
    select: { id: true, favoriteTeam: { select: { name: true, shortName: true } } },
  });
  const byClub = new Map<string, string[]>();
  for (const p of players) {
    const club = p.favoriteTeam?.shortName ?? p.favoriteTeam?.name ?? "your club";
    byClub.set(club, [...(byClub.get(club) ?? []), p.id]);
  }
  return [...byClub.entries()].map(([club, userIds]) => ({
    userIds,
    payload: {
      title: "Matchday XI",
      body: `The ${season.label} season is here! ⚽\nKeep supporting ${club}, or switch clubs before your first prediction.`,
      url: "/home",
    },
  }));
}

/**
 * Runs once when the standings sync first sees a new season (after its totals reset): clears club
 * locks, then announces. Pushes go out after the locks are cleared, best-effort, never retried.
 */
export async function startNewSeason(season: Pick<SeasonInfo, "label" | "startDate">) {
  const unlocked = await clearClubLocksForNewSeason();
  for (const push of await planNewSeasonPushes(season)) await sendPushToUsers(push.userIds, push.payload);
  return { unlocked };
}
