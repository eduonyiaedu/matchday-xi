import { getTeamColors } from "@/lib/team-colors";
import { TierDisc, tierFromPerfectXiCount } from "@/components/leaderboard/tier-disc";
import { cn } from "@/lib/utils";

export interface LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  username: string;
  teamExternalId: number;
  totalPoints: number;
  perfectXiCount: number;
}

function Crest({ externalId, size = 26 }: { externalId: number; size?: number }) {
  const colors = getTeamColors(externalId);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-heading font-bold"
      style={{ width: size, height: size, backgroundColor: colors.primary, color: colors.secondary, fontSize: size * 0.34 }}
    />
  );
}

export function LeaderboardTable({ rows, pinnedTop = false }: { rows: LeaderboardRow[]; pinnedTop?: boolean }) {
  if (rows.length === 0) {
    return <p className="p-4 text-center text-sm text-muted-foreground">No players yet.</p>;
  }
  return (
    <div className="flex flex-col">
      {!pinnedTop && (
        <div className="flex items-center gap-2.5 px-2 pb-2">
          <span className="w-8.5 font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">Rank</span>
          <span className="flex-1 font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">Player</span>
          <span className="font-mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">Pts</span>
        </div>
      )}
      {rows.map((row) => {
        const tier = tierFromPerfectXiCount(row.perfectXiCount);
        const top3 = row.rank <= 3;
        return (
          <div
            key={row.userId}
            className={cn(
              "flex items-center gap-2.5 border-t border-white/7 px-2 py-2.5 first:border-t-0",
              pinnedTop && "rounded-[12px] border-t-0 bg-pitch-light px-3 shadow-[inset_0_0_0_1px_rgba(245,243,236,0.08)]",
            )}
          >
            <span
              className={cn(
                "w-8.5 shrink-0 rounded-md py-1 text-center font-mono text-xs font-bold",
                top3 ? "bg-gold/16 text-gold" : "bg-white/7 text-muted-foreground",
              )}
            >
              {row.rank}
            </span>
            <Crest externalId={row.teamExternalId} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium">{row.displayName}</p>
              <p className="truncate font-mono text-[9.5px] text-muted-foreground">
                @{row.username} · {row.perfectXiCount} PERFECT XI
              </p>
            </div>
            <TierDisc tier={tier} />
            <span className="w-11 text-right font-mono text-[17px] font-bold">{row.totalPoints}</span>
          </div>
        );
      })}
    </div>
  );
}
