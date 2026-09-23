"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// One shared list/table component, one dropdown above it — global and per-club are the same
// list filtered, matching the design's "keep both routes, the dropdown just navigates" spec.
// A past season picked in the season dropdown is carried across when switching club.
export function ClubFilterSelect({
  value,
  teams,
  season,
}: {
  value: "global" | string;
  teams: { id: string; name: string }[];
  /** The selected past season's label, or undefined for the current season. */
  season?: string;
}) {
  const router = useRouter();
  const query = season ? `?season=${encodeURIComponent(season)}` : "";

  return (
    <Select
      value={value}
      onValueChange={(next) => router.push(`${next === "global" ? "/leaderboards/global" : `/leaderboards/team/${next}`}${query}`)}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="global">Global</SelectItem>
        {teams.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.name} fans
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Picks which season's leaderboard to show — the current season, or any past one. */
export function SeasonSelect({
  value,
  seasons,
  basePath,
}: {
  value: string;
  /** Newest first; the first is the current season. */
  seasons: string[];
  basePath: string;
}) {
  const router = useRouter();
  return (
    <Select
      value={value}
      onValueChange={(next) => router.push(next === seasons[0] ? basePath : `${basePath}?season=${encodeURIComponent(next)}`)}
    >
      <SelectTrigger className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {seasons.map((label, i) => (
          <SelectItem key={label} value={label}>
            {label} season{i === 0 ? " (current)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
