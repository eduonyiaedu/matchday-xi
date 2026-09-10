import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";

export default async function GlobalLeaderboardPage() {
  const teams = await prisma.team.findMany({
    where: { isPremierLeagueClub: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const users = await prisma.user.findMany({
    where: { favoriteTeamId: { not: null } },
    // Rulebook §9 tiebreaker: Perfect XIs, then earliest account creation.
    orderBy: [{ totalPoints: "desc" }, { perfectXiCount: "desc" }, { createdAt: "asc" }],
    take: 100,
    select: {
      id: true,
      displayName: true,
      totalPoints: true,
      perfectXiCount: true,
      favoriteTeam: { select: { name: true } },
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Global leaderboard</h1>
      <LeaderboardTable
        rows={users.map((u, i) => ({
          rank: i + 1,
          userId: u.id,
          displayName: u.displayName,
          teamName: u.favoriteTeam?.name ?? "",
          totalPoints: u.totalPoints,
          perfectXiCount: u.perfectXiCount,
        }))}
      />
      <div>
        <h2 className="mb-2 text-lg font-semibold">Browse by club</h2>
        <div className="flex flex-wrap gap-2">
          {teams.map((t) => (
            <Link
              key={t.id}
              href={`/leaderboards/team/${t.id}`}
              className="rounded-full border px-3 py-1 text-sm hover:bg-muted"
            >
              {t.name}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
