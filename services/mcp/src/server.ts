import { SQL } from "bun";
import {
  createPostgresApiTokenRepository,
  migrateApiDatabase
} from "../../api/src/api-tokens/postgres";
import { createApiTokenService } from "../../api/src/api-tokens/service";
import { createPostgresGoalRepository } from "../../api/src/goals/postgres";
import { createGoalService } from "../../api/src/goals/service";
import { createPostgresOrganizationRepository } from "../../api/src/organizations/postgres";
import { createOrganizationService } from "../../api/src/organizations/service";
import { parseMcpPort, parseMcpScopeList } from "./config";
import { createTrustedProxyMcpOAuthProvider } from "./trusted-oauth-proxy";
import { createGoalkeeperMcpHandler } from "./handler";

const host = process.env.MCP_HOST ?? "127.0.0.1";
const port = parseMcpPort(process.env.MCP_PORT);
const publicMcpUrl =
  process.env.PUBLIC_MCP_URL ?? `http://127.0.0.1:${port}/mcp`;
const database = new SQL(
  process.env.DATABASE_URL ??
    "postgresql://goalkeeper:goalkeeper@127.0.0.1:5432/goalkeeper"
);
const apiTokens = createApiTokenService(
  createPostgresApiTokenRepository(database)
);
const organizations = createOrganizationService(
  createPostgresOrganizationRepository(database)
);
const goals = createGoalService(createPostgresGoalRepository(database), {
  isOrganizationMember: async (userId, organizationId) =>
    (await organizations.roleForUser(userId, organizationId)) !== null
});
const oauthProvider = configuredOAuthProvider();

const handler = createGoalkeeperMcpHandler({
  apiTokens,
  goals,
  organizations,
  oauthProvider,
  publicMcpUrl,
  allowedHosts: (process.env.MCP_ALLOWED_HOSTS ?? new URL(publicMcpUrl).hostname)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  allowedOrigins: (process.env.MCP_ALLOWED_ORIGINS ?? new URL(publicMcpUrl).origin)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
});

if (import.meta.main) {
  await migrateApiDatabase(database);
  const server = Bun.serve({ hostname: host, port, fetch: handler.fetch });
  console.log(`MCP server listening on http://${server.hostname}:${server.port}`);
}

export const handleMcpRequest = handler.fetch;

function configuredOAuthProvider() {
  const provider = process.env.MCP_OAUTH_PROVIDER;
  if (!provider) return undefined;
  if (provider !== "trusted_proxy") {
    throw new Error("MCP_OAUTH_PROVIDER must be trusted_proxy when configured");
  }

  return createTrustedProxyMcpOAuthProvider({
    secret: requiredEnvironment("MCP_OAUTH_PROXY_SECRET"),
    issuer: requiredEnvironment("MCP_OAUTH_PROXY_ISSUER"),
    audience: requiredEnvironment("MCP_OAUTH_PROXY_AUDIENCE"),
    organizations,
    scopesSupported: parseMcpScopeList(
      process.env.MCP_OAUTH_SCOPES_SUPPORTED,
      "MCP_OAUTH_SCOPES_SUPPORTED"
    ),
    initialScopes: parseMcpScopeList(
      process.env.MCP_OAUTH_INITIAL_SCOPES,
      "MCP_OAUTH_INITIAL_SCOPES"
    ),
    metadata: {
      issuer: requiredEnvironment("MCP_OAUTH_ISSUER"),
      authorization_endpoint: requiredEnvironment(
        "MCP_OAUTH_AUTHORIZATION_ENDPOINT"
      ),
      token_endpoint: requiredEnvironment("MCP_OAUTH_TOKEN_ENDPOINT"),
      registration_endpoint: optionalEnvironment(
        "MCP_OAUTH_REGISTRATION_ENDPOINT"
      ),
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      client_id_metadata_document_supported:
        process.env.MCP_OAUTH_CLIENT_ID_METADATA_DOCUMENT_SUPPORTED === "true"
    }
  });
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionalEnvironment(name: string) {
  const value = process.env[name];
  return value || undefined;
}
