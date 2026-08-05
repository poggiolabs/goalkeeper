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
import { parseMcpPort } from "./config";
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

// The standalone service intentionally supports API tokens only. Deployments
// with OAuth compose createGoalkeeperMcpHandler with a capable McpOAuthProvider.
const handler = createGoalkeeperMcpHandler({
  apiTokens,
  goals,
  organizations,
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
