import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

/** Handles the redirect back from a magic-link email or an OAuth (Google) sign-in. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") ?? "/home";
  // Only present when this leg started from the signup screen's Google button — see
  // AuthForm.handleGoogle, which can't attach user_metadata to the outbound OAuth request itself.
  const ageConsent = request.nextUrl.searchParams.get("ageConsent");
  const tosConsent = request.nextUrl.searchParams.get("tosConsent");
  const username = request.nextUrl.searchParams.get("username");

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (ageConsent && tosConsent) {
        await supabase.auth.updateUser({
          data: { ageConfirmedAt: ageConsent, tosConsentedAt: tosConsent, ...(username ? { username } : {}) },
        });
        return NextResponse.redirect(new URL(next, request.url));
      }

      // No consent rode along — either a returning user's Google login (fine, they already
      // consented at signup) or a brand-new account created by clicking "Continue with Google"
      // from the *login* page rather than signup, which never collects consent at all. Only the
      // second case needs to stop here: check whether the app-level User row already exists
      // before letting the (app) layout's own getOrCreateCurrentUser auto-create one with null
      // consent timestamps.
      const existingUser = data.user ? await prisma.user.findUnique({ where: { id: data.user.id } }) : null;
      if (!existingUser) {
        const consentUrl = new URL("/auth/consent", request.url);
        consentUrl.searchParams.set("next", next);
        return NextResponse.redirect(consentUrl);
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}
