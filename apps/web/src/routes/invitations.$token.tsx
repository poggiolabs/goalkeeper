import { useEffect, useRef, useState } from "react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/auth";
import { acceptOrganizationInvitation } from "@/auth-client";
import { AppLoading } from "@/components/app-loading";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { apiUrl } from "@/lib/config";

export const Route = createFileRoute("/invitations/$token")({
  component: AcceptInvitationPage
});

/**
 * Acceptance is deliberately a web route rather than an API redirect. The
 * email provider's beginLogin returns its returnTo unchanged, so pointing an
 * API redirect back at itself would loop instead of rendering a sign-in form.
 * Sending an unauthenticated visitor to /sign-in?returnTo=… works for both
 * providers, and keeps the token out of any URL the API signs.
 */
function AcceptInvitationPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { token } = Route.useParams();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (auth.status !== "authenticated" || attempted.current) return;
    attempted.current = true;
    void acceptOrganizationInvitation(apiUrl, token)
      .then(async () => {
        // The session's organization list and active organization both
        // changed, so refresh before landing on the dashboard.
        await auth.refresh();
        await navigate({ to: "/home", replace: true });
      })
      .catch((reason) => {
        setError(
          reason instanceof Error
            ? reason.message
            : "This invitation could not be accepted."
        );
      });
  }, [auth, navigate, token]);

  if (auth.status === "loading") return <AppLoading />;

  if (auth.status !== "authenticated") {
    return (
      <Navigate
        to="/sign-in"
        search={{ returnTo: `/invitations/${token}` }}
        replace
      />
    );
  }

  if (error) {
    return (
      <div className="mx-auto flex min-h-svh max-w-md items-center p-6">
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Invitation unavailable</CardTitle>
            <CardDescription>
              It may have expired, been revoked, already been used, or been sent
              to a different email address.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
            <Button onClick={() => void navigate({ to: "/home" })}>
              Continue to Goalkeeper
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <AppLoading />;
}
