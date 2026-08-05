import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/auth";
import { AppLoading } from "@/components/app-loading";

type IndexSearch = {
  returnTo?: string;
  verified?: string;
};

export const Route = createFileRoute("/")({
  validateSearch: validateAuthSearch,
  component: IndexPage
});

function IndexPage() {
  const auth = useAuth();
  const search = Route.useSearch();

  if (auth.status === "loading") return <AppLoading />;
  if (auth.status === "authenticated") return <Navigate to="/home" replace />;
  return <Navigate to="/sign-in" search={search} replace />;
}

function validateAuthSearch(search: Record<string, unknown>): IndexSearch {
  return {
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
    verified: typeof search.verified === "string" ? search.verified : undefined
  };
}
