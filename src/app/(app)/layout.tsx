import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { recordDailyLoginIfNeeded } from "@/lib/streaks";
import { recordSessionActivity } from "@/lib/session-tracking";
import { prisma } from "@/lib/prisma";
import { getTeamColors } from "@/lib/team-colors";
import { AppNav } from "@/components/layout/app-nav";
import { Footer } from "@/components/layout/footer";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (!user.favoriteTeamId) redirect("/onboarding/select-team");

  await recordDailyLoginIfNeeded(user);
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

  return (
    <div
      className="flex min-h-svh flex-col"
      style={{ "--club": club.primary } as React.CSSProperties}
    >
      <AppNav
        displayName={user.displayName}
        username={user.username}
        currentStreak={user.currentStreak}
        totalPoints={user.totalPoints}
        role={user.role}
        teamInitials={teamInitials}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 pb-24 md:pb-4">{children}</main>
      <Footer />
    </div>
  );
}
