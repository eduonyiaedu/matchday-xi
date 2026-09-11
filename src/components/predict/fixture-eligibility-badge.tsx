import { Badge } from "@/components/ui/badge";
import { LocalTime } from "@/components/ui/local-time";

/**
 * Shown next to a fixture that isn't currently actionable — either it's not the team's next
 * fixture yet, or it is but the 24h-before-kickoff window hasn't opened. Renders nothing (the
 * caller shows its own "Build lineup" action instead) once both conditions are satisfied.
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
    return <Badge variant="outline">Predict your next match first</Badge>;
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
