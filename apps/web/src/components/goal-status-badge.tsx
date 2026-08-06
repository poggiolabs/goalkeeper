import { Badge } from "@/components/ui/badge";
import type { GoalStatus } from "@/lib/goals-client";

const labels: Record<GoalStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived"
};

export function GoalStatusBadge({ status }: { status: GoalStatus }) {
  return (
    <Badge variant={status === "active" ? "default" : "secondary"}>
      {labels[status]}
    </Badge>
  );
}
