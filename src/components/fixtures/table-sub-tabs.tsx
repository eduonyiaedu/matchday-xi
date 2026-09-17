import Link from "next/link";
import { cn } from "@/lib/utils";

/** Second-level tabs within the Table section — the league table itself, plus the two separate
 * goals/assists leaderboards, all reusing the same synced TopScorer rows (see table/page.tsx). */
export function TableSubTabs({ active }: { active: "table" | "scorers" | "assists" }) {
  const tabs = [
    { key: "table", href: "/fixtures/table", label: "Table" },
    { key: "scorers", href: "/fixtures/table/scorers", label: "Goal Scorers" },
    { key: "assists", href: "/fixtures/table/assists", label: "Assists" },
  ] as const;

  return (
    <div className="flex gap-1">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "rounded-full px-3 py-1.5 font-heading text-[11px] tracking-[0.08em] uppercase",
            active === tab.key ? "bg-club/16 text-club" : "bg-white/6 text-muted-foreground hover:text-chalk",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
