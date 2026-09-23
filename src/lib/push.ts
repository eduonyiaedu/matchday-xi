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

/**
 * "timely" (the default): opens, lock warnings, matchday, scoring — delivered first, dropped after
 * 2 hours (a late "lock in 30 minutes" is worse than none). "broadcast": prize announcements, new
 * season — a message to everyone that can wait behind timely ones, kept for a day.
 */
export type PushKind = "timely" | "broadcast";
const KIND = {
  timely: { priority: 0, maxAgeMs: 2 * 60 * 60 * 1000 },
  broadcast: { priority: 1, maxAgeMs: 24 * 60 * 60 * 1000 },
} as const;

/** Devices sent to at once — bounded so a huge send can't exhaust sockets or memory. */
const SEND_CONCURRENCY = 25;
/** Rows claimed per delivery round — small, so a run cut off mid-round leaves little undeleted. */
const DRAIN_BATCH = 100;
/** Delivered rows are deleted in groups this size as they go, not only at the end of a round. */
const DELETE_EVERY = 25;
/** One device's push service gets this long before it counts as a failed attempt. */
const SEND_TIMEOUT_MS = 10_000;
/** A delivery run's claim older than this (the run was killed) can be retaken. */
const STALE_CLAIM_MS = 5 * 60 * 1000;
/** Give up on a device after this many failed tries. */
const MAX_ATTEMPTS = 5;
/** How long one delivery run may keep starting new rounds; the 5-minute sweep picks up the rest. */
const DRAIN_BUDGET_MS = 20_000;

export interface PlannedSend {
  userIds: string[];
  payload: PushPayload;
}

/**
 * Queues pushes to every device of these users (PushOutbox) and starts delivering straight away,
 * in the background after the current response where possible. Several sends passed together are
 * queued all-or-nothing (one transaction), so a failure can never leave some recipients queued
 * while the caller retries all of them. Never throws. Returns true once queued, or when VAPID keys
 * aren't configured (treated as handled — retrying does nothing, same as lib/notify.ts); false only
 * if nothing could be queued, so callers can clear their dedup flag and let the next sweep retry.
 * Delivery retries, expired devices and giving up are handled by the queue (drainPushOutbox).
 *
 * Nobody who has asked to delete their account gets pushes during the 30-day grace period. Their
 * subscriptions are kept (not deleted) so logging back in to cancel restores them without
 * re-subscribing; PURGE_EXPIRED_ACCOUNTS deletes them for good if the deletion goes ahead.
 */
export async function queuePushes(sends: PlannedSend[], kind: PushKind = "timely"): Promise<boolean> {
  const total = sends.reduce((n, s) => n + s.userIds.length, 0);
  if (total === 0) return true;
  if (!ensureConfigured()) {
    console.warn(`[push] VAPID keys not set — skipping push to ${total} user(s)`);
    return true;
  }

  const { priority, maxAgeMs } = KIND[kind];
  const expiresAt = new Date(Date.now() + maxAgeMs);
  try {
    const queued = await prisma.$transaction(
      async (tx) => {
        let count = 0;
        for (const send of sends) {
          for (const chunk of chunked([...new Set(send.userIds)])) {
            const subscriptions = await tx.pushSubscription.findMany({
              where: { userId: { in: chunk }, user: { deletionScheduledAt: null } },
              select: { id: true },
            });
            if (subscriptions.length === 0) continue;
            count += (
              await tx.pushOutbox.createMany({
                data: subscriptions.map((s) => ({ subscriptionId: s.id, payload: { ...send.payload }, priority, expiresAt })),
              })
            ).count;
          }
        }
        return count;
      },
      { timeout: 30_000 },
    );
    if (queued > 0) startDraining();
    return true;
  } catch (error) {
    console.error("[push] couldn't queue push:", error);
    return false;
  }
}

/** One message to these users — see queuePushes. */
export async function sendPushToUsers(userIds: string[], payload: PushPayload, kind: PushKind = "timely"): Promise<boolean> {
  return queuePushes([{ userIds, payload }], kind);
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
 * Works through queued pushes for up to `budgetMs`: claims a small batch (SKIP LOCKED, so
 * concurrent runs — several senders in one request, or the 5-minute sweep — each take different
 * rows), time-critical ones first, and sends with bounded concurrency and a per-device timeout.
 * Delivered rows are deleted as it goes, so a run cut off mid-batch re-sends at most a handful.
 * Devices that come back expired (410/404) are deleted; failures are retried once their claim
 * goes stale (a back-off). Pushes that failed MAX_ATTEMPTS times are never claimed again; only
 * the 5-minute notify sweep passes `removeGivenUp`, deleting and counting them (`gaveUp`) so it can
 * fail its job run — a broken setup (e.g. rotated VAPID keys) can't silently lose every
 * notification, and background runs can't delete them before the sweep has seen them.
 */
export async function drainPushOutbox(budgetMs = DRAIN_BUDGET_MS, opts: { removeGivenUp?: boolean } = {}) {
  const result = { sent: 0, failed: 0, expired: 0, droppedStale: 0, gaveUp: 0 };
  if (!ensureConfigured()) return result;
  const deadline = Date.now() + budgetMs;

  result.droppedStale = (await prisma.pushOutbox.deleteMany({ where: { expiresAt: { lt: new Date() }, attempts: { lt: MAX_ATTEMPTS } } })).count;
  if (opts.removeGivenUp) {
    result.gaveUp = (await prisma.pushOutbox.deleteMany({ where: { attempts: { gte: MAX_ATTEMPTS } } })).count;
  }

  while (Date.now() < deadline) {
    const claimedRows = await prisma.$queryRaw<{ id: string; subscriptionId: string; payload: PushPayload; priority: number; createdAt: Date }[]>`
      UPDATE "PushOutbox" SET "claimedAt" = now()
      WHERE id IN (
        SELECT id FROM "PushOutbox"
        WHERE ("claimedAt" IS NULL OR "claimedAt" < ${new Date(Date.now() - STALE_CLAIM_MS)})
          AND attempts < ${MAX_ATTEMPTS}
          AND "expiresAt" > now()
        ORDER BY priority, "createdAt"
        LIMIT ${DRAIN_BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "subscriptionId", payload, priority, "createdAt"`;
    if (claimedRows.length === 0) break;
    // RETURNING doesn't keep the subquery's order — sort so time-critical ones go out first here too.
    const claimed = claimedRows.sort((a, b) => a.priority - b.priority || a.createdAt.getTime() - b.createdAt.getTime());

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { id: { in: [...new Set(claimed.map((c) => c.subscriptionId))] } },
    });
    const subById = new Map(subscriptions.map((s) => [s.id, s]));
    let pendingDelete: string[] = [];
    const failed: string[] = [];
    const expiredSubs = new Set<string>();
    const flushDelivered = async () => {
      if (pendingDelete.length === 0) return;
      const ids = pendingDelete;
      pendingDelete = [];
      await prisma.pushOutbox.deleteMany({ where: { id: { in: ids } } });
    };

    await runWithConcurrency(claimed, SEND_CONCURRENCY, async (row) => {
      const sub = subById.get(row.subscriptionId);
      if (sub) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            JSON.stringify(row.payload),
            { timeout: SEND_TIMEOUT_MS },
          );
          result.sent++;
        } catch (error) {
          const statusCode = (error as { statusCode?: number }).statusCode;
          if (statusCode === 404 || statusCode === 410) {
            expiredSubs.add(sub.id);
          } else {
            console.error("[push] send failed:", error);
            failed.push(row.id);
          }
          return;
        }
      }
      // Delivered (or the device was already gone): remove it now, a few at a time.
      pendingDelete.push(row.id);
      if (pendingDelete.length >= DELETE_EVERY) await flushDelivered();
    });
    await flushDelivered();

    // Deleting an expired device also removes its queued rows (cascade).
    if (expiredSubs.size > 0) await prisma.pushSubscription.deleteMany({ where: { id: { in: [...expiredSubs] } } });
    // Failures keep their claim, so they're only retried once it goes stale (~5 minutes) — a
    // back-off, rather than hammering a struggling push service again within this same run.
    for (const chunk of chunked(failed)) {
      await prisma.pushOutbox.updateMany({ where: { id: { in: chunk } }, data: { attempts: { increment: 1 } } });
    }
    result.failed += failed.length;
    result.expired += expiredSubs.size;
  }
  return result;
}
