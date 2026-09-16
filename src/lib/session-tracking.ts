import { prisma } from "@/lib/prisma";

// A gap longer than this since the user's last recorded activity starts a brand-new session row
// instead of extending the old one — the same 30-minute convention most web analytics tools use.
const SESSION_GAP_MINUTES = 30;
// Extending an existing session only writes if this much time has passed since it was last
// bumped, so a user clicking around doesn't trigger a DB write on every single page load.
const UPDATE_THROTTLE_MINUTES = 5;

/**
 * Called once per (app) page load, alongside recordDailyLoginIfNeeded — best-effort, never
 * throws, since losing a session data point is far better than breaking a page load over it.
 */
export async function recordSessionActivity(userId: string): Promise<void> {
  try {
    const now = new Date();
    const last = await prisma.sessionLog.findFirst({
      where: { userId },
      orderBy: { lastSeenAt: "desc" },
    });

    if (!last) {
      await prisma.sessionLog.create({ data: { userId, startedAt: now, lastSeenAt: now } });
      return;
    }

    const minutesSinceLastSeen = (now.getTime() - last.lastSeenAt.getTime()) / 60_000;
    if (minutesSinceLastSeen > SESSION_GAP_MINUTES) {
      await prisma.sessionLog.create({ data: { userId, startedAt: now, lastSeenAt: now } });
    } else if (minutesSinceLastSeen > UPDATE_THROTTLE_MINUTES) {
      await prisma.sessionLog.update({ where: { id: last.id }, data: { lastSeenAt: now } });
    }
  } catch (error) {
    console.error("[session-tracking] failed to record activity:", error);
  }
}
