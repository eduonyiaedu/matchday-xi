import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { TeamPicker } from "@/components/team/team-picker";
import { Footer } from "@/components/layout/footer";

export default async function SelectTeamPage() {
  const user = await getOrCreateCurrentUser();
  if (!user) redirect("/login?next=/onboarding/select-team");
  if (user.favoriteTeamId) redirect("/home");

  const teams = await prisma.team.findMany({
    where: { isPremierLeagueClub: true, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, shortName: true, crestUrl: true },
  });

  return (
    <div className="flex min-h-svh flex-col">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 p-6">
        <div>
          <h1 className="text-2xl font-bold">Pick your club</h1>
          <p className="text-muted-foreground">
            One team per account. You can change your mind right up until your first prediction —
            after that it&apos;s permanent.
          </p>
        </div>
        {teams.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Club list hasn&apos;t synced yet — check back in a few minutes, or ask the admin to run
            the squad sync job.
          </p>
        ) : (
          <TeamPicker teams={teams} />
        )}
      </div>
      <Footer />
    </div>
  );
}
