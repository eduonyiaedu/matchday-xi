import { prisma } from "@/lib/prisma";
import { queuePushes, type PushPayload } from "@/lib/push";

/**
 * Prize announcements (founder's choice, 2026-09-23): the winner gets a push AND a "You won!"
 * banner on Home until they dismiss it (the banner is the backstop for anyone with notifications
 * off), and every other player gets a push saying who won.
 *
 * Planning (who gets told what) is separate from sending, so the recipient lists can be verified
 * without pushing anything to real devices. Sending is claim-then-send and best-effort with no
 * retry — the same precedent as the lock nudge in lock-sweep.ts: a fan-out to many users doesn't
 * fit a single "notified" flag, and re-sending to everyone because one push failed would be worse.
 * The winner's Home banner doesn't depend on the push at all.
 */
export interface PlannedPush {
  userIds: string[];
  payload: PushPayload;
}

const MONTHS = "January February March April May June July August September October November December".split(" ");

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

export function ordinal(place: number): string {
  return place === 1 ? "1st" : place === 2 ? "2nd" : place === 3 ? "3rd" : `${place}th`;
}

/** Every activated player (picked a team) except the given winners. */
async function everyoneExcept(winnerIds: string[]): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { favoriteTeamId: { not: null }, id: { notIn: winnerIds } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function planMonthlyDrawPushes(draw: { month: string; winnerUserId: string | null }): Promise<PlannedPush[]> {
  if (!draw.winnerUserId) return [];
  const winner = await prisma.user.findUniqueOrThrow({ where: { id: draw.winnerUserId }, select: { displayName: true } });
  const label = monthLabel(draw.month);
  return [
    {
      userIds: [draw.winnerUserId],
      payload: { title: "Matchday XI", body: `You won the ${label} prize draw! 🏆\nWe'll be in touch about your prize.`, url: "/prizes" },
    },
    {
      userIds: await everyoneExcept([draw.winnerUserId]),
      payload: {
        title: "Matchday XI",
        body: `${winner.displayName} won the ${label} prize draw! 🎉\nPredict every matchday and log in daily to be in next month's draw.`,
        url: "/prizes",
      },
    },
  ];
}

/** Sends the monthly draw announcement exactly once per draw (atomic claim on winnerNotifiedAt). */
export async function notifyMonthlyDrawIfNeeded(drawId: string): Promise<boolean> {
  const { count } = await prisma.monthlyPrizeDraw.updateMany({
    where: { id: drawId, winnerNotifiedAt: null, drawnAt: { not: null }, winnerUserId: { not: null } },
    data: { winnerNotifiedAt: new Date() },
  });
  if (count === 0) return false;
  const draw = await prisma.monthlyPrizeDraw.findUniqueOrThrow({ where: { id: drawId } });
  // Queued all-or-nothing; if the queue couldn't be written, release the claim so it's retried.
  if (!(await queuePushes(await planMonthlyDrawPushes(draw), "broadcast"))) {
    await prisma.monthlyPrizeDraw.update({ where: { id: drawId }, data: { winnerNotifiedAt: null } });
    return false;
  }
  return true;
}

export async function planSeasonPrizePushes(
  season: string,
  prizes: { place: number; userId: string; displayName: string }[],
): Promise<PlannedPush[]> {
  if (prizes.length === 0) return [];
  const medals = ["🥇", "🥈", "🥉"];
  const podium = prizes.map((p) => `${medals[p.place - 1] ?? ""} ${p.displayName}`.trim()).join(", ");
  return [
    ...prizes.map((p) => ({
      userIds: [p.userId],
      payload: {
        title: "Matchday XI",
        body: `You finished ${ordinal(p.place)} in the ${season} season! 🏆\nWe'll be in touch about your prize.`,
        url: "/prizes",
      },
    })),
    {
      userIds: await everyoneExcept(prizes.map((p) => p.userId)),
      payload: { title: "Matchday XI", body: `The ${season} season winners are in! 🏆\n${podium}`, url: "/prizes" },
    },
  ];
}

/** Sends the season-end announcement exactly once (atomic claim on the rows' notifiedAt). */
export async function notifySeasonPrizesIfNeeded(competitionId: string, season: string): Promise<boolean> {
  const { count } = await prisma.seasonPrize.updateMany({
    where: { competitionId, season, notifiedAt: null },
    data: { notifiedAt: new Date() },
  });
  if (count === 0) return false;
  const prizes = await prisma.seasonPrize.findMany({
    where: { competitionId, season },
    orderBy: { place: "asc" },
    include: { user: { select: { displayName: true } } },
  });
  const plan = await planSeasonPrizePushes(
    season,
    prizes.map((p) => ({ place: p.place, userId: p.userId, displayName: p.user.displayName })),
  );
  // Queued all-or-nothing; if the queue couldn't be written, release the claim so it's retried.
  if (!(await queuePushes(plan, "broadcast"))) {
    await prisma.seasonPrize.updateMany({ where: { competitionId, season }, data: { notifiedAt: null } });
    return false;
  }
  return true;
}
