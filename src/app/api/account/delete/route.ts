import { NextRequest, NextResponse } from "next/server";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteAccountSchema } from "@/lib/validation";
import { createClient } from "@/lib/supabase/server";
import { formatDeletionBlock, leagueCreatorDeletionBlock } from "@/lib/account-deletion";

export const runtime = "nodejs";

const GRACE_PERIOD_DAYS = 30;

/**
 * Starts the 30-day soft-delete grace period (rulebook-adjacent, per the founder's account
 * deletion request) — schedules the account for anonymization, doesn't touch it immediately.
 * Logging back in before deletionScheduledAt passes cancels it automatically, see
 * getOrCreateCurrentUser in lib/auth.ts. Actual anonymization + Supabase auth-user removal
 * happens in the daily PURGE_EXPIRED_ACCOUNTS cron job once the grace period elapses.
 */
export async function POST(request: NextRequest) {
  const user = await getOrCreateCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = deleteAccountSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", issues: parsed.error.issues }, { status: 400 });
  }

  // Server-side gate for the league-creator rule (the profile page also hides the button, but
  // this is the authoritative check).
  const block = await leagueCreatorDeletionBlock(user.id);
  if (block) return NextResponse.json({ error: formatDeletionBlock(block) }, { status: 409 });

  const deletionScheduledAt = new Date(Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60_000);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { deletionScheduledAt } }),
    prisma.accountDeletionFeedback.create({
      data: { submittedByUserId: user.id, feedback: parsed.data.feedback ?? null },
    }),
  ]);

  // Sign out here, server-side (every device — the default "global" scope), rather than relying
  // only on the browser's own signOut() afterwards: any page load while still signed in cancels
  // the deletion (see getOrCreateCurrentUser), so a client-side sign-out that silently failed used
  // to leave the user signed in and quietly undo what they'd just asked for. This clears the
  // session cookies on this very response.
  const supabase = await createClient();
  const { error: signOutError } = await supabase.auth.signOut();
  if (signOutError) console.warn(`[account/delete] server-side sign-out failed for ${user.id}: ${signOutError.message}`);

  return NextResponse.json({ deletionScheduledAt });
}
