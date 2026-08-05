import {
  buildOAuthProtectedResourceMetadata,
  bearerAuthChallengeResponse,
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  hostHeaderValidationResponse,
  oauthMetadataResponse,
  requireBearerAuth,
  OAuthError,
  OAuthErrorCode,
  type AuthMetadataOptions
} from "@modelcontextprotocol/server";
import type { ApiTokenService } from "../../api/src/api-tokens/service";
import type { GoalService } from "../../api/src/goals/service";
import type { OrganizationService } from "../../api/src/organizations/service";
import {
  assertOAuthProviderConfiguration,
  createMcpTokenVerifier,
  validateMcpResourceUrl,
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
  let resource = validateMcpResourceUrl(dependencies.publicMcpUrl);
  const resourcePath = resource.pathname.replace(/\/+$/, "");
  resource.pathname = resourcePath || "/mcp";
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
  const allowedOrigins = (dependencies.allowedOrigins ?? [resource.origin]).map(
    normalizeAllowedOrigin
  );
  const protectedResourceMetadataPath = new URL(
    getOAuthProtectedResourceMetadataUrl(resource)
  ).pathname;
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
      const url = new URL(request.url);
      const metadata =
        metadataOptions && url.pathname === protectedResourceMetadataPath
          ? oauthMetadataResponse(request, metadataOptions)
          : undefined;
      if (metadata) return metadata;

      if (url.pathname === "/health" && request.method === "GET") {
        return Response.json({ service: "mcp", status: "ok" });
      }
      if (url.pathname !== resource.pathname) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }
      const rejected =
        hostHeaderValidationResponse(request, allowedHosts) ??
        exactOriginValidationResponse(request, allowedOrigins);
      if (rejected) return rejected;

      const authInfo = await requireAuth(request);
      if (authInfo instanceof Response) {
        return withInitialScopeChallenge(authInfo);
      }
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
    scopesSupported: [...initialMcpScopes],
    resourceName: "Goalkeeper MCP",
    dangerouslyAllowInsecureIssuerUrl
  } satisfies AuthMetadataOptions;
  buildOAuthProtectedResourceMetadata(options);
  return options;
}

const initialMcpScopes = ["goals:read"] as const;

function withInitialScopeChallenge(response: Response): Response {
  if (response.status !== 401) return response;
  const challenge = response.headers.get("www-authenticate");
  if (!challenge || /(?:^|[,\s])scope=/i.test(challenge)) return response;

  const headers = new Headers(response.headers);
  headers.set(
    "www-authenticate",
    `${challenge}, scope="${initialMcpScopes.join(" ")}"`
  );
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function normalizeAllowedOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Invalid MCP allowed origin: ${value}`);
  }
  if (
    url.origin === "null" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new Error(`MCP allowed origins must be origins: ${value}`);
  }
  return url.origin;
}

function exactOriginValidationResponse(
  request: Request,
  allowedOrigins: readonly string[]
): Response | undefined {
  const value = request.headers.get("origin");
  if (value === null || value === "") return undefined;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalidOriginResponse(`Invalid Origin header: ${value}`);
  }
  if (
    url.origin === "null" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !allowedOrigins.includes(url.origin)
  ) {
    return invalidOriginResponse(`Invalid Origin: ${value}`);
  }
  return undefined;
}

function invalidOriginResponse(message: string): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: { code: -32_000, message },
      id: null
    },
    { status: 403 }
  );
}
