import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/lib/prisma";
import { safeRedirectPath } from "@/lib/safe-redirect";
import { GoogleConsentForm } from "@/components/auth/google-consent-form";
import { Footer } from "@/components/layout/footer";

/**
 * Interstitial for a brand-new account created by clicking "Continue with Google" from the
 * *login* page rather than signup — Google OAuth doesn't distinguish the two, so this is the
 * only point before the app-level User row exists where age/ToS consent can still be collected.
 * Deliberately checks for the Supabase session directly rather than calling
 * getOrCreateCurrentUser(), which would auto-create the row with null consent timestamps.
 */
export default async function GoogleConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Validated as a same-origin relative path — reachable directly (?next=...) as well as via
  // the callback route, so it needs its own check rather than trusting the callback already did.
  const nextPath = safeRedirectPath(next);

  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) redirect("/login");

  const existing = await prisma.user.findUnique({ where: { id: authUser.id } });
  if (existing) redirect(nextPath);

  return (
    <div className="flex min-h-svh flex-col floodlight">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
        <div>
          <h1 className="font-heading text-3xl font-semibold uppercase">One last step</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick a username and confirm the two boxes below to finish setting up your account.
          </p>
        </div>
        <GoogleConsentForm next={nextPath} />
      </div>
      <Footer />
    </div>
  );
}
