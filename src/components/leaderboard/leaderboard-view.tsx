import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table";
import { ClubFilterSelect, SeasonSelect } from "@/components/leaderboard/club-filter-select";
import { RanksTabs } from "@/components/leaderboard/ranks-tabs";
import type { getLeaderboard } from "@/lib/leaderboard";

/** Shared layout for the global and per-club leaderboards (same list, filtered). */
export function LeaderboardView({
  data,
  clubValue,
  basePath,
}: {
  data: Awaited<ReturnType<typeof getLeaderboard>>;
  clubValue: string;
  basePath: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold uppercase">Ranks</h1>
      <RanksTabs active="leaderboard" />
      <div className="flex flex-col gap-2 sm:flex-row">
        <ClubFilterSelect value={clubValue} teams={data.teams} season={data.isPast ? (data.selectedSeason ?? undefined) : undefined} />
        {data.seasonLabels.length > 0 && data.selectedSeason && (
          <SeasonSelect value={data.selectedSeason} seasons={data.seasonLabels} basePath={basePath} />
        )}
      </div>
      {data.isPast && (
        <p className="text-xs text-muted-foreground">
          Final standings for the {data.selectedSeason} season — points scored in that season only.
        </p>
      )}
      {data.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No scores for this season yet.</p>
      ) : (
        <LeaderboardTable rows={data.rows} />
      )}
      {data.viewerRow && (
        <div className="sticky bottom-2">
          <p className="mb-1.5 px-1 font-mono text-[9px] tracking-[0.16em] text-club uppercase">You</p>
          <LeaderboardTable pinnedTop rows={[data.viewerRow]} />
        </div>
      )}
    </div>
  );
}
