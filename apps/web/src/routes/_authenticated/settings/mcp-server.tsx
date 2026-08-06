import { createFileRoute } from "@tanstack/react-router";
import { McpServerCard } from "@/components/mcp-server-card";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/_authenticated/settings/mcp-server")({
  component: McpServerSettingsPage
});

function McpServerSettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Organization settings"
        title="MCP Server"
        description="Connect Goalkeeper to remote MCP clients."
      />
      <McpServerCard />
    </div>
  );
}
