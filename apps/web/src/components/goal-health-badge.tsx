import { Badge } from "@/components/ui/badge";
import type { GoalHealth } from "@/lib/goals-client";

const labels: Record<GoalHealth, string> = {
  on_track: "Health: On track",
  at_risk: "Health: At risk",
  off_track: "Health: Off track"
};

const classes: Record<GoalHealth, string> = {
  on_track:
    "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  at_risk:
    "border-amber-600/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  off_track: "border-destructive/30 bg-destructive/10 text-destructive"
};

export function GoalHealthBadge({ health }: { health: GoalHealth | null }) {
  return (
    <Badge
      variant="outline"
      className={health === null ? "text-muted-foreground" : classes[health]}
    >
      {health === null ? "Health: Not reported" : labels[health]}
    </Badge>
  );
}
