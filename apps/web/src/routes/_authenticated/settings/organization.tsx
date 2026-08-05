import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Building2Icon } from "lucide-react";
import { useAuth } from "@/auth";
import { updateOrganizationName } from "@/auth-client";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiUrl } from "@/lib/config";

export const Route = createFileRoute("/_authenticated/settings/organization")({
  component: OrganizationSettingsPage
});

function OrganizationSettingsPage() {
  const auth = useAuth();
  const organization = auth.session?.organizations.find(
    ({ id }) => id === auth.session?.activeOrganizationId
  );
  const [name, setName] = useState(organization?.name ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const canAdminister =
    organization?.role === "owner" || organization?.role === "admin";

  useEffect(() => {
    setName(organization?.name ?? "");
    setMessage(null);
  }, [organization?.id, organization?.name]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedName = name.trim();
    if (
      !canAdminister ||
      !normalizedName ||
      normalizedName === organization?.name
    ) {
      return;
    }
    setIsSaving(true);
    setMessage(null);
    try {
      await updateOrganizationName(apiUrl, normalizedName);
      await auth.refresh();
      setMessage({ kind: "success", text: "Organization name updated." });
    } catch (reason) {
      setMessage({
        kind: "error",
        text:
          reason instanceof Error
            ? reason.message
            : "Unable to update organization."
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Organization settings"
        title="Organization"
        description="Manage shared configuration for the active organization."
      />
      <form onSubmit={handleSubmit}>
        <Card className="max-w-2xl">
          <CardHeader>
            <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Building2Icon className="size-4" />
            </div>
            <CardTitle>Organization details</CardTitle>
            <CardDescription>
              Owners and administrators can update the organization name.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {message ? (
              <Alert
                variant={message.kind === "error" ? "destructive" : "default"}
              >
                <AlertDescription>{message.text}</AlertDescription>
              </Alert>
            ) : null}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="organization-name">Name</Label>
                <Badge variant="secondary" className="capitalize">
                  {organization?.role ?? "member"}
                </Badge>
              </div>
              <Input
                id="organization-name"
                value={name}
                maxLength={100}
                disabled={!canAdminister || isSaving}
                onChange={(event) => setName(event.target.value)}
              />
              {!canAdminister ? (
                <p className="text-xs text-muted-foreground">
                  Ask an organization administrator to change this name.
                </p>
              ) : null}
            </div>
          </CardContent>
          {canAdminister ? (
            <CardFooter className="justify-end border-t">
              <Button
                type="submit"
                disabled={
                  isSaving ||
                  !name.trim() ||
                  name.trim() === organization?.name
                }
              >
                {isSaving ? "Saving…" : "Save changes"}
              </Button>
            </CardFooter>
          ) : null}
        </Card>
      </form>
    </div>
  );
}
