import Link from "next/link";
import { UNDERLINE_TAB_BAR, underlineTabClass } from "@/components/ui/underline-tabs";

/** Sub-nav for the "Ranks" section — prizes live here beside the leaderboard, not as their own
 * bottom-bar tab. */
export function RanksTabs({ active }: { active: "leaderboard" | "prizes" }) {
  const tabs = [
    { key: "leaderboard", href: "/leaderboards/global", label: "Leaderboard" },
    { key: "prizes", href: "/prizes", label: "Prizes" },
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
