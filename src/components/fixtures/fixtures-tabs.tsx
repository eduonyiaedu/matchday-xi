import Link from "next/link";
import { cn } from "@/lib/utils";

/** Shared sub-nav for the two fixtures views — history lives under fixtures rather than its own
 * top-level tab, so this is the only thing distinguishing the two pages' headers. */
export function FixturesTabs({ active }: { active: "upcoming" | "history" | "table" }) {
  const tabs = [
    { key: "table", href: "/fixtures/table", label: "Table" },
    { key: "upcoming", href: "/fixtures", label: "Upcoming" },
    { key: "history", href: "/fixtures/history", label: "History" },
  ] as const;

  return (
    <div className="flex gap-1 border-b border-white/8">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          className={cn(
            "border-b-2 px-3 py-2 font-heading text-xs tracking-[0.1em] uppercase",
            active === tab.key ? "border-club text-club" : "border-transparent text-muted-foreground hover:text-chalk",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
