import { createFileRoute } from "@tanstack/react-router";
import { ApiTokenManager } from "@/components/api-token-manager";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/settings/api-tokens")({
  component: ApiTokensSettingsPage
});

function ApiTokensSettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Organization settings"
        title="API Tokens"
        description="Manage scoped credentials."
      />
      <ApiTokenManager />
    </div>
  );
}
