import { createFileRoute, Navigate, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/auth";
import { AppLoading } from "@/components/app-loading";
import { AppShell } from "@/components/app-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout
});

function AuthenticatedLayout() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === "loading") return <AppLoading />;
  if (auth.status === "unauthenticated") {
    return (
      <Navigate
        to="/sign-in"
        search={{ returnTo: `${location.pathname}${location.searchStr}` }}
        replace
      />
    );
  }
  if (auth.status === "error") {
    return (
      <main className="grid min-h-svh place-items-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Account unavailable</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertTitle>Session request failed</AlertTitle>
              <AlertDescription>{auth.error}</AlertDescription>
            </Alert>
            <Button variant="outline" onClick={() => void auth.refresh()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return <AppShell />;
}
