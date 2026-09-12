export type Tier = "bronze" | "silver" | "gold";

const TIER_GRADIENTS: Record<Tier, string> = {
  bronze: "linear-gradient(145deg,#C6803F,#8C5122)",
  silver: "linear-gradient(145deg,#E6E8E3,#9AA39C)",
  gold: "linear-gradient(145deg,#FFF0BE,#F7C63C 55%,#D99A12)",
};

/** Perfect XI tier, straight from the already-stored perfectXiCount — no migration needed. */
export function tierFromPerfectXiCount(perfectXiCount: number): Tier | null {
  if (perfectXiCount >= 10) return "gold";
  if (perfectXiCount >= 5) return "silver";
  if (perfectXiCount >= 1) return "bronze";
  return null;
}

export function TierDisc({ tier, size = 15 }: { tier: Tier | null; size?: number }) {
  if (!tier) {
    return (
      <span
        className="inline-block shrink-0 rounded-full shadow-[inset_0_0_0_2px_rgba(245,243,236,0.18)]"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: TIER_GRADIENTS[tier] }}
    />
  );
}
