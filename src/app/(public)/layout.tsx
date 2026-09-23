import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getTeamColors } from "@/lib/team-colors";
import { Button } from "@/components/ui/button";
import { AppNav } from "@/components/layout/app-nav";
import { Footer } from "@/components/layout/footer";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();

  // Signed-in users get the normal app shell here too. The leaderboard is public (so logged-out
  // visitors can see it) but it's also the "Ranks" tab in the app's bottom bar — without this,
  // tapping Ranks, or switching between its Leaderboard and Prizes tabs, made the bar vanish.
  // Deliberately lighter than (app)/layout.tsx: no streak/session recording or Perfect XI
  // takeover here, since those belong to the app proper.
  if (user?.favoriteTeamId) {
    const favoriteTeam = await prisma.team.findUnique({
      where: { id: user.favoriteTeamId },
      select: { externalId: true, shortName: true, name: true },
    });
    if (favoriteTeam) {
      const club = getTeamColors(favoriteTeam.externalId);
      return (
        <div
          className="flex min-h-svh flex-col pb-24 md:pb-0"
          style={{ "--club": club.primary } as React.CSSProperties}
        >
          <AppNav
            displayName={user.displayName}
            username={user.username}
            currentStreak={user.currentStreak}
            totalPoints={user.totalPoints}
            role={user.role}
            teamInitials={(favoriteTeam.shortName ?? favoriteTeam.name).slice(0, 3).toUpperCase()}
          />
          <main className="mx-auto w-full max-w-5xl flex-1 p-4">{children}</main>
          <Footer />
        </div>
      );
    }
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between p-4">
          <Link href="/" className="text-lg font-bold">
            Matchday XI
          </Link>
          <Button variant="outline" size="sm" asChild>
            <Link href={user ? "/home" : "/login"}>{user ? "Open app" : "Log in"}</Link>
          </Button>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">{children}</main>
      <Footer />
    </div>
  );
}
