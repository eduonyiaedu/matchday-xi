import Link from "next/link";
import { UNDERLINE_TAB_BAR, underlineTabClass } from "@/components/ui/underline-tabs";

/** Shared sub-nav for the two fixtures views — history lives under fixtures rather than its own
 * top-level tab, so this is the only thing distinguishing the two pages' headers. */
export function FixturesTabs({ active }: { active: "upcoming" | "history" | "table" }) {
  const tabs = [
    { key: "table", href: "/fixtures/table", label: "Table" },
    { key: "upcoming", href: "/fixtures", label: "Upcoming" },
    { key: "history", href: "/fixtures/history", label: "History" },
  ] as const;

  return (
    <div className={UNDERLINE_TAB_BAR}>
      {tabs.map((tab) => (
        <Link key={tab.key} href={tab.href} className={underlineTabClass(active === tab.key)}>
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
