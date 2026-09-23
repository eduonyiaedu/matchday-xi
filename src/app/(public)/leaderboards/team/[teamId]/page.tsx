import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getOrCreateCurrentUser } from "@/lib/auth";
import { getLeaderboard } from "@/lib/leaderboard";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";

export default async function TeamLeaderboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ teamId: string }>;
  searchParams: Promise<{ season?: string }>;
}) {
  const [{ teamId }, { season }, viewer] = await Promise.all([params, searchParams, getOrCreateCurrentUser()]);
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { id: true } });
  if (!team) notFound();

  const data = await getLeaderboard({ teamId, seasonParam: season, viewer });
  return <LeaderboardView data={data} clubValue={teamId} basePath={`/leaderboards/team/${teamId}`} />;
}
