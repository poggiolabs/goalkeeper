import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRightIcon, TargetIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/home")({
  component: HomePage
});

function HomePage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Home"
        description="Review your organization and continue to your goals."
      />
      <Card className="max-w-3xl border-dashed bg-card/70">
        <CardHeader>
          <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <TargetIcon className="size-5" />
          </div>
          <CardTitle>Your organization is ready</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link to="/goals">
                Open goals <ArrowRightIcon />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/settings/mcp-server">
                Connect your agents <ArrowRightIcon />
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/settings/team">
                Invite your team <ArrowRightIcon />
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
