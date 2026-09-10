import { prisma } from "@/lib/prisma";
import { Prisma, type User } from "@/generated/prisma/client";

/**
 * Streaks are tracked on a UTC calendar day, not the viewer's local timezone — simplest
 * consistent definition for an MVP; a user near a timezone boundary may see their "day" roll
 * over a little earlier/later than midnight where they are.
 */
function todayUtcDateOnly(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isYesterday(lastLoginDate: Date, today: Date): boolean {
  const yesterday = new Date(today);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return lastLoginDate.getTime() === yesterday.getTime();
}

/**
 * Called once per session from the authenticated layout (which already fetches the user row to
 * render nav chrome) — no extra round trip on every navigation, only a write on the first
 * request of a new UTC day.
 *
 * Next.js can render the same layout concurrently for one navigation (e.g. a `<Link>` prefetch
 * racing the real navigation request), so two calls can both see `lastLoginDate` as "not today"
 * and race to write it. The unique constraint on DailyLoginLog makes the loser's transaction
 * throw P2002 — that's fine, it just means a concurrent call already recorded today's login, so
 * it's treated as a no-op rather than an error.
 */
export async function recordDailyLoginIfNeeded(user: Pick<User, "id" | "lastLoginDate" | "currentStreak" | "longestStreak">) {
  const today = todayUtcDateOnly();
  if (user.lastLoginDate && user.lastLoginDate.getTime() === today.getTime()) {
    return; // already recorded today
  }

  const newStreak = user.lastLoginDate && isYesterday(user.lastLoginDate, today) ? user.currentStreak + 1 : 1;

  try {
    await prisma.$transaction([
      prisma.dailyLoginLog.upsert({
        where: { userId_loginDate: { userId: user.id, loginDate: today } },
        update: {},
        create: { userId: user.id, loginDate: today },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginDate: today,
          currentStreak: newStreak,
          longestStreak: Math.max(user.longestStreak, newStreak),
        },
      }),
    ]);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return; // a concurrent request already recorded today's login
    }
    throw error;
  }
}
