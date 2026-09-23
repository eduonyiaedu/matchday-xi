import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { ClubFilterSelect } from "@/components/leaderboard/club-filter-select";
import { RanksTabs } from "@/components/leaderboard/ranks-tabs";
import { computeGlobalRank } from "@/lib/rank";

export default async function TeamLeaderboardPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;

  const [team, teams, users, viewer] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId } }),
    prisma.team.findMany({
      where: { isPremierLeagueClub: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { favoriteTeamId: teamId },
      orderBy: [{ totalPoints: "desc" }, { perfectXiCount: "desc" }, { createdAt: "asc" }],
      take: 100,
      select: { id: true, displayName: true, username: true, totalPoints: true, perfectXiCount: true },
    }),
    getCurrentUser(),
  ]);
  if (!team) notFound();

  const myRank = viewer?.favoriteTeamId === teamId ? await computeGlobalRank(viewer, teamId) : null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold uppercase">Ranks</h1>
      <RanksTabs active="leaderboard" />
      <ClubFilterSelect value={teamId} teams={teams} />
      <LeaderboardTable
        rows={users.map((u, i) => ({
          rank: i + 1,
          userId: u.id,
          displayName: u.displayName,
          username: u.username,
          teamExternalId: team.externalId,
          totalPoints: u.totalPoints,
          perfectXiCount: u.perfectXiCount,
        }))}
      />
      {viewer && myRank && (
        <div className="sticky bottom-2">
          <p className="mb-1.5 px-1 font-mono text-[9px] tracking-[0.16em] text-club uppercase">You</p>
          <LeaderboardTable
            pinnedTop
            rows={[
              {
                rank: myRank,
                userId: viewer.id,
                displayName: viewer.displayName,
                username: viewer.username,
                teamExternalId: team.externalId,
                totalPoints: viewer.totalPoints,
                perfectXiCount: viewer.perfectXiCount,
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
