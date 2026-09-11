import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  username: string;
  teamName?: string;
  totalPoints: number;
  perfectXiCount: number;
}

export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-12">#</TableHead>
          <TableHead>Player</TableHead>
          {rows[0]?.teamName !== undefined && <TableHead>Club</TableHead>}
          <TableHead className="text-right">Perfect XIs</TableHead>
          <TableHead className="text-right">Points</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.userId}>
            <TableCell className="font-medium">{row.rank}</TableCell>
            <TableCell>
              {row.displayName} <span className="text-muted-foreground">@{row.username}</span>
            </TableCell>
            {row.teamName !== undefined && <TableCell>{row.teamName}</TableCell>}
            <TableCell className="text-right">{row.perfectXiCount}</TableCell>
            <TableCell className="text-right font-semibold">{row.totalPoints}</TableCell>
          </TableRow>
        ))}
        {rows.length === 0 && (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              No players yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
