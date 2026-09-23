import webpush from "web-push";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { chunked } from "@/lib/chunked";

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

/** Devices sent to at once — bounded so a huge send can't exhaust sockets or memory. */
const SEND_CONCURRENCY = 25;
/** Rows claimed per delivery round. */
const DRAIN_BATCH = 500;
/** A delivery run's claim older than this (the run was killed) can be retaken. */
const STALE_CLAIM_MS = 5 * 60 * 1000;
/** Give up on a device after this many failed tries. */
const MAX_ATTEMPTS = 5;
/** Notifications are time-sensitive ("lock in 30 minutes") — drop anything this old instead. */
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** How long one delivery run may keep going; the 5-minute sweep picks up anything left. */
const DRAIN_BUDGET_MS = 25_000;

/**
 * Queues a push to every device of these users (lib: PushOutbox) and starts delivering straight
 * away, in the background after the current response where possible. Never throws. Returns true
 * once queued, or when VAPID keys aren't configured (treated as handled — retrying does nothing,
 * same as lib/notify.ts); false only if the queue itself couldn't be written, so callers can
 * clear their dedup flag and let the next sweep retry. Delivery retries and expired devices are
 * handled by the queue itself (drainPushOutbox), not by callers.
 *
 * Nobody who has asked to delete their account gets pushes during the 30-day grace period. Their
 * subscriptions are kept (not deleted) so logging back in to cancel restores them without
 * re-subscribing; PURGE_EXPIRED_ACCOUNTS deletes them for good if the deletion goes ahead.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<boolean> {
  if (userIds.length === 0) return true;
  if (!ensureConfigured()) {
    console.warn(`[push] VAPID keys not set — skipping push to ${userIds.length} user(s): ${payload.title}`);
    return true;
  }

  try {
    let queued = 0;
    for (const chunk of chunked([...new Set(userIds)])) {
      const subscriptions = await prisma.pushSubscription.findMany({
        where: { userId: { in: chunk }, user: { deletionScheduledAt: null } },
        select: { id: true },
      });
      if (subscriptions.length === 0) continue;
      const { count } = await prisma.pushOutbox.createMany({
        data: subscriptions.map((s) => ({ subscriptionId: s.id, payload: { ...payload } })),
      });
      queued += count;
    }
    if (queued > 0) startDraining();
    return true;
  } catch (error) {
    console.error("[push] couldn't queue push:", error);
    return false;
  }
}

/** Deliver in the background once the current response is sent; inline where there's no request. */
function startDraining() {
  const run = () => drainPushOutbox().catch((error) => console.error("[push] delivery run failed:", error));
  try {
    after(run);
  } catch {
    // Outside a request (a script) — `after` isn't available, so just deliver now.
    void run();
  }
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/**
 * Works through queued pushes for up to `budgetMs`: claims a batch (SKIP LOCKED, so concurrent
 * runs — several senders in one request, or the 5-minute sweep — each take different rows),
 * sends with bounded concurrency, deletes delivered rows, deletes devices that come back expired
 * (410/404), and leaves failures to be retried once their claim goes stale. Anything left is
 * picked up by the next run — the 5-minute notify sweep always runs one.
 */
export async function drainPushOutbox(budgetMs = DRAIN_BUDGET_MS) {
  const result = { sent: 0, failed: 0, expired: 0, dropped: 0 };
  if (!ensureConfigured()) return result;
  const deadline = Date.now() + budgetMs;

  // Too old to still be useful, or given up on after repeated failures.
  const dropped = await prisma.pushOutbox.deleteMany({
    where: { OR: [{ createdAt: { lt: new Date(Date.now() - MAX_AGE_MS) } }, { attempts: { gte: MAX_ATTEMPTS } }] },
  });
  result.dropped = dropped.count;

  while (Date.now() < deadline) {
    const claimed = await prisma.$queryRaw<{ id: string; subscriptionId: string; payload: PushPayload }[]>`
      UPDATE "PushOutbox" SET "claimedAt" = now()
      WHERE id IN (
        SELECT id FROM "PushOutbox"
        WHERE ("claimedAt" IS NULL OR "claimedAt" < ${new Date(Date.now() - STALE_CLAIM_MS)})
          AND attempts < ${MAX_ATTEMPTS}
        ORDER BY "createdAt"
        LIMIT ${DRAIN_BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "subscriptionId", payload`;
    if (claimed.length === 0) break;

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { id: { in: [...new Set(claimed.map((c) => c.subscriptionId))] } },
    });
    const subById = new Map(subscriptions.map((s) => [s.id, s]));
    const delivered: string[] = [];
    const failed: string[] = [];
    const expiredSubs = new Set<string>();

    await runWithConcurrency(claimed, SEND_CONCURRENCY, async (row) => {
      const sub = subById.get(row.subscriptionId);
      if (!sub) {
        delivered.push(row.id); // device already gone — nothing to deliver
        return;
      }
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(row.payload),
        );
        delivered.push(row.id);
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          expiredSubs.add(sub.id);
        } else {
          console.error("[push] send failed:", error);
          failed.push(row.id);
        }
      }
    });

    for (const chunk of chunked(delivered)) await prisma.pushOutbox.deleteMany({ where: { id: { in: chunk } } });
    // Deleting an expired device also removes its queued rows (cascade).
    if (expiredSubs.size > 0) await prisma.pushSubscription.deleteMany({ where: { id: { in: [...expiredSubs] } } });
    // Failures keep their claim, so they're only retried once it goes stale (~5 minutes) — a
    // back-off, rather than hammering a struggling push service again within this same run.
    for (const chunk of chunked(failed)) {
      await prisma.pushOutbox.updateMany({ where: { id: { in: chunk } }, data: { attempts: { increment: 1 } } });
    }
    result.sent += delivered.length;
    result.failed += failed.length;
    result.expired += expiredSubs.size;
  }
  return result;
}
