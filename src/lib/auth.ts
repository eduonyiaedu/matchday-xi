import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { assessNewAccount } from "@/lib/account-trust";

/** Same rule the signup forms and /api/auth/check-username enforce. */
const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

/** Returns the app's User row for the currently authenticated Supabase session, or null. */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  return prisma.user.findUnique({ where: { id: authUser.id } });
}

function sanitizeUsernameBase(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_]/g, "");
  return cleaned.slice(0, 14) || "player";
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/**
 * Same as getCurrentUser, but also ensures a User profile row exists (first sign-in).
 *
 * Wrapped in React's `cache()` so the layout and every page in a request tree share one call
 * instead of each independently upserting — without this, a brand-new user's first request
 * (layout + page both calling this concurrently) could race two `create`s against the same
 * primary key. `cache()` only dedupes within a single request, so the upsert itself still
 * falls back to a plain read on a unique-constraint conflict as a defensive safety net for the
 * rarer cross-request race (e.g. two tabs opened in the same instant right after sign-up).
 *
 * Returns null — same as "not signed in" — for a Supabase session that has no app-level User
 * row AND no consent metadata. That's a brand-new account from clicking "Continue with Google"
 * on the *login* page (see auth/callback/route.ts), normally caught immediately by a redirect
 * to /auth/consent; this is the backstop for a user who closes the tab, hits back, or otherwise
 * reaches a protected page/API directly before finishing that interstitial. Every caller already
 * treats a null user as "not authenticated" (pages redirect to /login, API routes 401), so this
 * refusal to auto-create closes the bypass everywhere without needing per-caller changes.
 */
export const getOrCreateCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const existingUser = await prisma.user.findUnique({ where: { id: authUser.id } });
  // Already anonymized by PURGE_EXPIRED_ACCOUNTS (its login deletion follows the anonymize, and
  // could fail and retry) — never let a lingering login reactivate a "Deleted user" row.
  if (existingUser?.email.endsWith("@deleted.matchday-xi.app")) return null;
  if (existingUser) {
    // Logging back in ever cancels a pending deletion — deliberately not conditioned on
    // deletionScheduledAt still being in the future. PURGE_EXPIRED_ACCOUNTS only runs once daily,
    // so there's up to ~24h after the scheduled date passes where the row hasn't actually been
    // purged yet; a user logging in during exactly that window must still get the "log back in
    // and it's cancelled" behavior the profile page promises them, not a silent no-op that lets
    // that night's purge run anonymize them anyway. Cheap no-op read for the overwhelming
    // majority of users where the field is simply null either way.
    if (existingUser.deletionScheduledAt) {
      return prisma.user.update({ where: { id: existingUser.id }, data: { deletionScheduledAt: null } });
    }
    return existingUser;
  }

  // Signup consent timestamps + username (see AuthForm) ride along as Supabase user_metadata —
  // set directly in options.data for password/magic-link signup, or via updateUser() in the
  // OAuth callback route for Google signup — and land here only once, at profile-row creation.
  const ageConfirmedAt = authUser.user_metadata?.ageConfirmedAt as string | undefined;
  const tosConsentedAt = authUser.user_metadata?.tosConsentedAt as string | undefined;
  if (!ageConfirmedAt || !tosConsentedAt) return null;

  // user_metadata is client-controlled (set by the browser at signup, or copied from the OAuth
  // callback's ?username= param), so the signup form's format rule is re-checked here — the only
  // server-side gate before the value becomes a permanent, public username. Anything that fails it
  // (uppercase lookalikes of an existing name, overlong strings, reserved "deleted-…" shapes) falls
  // back to the generated username below instead.
  const rawUsername: unknown = authUser.user_metadata?.username;
  const requestedUsername =
    typeof rawUsername === "string" && USERNAME_PATTERN.test(rawUsername) ? rawUsername : undefined;
  const fallbackBase = sanitizeUsernameBase(authUser.email?.split("@")[0] ?? "player");
  const displayName =
    (authUser.user_metadata?.full_name as string | undefined) ??
    authUser.email?.split("@")[0] ??
    "Player";
  // Likely duplicate / throwaway accounts are flagged out of prize contention (never blocked).
  const trust = await assessNewAccount(authUser.email ?? "");
  const trustFields = {
    normalizedEmail: trust.normalizedEmail,
    isFlaggedDuplicate: trust.flagReason !== null,
    flagReason: trust.flagReason,
  };

  try {
    return await prisma.user.create({
      data: {
        id: authUser.id,
        email: authUser.email ?? "",
        // Falls back to a derived username (never blocks account creation) for edge cases the
        // checkbox/username flow doesn't cover — e.g. a brand-new account created by clicking
        // "Continue with Google" from the login page rather than signup.
        username: requestedUsername ?? `${fallbackBase}${randomSuffix()}`,
        displayName,
        ageConfirmedAt: new Date(ageConfirmedAt),
        tosConsentedAt: new Date(tosConsentedAt),
        ...trustFields,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      // Prisma's error.meta.target isn't a reliable string[] to pattern-match on — for a named
      // constraint (e.g. the primary key "User_pkey") it can come back as a bare constraint-name
      // string instead of a column-name array, so check for the actual cause directly: does a
      // row with this id already exist (the cross-request race this whole try/catch exists for)?
      const byId = await prisma.user.findUnique({ where: { id: authUser.id } });
      if (byId) return byId;

      // Not an id collision — a genuine username collision (the pre-check missed a race, or an
      // unlucky fallback suffix). Retry once with a fresh suffix rather than failing the whole
      // sign-in, since the Supabase auth user already exists by this point.
      return prisma.user.create({
        data: {
          id: authUser.id,
          email: authUser.email ?? "",
          username: `${fallbackBase}${randomSuffix()}`,
          displayName,
          ageConfirmedAt: new Date(ageConfirmedAt),
          tosConsentedAt: new Date(tosConsentedAt),
          ...trustFields,
        },
      });
    }
    throw error;
  }
});
