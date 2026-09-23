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
  // No longer due by the time we got to it: cancelled by logging back in, or already handled by
  // an overlapping run.
  let skipped = 0;

  for (const { id } of expired) {
    try {
      // Claim-and-anonymize in one conditional write, re-checking the deletion is STILL due at the
      // moment of acting — the `expired` list above was read once at the start, and logging back
      // in (lib/auth.ts) cancels a deletion by clearing deletionScheduledAt. Without this re-check,
      // someone who logged back in while this loop was working through earlier accounts would
      // still have their login deleted and their name wiped. deletionScheduledAt is deliberately
      // left set here and only cleared once the auth login is really gone (below), so a run that
      // fails between the two steps simply retries next time — the anonymize is idempotent.
      const claimed = await prisma.$transaction(async (tx) => {
        const { count } = await tx.user.updateMany({
          where: { id, deletionScheduledAt: { lte: now } },
          data: {
            email: `deleted-${id}@deleted.matchday-xi.app`,
            // Full id, not a truncated slice — username is @unique, and a truncated 8-hex-char
            // slice has a real (if rare) collision risk between two different users' ids, which
            // would then fail identically on every retry, forever.
            username: `deleted-${id}`,
            displayName: "Deleted user",
          },
        });
        if (count === 0) return false;
        // Anonymizing the row doesn't stop pushes on its own: the matchday/lock jobs pick
        // recipients by favoriteTeamId (kept, so their points stay on the leaderboards), and
        // push.ts then sends to every subscription of those users.
        await tx.pushSubscription.deleteMany({ where: { userId: id } });
        return true;
      });
      if (!claimed) {
        skipped++;
        continue;
      }

      const { error } = await admin.auth.admin.deleteUser(id);
      // "Already gone" is success — a retry after a prior run deleted the login but failed before
      // the final write below, same reasoning as push.ts treating an expired subscription's
      // 404/410 as handled, not a real failure.
      if (error && error.status !== 404) throw new Error(error.message);

      await prisma.user.update({ where: { id }, data: { deletionScheduledAt: null } });
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

  return { purged, skipped };
}
