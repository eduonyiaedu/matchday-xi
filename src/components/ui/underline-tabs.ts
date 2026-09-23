import { cn } from "@/lib/utils";

/**
 * The one underline-tab look used for every in-page section switcher (Fixtures, Ranks, a private
 * league's Fixtures/History) — shared so they can't drift apart visually.
 */
export const UNDERLINE_TAB_BAR = "flex gap-1 border-b border-white/8";

export function underlineTabClass(active: boolean) {
  return cn(
    "border-b-2 px-3 py-2 font-heading text-xs tracking-[0.1em] uppercase",
    active ? "border-club text-club" : "border-transparent text-muted-foreground hover:text-chalk",
  );
}
