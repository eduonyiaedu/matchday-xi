import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

export interface ScorerRow {
  id: string;
  playerName: string;
  goals: number;
  assists: number;
  teamId: string | null;
  team: { name: string; shortName: string | null } | null;
}

/** Shared table for both the goal-scorers and assists views — same underlying synced rows
 * (there's no separate free-tier endpoint for assists — see the sync's own comment), just sorted
 * and bolded differently depending on which stat the page is about. */
export function ScorerList({
  rows,
  emphasize,
  favoriteTeamId,
}: {
  rows: ScorerRow[];
  emphasize: "goals" | "assists";
  favoriteTeamId: string | null;
}) {
  if (rows.length === 0) {
    return <p className="px-6 py-7 text-center text-sm text-muted-foreground">Not synced yet — check back soon.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8">#</TableHead>
          <TableHead>Player</TableHead>
          <TableHead>Club</TableHead>
          <TableHead className="text-right">{emphasize === "goals" ? "Goals" : "Assists"}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => (
          <TableRow key={row.id} className={cn(favoriteTeamId !== null && row.teamId === favoriteTeamId && "bg-club/10")}>
            <TableCell className="font-mono text-xs text-muted-foreground">{i + 1}</TableCell>
            <TableCell className="font-medium">{row.playerName}</TableCell>
            <TableCell className="text-muted-foreground">{row.team?.shortName ?? row.team?.name ?? ""}</TableCell>
            <TableCell className="text-right font-mono text-sm font-bold">
              {emphasize === "goals" ? row.goals : row.assists}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
