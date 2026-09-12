import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { ClubFilterSelect } from "@/components/leaderboard/club-filter-select";
import { computeGlobalRank } from "@/lib/rank";

export default async function GlobalLeaderboardPage() {
  const [teams, users, viewer] = await Promise.all([
    prisma.team.findMany({
      where: { isPremierLeagueClub: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { favoriteTeamId: { not: null } },
      // Rulebook §9 tiebreaker: Perfect XIs, then earliest account creation.
      orderBy: [{ totalPoints: "desc" }, { perfectXiCount: "desc" }, { createdAt: "asc" }],
      take: 100,
      select: {
        id: true,
        displayName: true,
        username: true,
        totalPoints: true,
        perfectXiCount: true,
        favoriteTeam: { select: { name: true, externalId: true } },
      },
    }),
    getCurrentUser(),
  ]);

  const [myRank, viewerTeam] = viewer?.favoriteTeamId
    ? await Promise.all([
        computeGlobalRank(viewer),
        prisma.team.findUnique({ where: { id: viewer.favoriteTeamId }, select: { externalId: true } }),
      ])
    : [null, null];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold uppercase">Leaderboard</h1>
      <ClubFilterSelect value="global" teams={teams} />
      <LeaderboardTable
        rows={users.map((u, i) => ({
          rank: i + 1,
          userId: u.id,
          displayName: u.displayName,
          username: u.username,
          teamExternalId: u.favoriteTeam?.externalId ?? 0,
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
                teamExternalId: viewerTeam?.externalId ?? 0,
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
