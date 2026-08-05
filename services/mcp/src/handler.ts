import {
  buildOAuthProtectedResourceMetadata,
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  oauthMetadataResponse,
  originValidationResponse,
  requireBearerAuth,
  OAuthError,
  OAuthErrorCode,
  type AuthMetadataOptions
} from "@modelcontextprotocol/server";
import type { ApiTokenService } from "../../api/src/api-tokens/service";
import { apiTokenScopes } from "../../api/src/api-tokens/types";
import type { GoalService } from "../../api/src/goals/service";
import type { OrganizationService } from "../../api/src/organizations/service";
import {
  assertOAuthProviderConfiguration,
  createMcpTokenVerifier,
  type McpOAuthProvider
} from "./auth";
import { createGoalkeeperMcpServer } from "./tools";

export type GoalkeeperMcpDependencies = {
  apiTokens: ApiTokenService;
  goals: GoalService;
  organizations: OrganizationService;
  publicMcpUrl: string;
  oauthProvider?: McpOAuthProvider;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  dangerouslyAllowInsecureIssuerUrl?: boolean;
};

export function createGoalkeeperMcpHandler(
  dependencies: GoalkeeperMcpDependencies
) {
  const resource = new URL(dependencies.publicMcpUrl);
  if (resource.pathname === "/") resource.pathname = "/mcp";
  resource.hash = "";
  const dangerouslyAllowInsecureIssuerUrl =
    dependencies.dangerouslyAllowInsecureIssuerUrl ?? false;
  const metadataOptions = dependencies.oauthProvider
    ? createMetadataOptions(
        dependencies.oauthProvider,
        resource,
        dangerouslyAllowInsecureIssuerUrl
      )
    : null;
  const verifier = createMcpTokenVerifier({
    apiTokens: dependencies.apiTokens,
    resource,
    oauthProvider: dependencies.oauthProvider
  });
  const requireAuth = requireBearerAuth({
    verifier,
    resourceMetadataUrl: metadataOptions
      ? getOAuthProtectedResourceMetadataUrl(resource)
      : undefined
  });
  const allowedHosts = dependencies.allowedHosts ?? [resource.hostname];
  const allowedOrigins = dependencies.allowedOrigins ?? [resource.origin];
  const mcp = createMcpHandler(
    ({ authInfo }) => {
      if (!authInfo) throw new Error("Authenticated MCP request is missing auth info");
      return createGoalkeeperMcpServer({
        authInfo,
        goals: dependencies.goals,
        organizations: dependencies.organizations
      });
    },
    { legacy: "stateless" }
  );

  return {
    resource,
    async fetch(request: Request): Promise<Response> {
      const metadata = metadataOptions
        ? oauthMetadataResponse(request, metadataOptions)
        : undefined;
      if (metadata) return metadata;

      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        return Response.json({ service: "mcp", status: "ok" });
      }
      if (url.pathname !== resource.pathname) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      const rejected =
        hostHeaderValidationResponse(request, allowedHosts) ??
        originValidationResponse(request, allowedOrigins);
      if (rejected) return rejected;

      const authInfo = await requireAuth(request);
      if (authInfo instanceof Response) return authInfo;
      const requiredScope = requiredToolScope(request);
      if (
        requiredScope &&
        !authInfo.scopes.includes(requiredScope) &&
        !authInfo.scopes.includes(`${requiredScope}:all`)
      ) {
        return bearerAuthChallengeResponse(
          new OAuthError(
            OAuthErrorCode.InsufficientScope,
            `This tool requires ${requiredScope}`
          ),
          {
            requiredScopes: [requiredScope],
            resourceMetadataUrl: metadataOptions
              ? getOAuthProtectedResourceMetadataUrl(resource)
              : undefined
          }
        );
      }
      return mcp.fetch(request, { authInfo });
    },
    close: mcp.close
  };
}

const readTools = new Set([
  "list_goals",
  "get_goal",
  "list_goal_updates",
  "list_goal_labels",
  "get_goal_label"
]);
const writeTools = new Set([
  "create_goal",
  "update_goal",
  "report_goal_update",
  "create_goal_label",
  "update_goal_label",
  "delete_goal_label"
]);

function requiredToolScope(request: Request): "goals:read" | "goals:write" | null {
  if (request.headers.get("mcp-method") !== "tools/call") return null;
  const toolName = request.headers.get("mcp-name");
  if (toolName && readTools.has(toolName)) return "goals:read";
  if (toolName && writeTools.has(toolName)) return "goals:write";
  return null;
}

function createMetadataOptions(
  provider: McpOAuthProvider,
  resource: URL,
  dangerouslyAllowInsecureIssuerUrl: boolean
): AuthMetadataOptions {
  assertOAuthProviderConfiguration(provider, dangerouslyAllowInsecureIssuerUrl);
  const options = {
    oauthMetadata: provider.metadata,
    resourceServerUrl: resource,
    scopesSupported: [...apiTokenScopes],
    resourceName: "Goalkeeper MCP",
    dangerouslyAllowInsecureIssuerUrl
  } satisfies AuthMetadataOptions;
  buildOAuthProtectedResourceMetadata(options);
  return options;
}
