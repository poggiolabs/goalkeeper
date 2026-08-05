import { createFileRoute } from "@tanstack/react-router";
import { PlusIcon, TargetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/goals")({
  component: GoalsPage
});

function GoalsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Goals"
        description="Define the outcomes your people and agents should work toward."
      />
      <Card className="max-w-3xl border-dashed bg-card/70">
        <CardHeader className="items-center text-center">
          <div className="mb-3 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
            <TargetIcon className="size-5" />
          </div>
          <CardTitle>No goals yet</CardTitle>
          <CardDescription>
            Goal creation and progress tracking will be implemented here.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center">
          <Button disabled>
            <PlusIcon />
            New goal
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
