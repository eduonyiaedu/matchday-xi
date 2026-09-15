import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/ui/local-time";

/**
 * Shown next to a fixture that isn't currently actionable because the 24h-before-kickoff window
 * hasn't opened yet. Renders nothing when it's not the team's next fixture yet either — the
 * caller's own disabled button ("Not yet your next match") already says that, so a second badge
 * repeating it is redundant — or once both conditions are satisfied and it's actionable.
 */
export function FixtureEligibilityBadge({
  isNext,
  windowOpen,
  opensAt,
}: {
  isNext: boolean;
  windowOpen: boolean;
  opensAt: Date;
}) {
  if (!isNext) {
    return null;
  }
  if (!windowOpen) {
    return (
      <Badge variant="outline">
        Opens <LocalTime iso={opensAt.toISOString()} />
      </Badge>
    );
  }
  return null;
}
