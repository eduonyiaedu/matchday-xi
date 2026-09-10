import { redirect } from "next/navigation";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CreateLeagueForm } from "@/components/leagues/create-league-form";

export default async function CreateLeaguePage() {
  const user = await getOrCreateCurrentUser();
  if (!user) return null;

  const existing = await prisma.privateLeague.findFirst({ where: { creatorId: user.id } });
  if (existing) redirect(`/leagues/${existing.id}`);

  const teams = await prisma.team.findMany({
    where: { isPremierLeagueClub: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Create your private league</h1>
        <p className="text-sm text-muted-foreground">
          You get exactly one. Rules are locked in the moment you create it — members will always
          be able to see them.
        </p>
      </div>
      <CreateLeagueForm teams={teams} />
    </div>
  );
}
