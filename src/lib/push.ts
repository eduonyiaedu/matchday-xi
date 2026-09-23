import webpush from "web-push";
import { prisma } from "@/lib/prisma";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(`mailto:${process.env.ALERT_EMAIL_TO ?? "admin@matchday-xi.app"}`, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** App-relative path opened when the notification is tapped, e.g. "/predict/<id>". */
  url: string;
}

/**
 * Best-effort push send — never throws. Missing VAPID keys just logs (matches the pattern in
 * lib/notify.ts) and returns true (treated as handled — retrying with no keys configured does
 * nothing). A subscription that comes back expired (410/404) is deleted so it stops being
 * retried. Returns false only when at least one subscription hit a real, non-expiry send error,
 * so callers can clear their dedup flag and let the next sweep retry instead of permanently
 * treating a transient webpush outage as "delivered" (same reasoning as lib/notify.ts).
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<boolean> {
  if (userIds.length === 0) return true;
  if (!ensureConfigured()) {
    console.warn(`[push] VAPID keys not set — skipping push to ${userIds.length} user(s): ${payload.title}`);
    return true;
  }

  // Nobody who has asked to delete their account gets pushes during the 30-day grace period. The
  // subscriptions themselves are kept (not deleted) so logging back in to cancel restores them
  // without re-subscribing; PURGE_EXPIRED_ACCOUNTS deletes them for good if the deletion goes ahead.
  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds }, user: { deletionScheduledAt: null } },
  });
  const body = JSON.stringify(payload);

  let hadRealFailure = false;
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, body);
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error("[push] send failed:", error);
          hadRealFailure = true;
        }
      }
    }),
  );
  return !hadRealFailure;
}
