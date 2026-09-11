import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";

/** Returns the app's User row for the currently authenticated Supabase session, or null. */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  return prisma.user.findUnique({ where: { id: authUser.id } });
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
 */
export const getOrCreateCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  // Signup consent timestamps (see AuthForm) ride along as Supabase user_metadata — set directly
  // in options.data for password/magic-link signup, or via updateUser() in the OAuth callback
  // route for Google signup — and land here only once, at profile-row creation.
  const ageConfirmedAt = authUser.user_metadata?.ageConfirmedAt as string | undefined;
  const tosConsentedAt = authUser.user_metadata?.tosConsentedAt as string | undefined;

  try {
    return await prisma.user.upsert({
      where: { id: authUser.id },
      update: {},
      create: {
        id: authUser.id,
        email: authUser.email ?? "",
        displayName:
          (authUser.user_metadata?.full_name as string | undefined) ??
          authUser.email?.split("@")[0] ??
          "Player",
        ageConfirmedAt: ageConfirmedAt ? new Date(ageConfirmedAt) : null,
        tosConsentedAt: tosConsentedAt ? new Date(tosConsentedAt) : null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.user.findUniqueOrThrow({ where: { id: authUser.id } });
    }
    throw error;
  }
});
