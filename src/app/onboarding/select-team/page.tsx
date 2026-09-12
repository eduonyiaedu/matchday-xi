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
    select: { id: true, name: true, shortName: true, crestUrl: true, externalId: true },
  });

  return (
    <div className="flex min-h-svh flex-col floodlight">
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 p-6">
        <div>
          <p className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase">Step 2 of 2</p>
          <h1 className="mt-2 font-heading text-3xl font-semibold uppercase">Pick your club</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This sets the team you predict every week — and colours the whole app.{" "}
            <span className="text-gold">You can change it until your first prediction locks.</span>
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
