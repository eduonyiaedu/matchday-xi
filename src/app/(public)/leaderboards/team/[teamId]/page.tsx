import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";

export default async function TeamLeaderboardPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const team = await prisma.team.findUnique({ where: { id: teamId } });
  if (!team) notFound();

  const users = await prisma.user.findMany({
    where: { favoriteTeamId: teamId },
    orderBy: [{ totalPoints: "desc" }, { perfectXiCount: "desc" }, { createdAt: "asc" }],
    take: 100,
    select: { id: true, displayName: true, totalPoints: true, perfectXiCount: true },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{team.name} fans leaderboard</h1>
      <LeaderboardTable
        rows={users.map((u, i) => ({
          rank: i + 1,
          userId: u.id,
          displayName: u.displayName,
          totalPoints: u.totalPoints,
          perfectXiCount: u.perfectXiCount,
        }))}
      />
    </div>
  );
}
