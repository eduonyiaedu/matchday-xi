import { getOrCreateCurrentUser } from "@/lib/auth";
import { getLeaderboard } from "@/lib/leaderboard";
import { LeaderboardView } from "@/components/leaderboard/leaderboard-view";

export default async function GlobalLeaderboardPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  const [{ season }, viewer] = await Promise.all([searchParams, getOrCreateCurrentUser()]);
  const data = await getLeaderboard({ seasonParam: season, viewer });
  return <LeaderboardView data={data} clubValue="global" basePath="/leaderboards/global" />;
}
