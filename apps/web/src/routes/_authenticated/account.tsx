import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/account")({
  component: AccountRedirect
});

function AccountRedirect() {
  return <Navigate to="/settings/profile" replace />;
}
