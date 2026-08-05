import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/settings/personal")({
  component: PersonalSettingsRedirect
});

function PersonalSettingsRedirect() {
  return <Navigate to="/settings/profile" replace />;
}
