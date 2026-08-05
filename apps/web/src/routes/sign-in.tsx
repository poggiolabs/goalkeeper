import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/auth";
import { AppLoading } from "@/components/app-loading";
import { AuthPage } from "@/components/auth-page";

type SignInSearch = {
  returnTo?: string;
  verified?: string;
};

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
    verified: typeof search.verified === "string" ? search.verified : undefined
  }),
  component: SignInPage
});

function SignInPage() {
  const auth = useAuth();
  const search = Route.useSearch();

  if (auth.status === "loading") return <AppLoading />;
  if (auth.status === "authenticated") return <Navigate to="/home" replace />;
  return (
    <AuthPage
      requestedReturnTo={search.returnTo}
      verified={search.verified}
    />
  );
}
