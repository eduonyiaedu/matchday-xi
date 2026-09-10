import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { recordDailyLoginIfNeeded } from "@/lib/streaks";
import { AppNav } from "@/components/layout/app-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login");
  if (!user.favoriteTeamId) redirect("/onboarding/select-team");

  await recordDailyLoginIfNeeded(user);

  return (
    <div className="flex min-h-svh flex-col">
      <AppNav
        displayName={user.displayName}
        currentStreak={user.currentStreak}
        totalPoints={user.totalPoints}
        role={user.role}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 p-4">{children}</main>
    </div>
  );
}
