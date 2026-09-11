import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Handles the redirect back from a magic-link email or an OAuth (Google) sign-in. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next") ?? "/fixtures";
  // Only present when this leg started from the signup screen's Google button — see
  // AuthForm.handleGoogle, which can't attach user_metadata to the outbound OAuth request itself.
  const ageConsent = request.nextUrl.searchParams.get("ageConsent");
  const tosConsent = request.nextUrl.searchParams.get("tosConsent");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      if (ageConsent && tosConsent) {
        await supabase.auth.updateUser({
          data: { ageConfirmedAt: ageConsent, tosConsentedAt: tosConsent },
        });
      }
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", request.url));
}
