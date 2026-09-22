import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";

function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, serviceRoleKey);
}

/**
 * Daily purge for accounts past their 30-day deletion grace period (see api/account/delete).
 * Anonymizes the Prisma row in place rather than hard-deleting it — keeps points/predictions/
 * history intact so other users' leaderboards, private-league standings, and prize-draw records
 * stay accurate, per the founder's explicit decision. The Supabase auth login IS actually deleted.
 *
 * Per-item isolation (one account's failure can't block the rest) but still surfaces an aggregate
 * failure at the end if anything failed, per this codebase's established pattern — see
 * squad-enrichment-sync.ts's real incident for why a silently-swallowed per-item failure is
 * dangerous.
 */
export async function purgeExpiredAccounts() {
  const admin = supabaseAdmin();
  const now = new Date();
  const expired = await prisma.user.findMany({
    where: { deletionScheduledAt: { lte: now } },
    select: { id: true },
  });

  const failed: { userId: string; error: string }[] = [];
  let purged = 0;

  for (const { id } of expired) {
    try {
      const { error } = await admin.auth.admin.deleteUser(id);
      // A retry after a prior run's Prisma anonymize step failed but the auth deletion already
      // succeeded would otherwise fail here forever — "already gone" is success, same reasoning
      // as push.ts treating an expired subscription's 404/410 as handled, not a real failure.
      if (error && error.status !== 404) throw new Error(error.message);

      await prisma.user.update({
        where: { id },
        data: {
          email: `deleted-${id}@deleted.matchday-xi.app`,
          username: `deleted-${id.slice(0, 8)}`,
          displayName: "Deleted user",
          deletionScheduledAt: null,
        },
      });
      purged++;
    } catch (error) {
      failed.push({ userId: id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  if (failed.length > 0) {
    throw new Error(
      `${failed.length} account(s) failed to purge: ${failed.map((f) => `${f.userId} (${f.error})`).join("; ")}. Purged: ${purged}.`,
    );
  }

  return { purged };
}
