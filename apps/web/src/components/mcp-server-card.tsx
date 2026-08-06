import {
  CopyIcon,
  ExternalLinkIcon,
  ShieldCheckIcon
} from "lucide-react";
import { McpLogo } from "@/components/mcp-logo";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { mcpUrl } from "@/lib/config";

const claudeConnectorGuide =
  "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp";

export function McpServerCard() {
  const isPublicHttps = new URL(mcpUrl).protocol === "https:";

  async function copyServerUrl() {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      toast.success("MCP server URL copied");
    } catch {
      toast.error("Unable to copy MCP server URL");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <McpLogo />
        </div>
        <CardTitle>MCP server</CardTitle>
        <CardDescription>
          Connect Goalkeeper to remote MCP clients such as Claude and Cowork.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">Server URL</p>
            <Badge variant={isPublicHttps ? "secondary" : "outline"}>
              {isPublicHttps ? "Remote" : "Local development"}
            </Badge>
          </div>
          <div className="flex items-stretch gap-2">
            <code
              id="mcp-server-url"
              className="flex min-w-0 flex-1 items-center overflow-x-auto rounded-md border bg-muted/50 px-3 py-2 text-xs"
            >
              {mcpUrl}
            </code>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Copy MCP server URL"
              onClick={() => void copyServerUrl()}
            >
              <CopyIcon />
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            Goalkeeper uses remote MCP over Streamable HTTP. Cloud-hosted
            clients connect from their own infrastructure, so the production
            URL must be publicly reachable over HTTPS.
          </p>
        </section>

        <Alert>
          <ShieldCheckIcon />
          <AlertTitle>OAuth consent is not enabled yet</AlertTitle>
          <AlertDescription>
            Claude and Cowork cannot finish connecting until Goalkeeper’s OAuth
            authorization flow is deployed. That flow will ask each user to
            select one organization and approve either Read or Read and write
            access for the client.
          </AlertDescription>
        </Alert>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Connect Claude or Cowork</h3>
            <a
              href={claudeConnectorGuide}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              Claude connector guide
              <ExternalLinkIcon className="size-3" />
            </a>
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
            <li>
              Open <strong className="text-foreground">Customize → Connectors</strong>.
              Team and Enterprise owners first register it under organization
              connector settings.
            </li>
            <li>
              Add a custom connector and paste the server URL above. Leave
              advanced OAuth credentials empty unless an administrator supplied
              registered client credentials.
            </li>
            <li>
              Select Connect. Goalkeeper will open in the browser to sign in,
              choose an organization, and approve the requested access.
            </li>
            <li>Enable the Goalkeeper connector for the conversation.</li>
          </ol>
        </section>

        <section className="space-y-2 rounded-lg border bg-muted/30 p-4">
          <h3 className="text-sm font-medium">API-token clients</h3>
          <p className="text-sm leading-6 text-muted-foreground">
            Clients that support a custom bearer token can connect today. Create
            a token above and send it as <code>Authorization: Bearer …</code>.
            For read-only access grant <code>goals:read</code> and{" "}
            <code>labels:read</code>; add <code>goals:write</code> and{" "}
            <code>labels:write</code> for write access. Claude and Cowork custom
            connectors use the OAuth flow instead of this fallback.
          </p>
        </section>
      </CardContent>
    </Card>
  );
}
