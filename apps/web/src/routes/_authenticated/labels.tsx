import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/auth";
import { LabelsPane } from "@/components/labels-pane";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { apiUrl } from "@/lib/config";
import {
  listGoalLabels,
  listGoals,
  type Goal,
  type GoalLabel
} from "@/lib/goals-client";

export const Route = createFileRoute("/_authenticated/labels")({
  component: LabelsPage
});

function LabelsPage() {
  const auth = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [labels, setLabels] = useState<GoalLabel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void Promise.all([
      listGoals(apiUrl, controller.signal),
      listGoalLabels(apiUrl, controller.signal)
    ])
      .then(([nextGoals, nextLabels]) => {
        setGoals(nextGoals);
        setLabels(nextLabels);
        setLoading(false);
      })
      .catch((reason) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : "Unable to load labels.");
        setLoading(false);
      });
    return () => controller.abort();
  }, [auth.session?.activeOrganizationId]);

  return (
    <div className="space-y-6">
      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {loading ? (
        <div className="space-y-3" aria-label="Loading labels">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      ) : (
        <LabelsPane
          labels={labels}
          goals={goals}
          onLabelsChange={setLabels}
          onError={setError}
        />
      )}
    </div>
  );
}
