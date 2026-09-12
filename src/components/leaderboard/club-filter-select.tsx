"use client";

import { useRouter } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// One shared list/table component, one dropdown above it — global and per-club are the same
// list filtered, matching the design's "keep both routes, the dropdown just navigates" spec.
export function ClubFilterSelect({
  value,
  teams,
}: {
  value: "global" | string;
  teams: { id: string; name: string }[];
}) {
  const router = useRouter();

  return (
    <Select
      value={value}
      onValueChange={(next) => router.push(next === "global" ? "/leaderboards/global" : `/leaderboards/team/${next}`)}
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
