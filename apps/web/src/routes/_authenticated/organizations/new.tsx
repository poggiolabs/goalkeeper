import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2Icon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { useAuth } from "@/auth";
import { createOrganization } from "@/auth-client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { apiUrl } from "@/lib/config";

export const Route = createFileRoute("/_authenticated/organizations/new")({
  component: NewOrganizationPage
});

function NewOrganizationPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await createOrganization(apiUrl, name);
      await auth.refresh();
      await navigate({ to: "/home", replace: true });
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to create organization."
      );
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Organization"
        title="New organization"
        description="Create another organization for a team or business."
      />
      <Card className="max-w-2xl">
        <CardHeader>
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2Icon className="size-5" />
          </div>
          <CardTitle>Create an organization</CardTitle>
          <CardDescription>
            You’ll become its owner and it will become your active organization.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="new-organization-name">Name</Label>
              <Input
                id="new-organization-name"
                autoFocus
                maxLength={100}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme, Inc."
                required
                value={name}
              />
            </div>
            <Button disabled={isSubmitting || name.trim().length === 0}>
              <PlusIcon />
              {isSubmitting ? "Creating…" : "Create organization"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
