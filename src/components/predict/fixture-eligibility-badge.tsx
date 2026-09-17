import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/ui/local-time";

/**
 * Shown under a fixture's date when it isn't currently actionable because the 24h-before-kickoff
 * window hasn't opened yet. Renders nothing when the fixture is locked, when it's not the team's
 * next fixture yet (the caller's own disabled button already says that, so a second badge
 * repeating it is redundant), or once the window is open and it's actionable — every gating rule
 * lives here so callers never need to re-derive "should this render" themselves and risk drifting
 * out of sync with this component's own logic.
 */
export function FixtureEligibilityBadge({
  locked,
  isNext,
  windowOpen,
  opensAt,
}: {
  locked: boolean;
  isNext: boolean;
  windowOpen: boolean;
  opensAt: Date;
}) {
  if (locked || !isNext || windowOpen) {
    return null;
  }
  return (
    <div className="mt-1.5">
      <Badge variant="outline">
        Opens <LocalTime iso={opensAt.toISOString()} />
      </Badge>
    </div>
  );
}
