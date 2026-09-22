import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { recordDailyLoginIfNeeded } from "@/lib/streaks";
import { recordSessionActivity } from "@/lib/session-tracking";
import { prisma } from "@/lib/prisma";
import { getTeamColors } from "@/lib/team-colors";
import { buildPerfectXiTakeoverPayload } from "@/lib/perfect-xi-payload";
import { AppNav } from "@/components/layout/app-nav";
import { Footer } from "@/components/layout/footer";
import { PerfectXiAutoTakeover } from "@/components/predict/perfect-xi-auto-takeover";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getOrCreateCurrentUser();
  if (!user) {
    // getOrCreateCurrentUser returns null both for "no Supabase session" and for "authenticated
    // but never finished the Google-login consent interstitial" (see its own comment). Only the
    // first case is a real logged-out visitor — the second still has a live Supabase session, so
    // send them to finish consent instead of dumping them back on the login form.
    const supabase = await createClient();
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (authUser) redirect("/auth/consent");
    redirect("/login");
  }
  if (!user.favoriteTeamId) redirect("/onboarding/select-team");

  // On the one request per UTC day this actually increments, `user.currentStreak` (fetched
  // above) is already stale — use the returned value for the nav badge, not the pre-call one.
  const currentStreak = await recordDailyLoginIfNeeded(user);
  await recordSessionActivity(user.id);

  // Global --club accent (nav highlight, focus rings via --ring, avatar, pinned leaderboard
  // row) is always the VIEWER's own favorite team — never the team a specific prediction is
  // for, since private leagues let someone predict for a club that isn't their own.
  const favoriteTeam = await prisma.team.findUniqueOrThrow({
    where: { id: user.favoriteTeamId },
    select: { externalId: true, shortName: true, name: true },
  });
  const club = getTeamColors(favoriteTeam.externalId);
  const teamInitials = (favoriteTeam.shortName ?? favoriteTeam.name).slice(0, 3).toUpperCase();

  // Whenever a user logs in or lands on any page, show their earliest still-unseen Perfect XI
  // celebration before anything else — not a button to hunt for on the specific fixture's page
  // (see perfect-xi-takeover.tsx's own comment history: it existed and animated correctly, it
  // just never surfaced automatically). One at a time, oldest first; the next unseen one (if any)
  // surfaces on a subsequent page load once this one's been marked seen.
  const unseenPerfectXi = await prisma.prediction.findFirst({
    where: { userId: user.id, isPerfectXi: true, perfectXiCelebrationShownAt: null },
    orderBy: { scoredAt: "asc" },
    select: { id: true },
  });
  const takeoverPayload = unseenPerfectXi ? await buildPerfectXiTakeoverPayload(unseenPerfectXi.id) : null;

  return (
    <div
      className="flex min-h-svh flex-col pb-24 md:pb-0"
      style={{ "--club": club.primary } as React.CSSProperties}
    >
      {takeoverPayload && <PerfectXiAutoTakeover key={takeoverPayload.predictionId} payload={takeoverPayload} />}
      <AppNav
        displayName={user.displayName}
        username={user.username}
        currentStreak={currentStreak}
        totalPoints={user.totalPoints}
        role={user.role}
        teamInitials={teamInitials}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">{children}</main>
      <Footer />
    </div>
  );
}
