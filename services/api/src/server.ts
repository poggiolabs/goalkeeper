import { SQL } from "bun";
import { createApiHandler } from "./app";
import {
  createPostgresApiTokenRepository,
  migrateApiDatabase
} from "./api-tokens/postgres";
import { createApiTokenService } from "./api-tokens/service";
import {
  configuredEmailDelivery,
  optionalNotificationDelivery
} from "./notifications/email-delivery";
import { createPostgresEmailAuthBackend } from "./auth/email";
import { createTrustedProxyAuthBackend } from "./auth/trusted-proxy";
import type { AuthBackend } from "./auth/types";
import { createPostgresOrganizationRepository } from "./organizations/postgres";
import { createOrganizationService } from "./organizations/service";
import { createPostgresGoalRepository } from "./goals/postgres";
import { createGoalService } from "./goals/service";

const host = process.env.API_HOST ?? "0.0.0.0";
const port = Number(process.env.API_PORT ?? 3001);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const apiOrigin = process.env.PUBLIC_API_URL ?? "http://localhost:3001";
const authProvider = process.env.AUTH_PROVIDER ?? "email";
const database = new SQL(
  process.env.DATABASE_URL ??
    "postgresql://goalkeeper:goalkeeper@127.0.0.1:5432/goalkeeper"
);
const apiTokens = createApiTokenService(
  createPostgresApiTokenRepository(database)
);
const organizations = createOrganizationService(
  createPostgresOrganizationRepository(database),
  {
    webOrigin,
    // Null when no mailer is configured. Invitations still commit and return
    // a shareable link, so a trusted-proxy deployment works before SMTP
    // credentials exist.
    emailDelivery: optionalNotificationDelivery()
  }
);
const goals = createGoalService(createPostgresGoalRepository(database), {
  isOrganizationMember: async (userId, organizationId) =>
    (await organizations.roleForUser(userId, organizationId)) !== null
});
const auth: AuthBackend = (() => {
  switch (authProvider) {
    case "email":
      return createPostgresEmailAuthBackend({
        sql: database,
        webOrigin,
        apiOrigin,
        emailDelivery: configuredEmailDelivery()
      });
    case "trusted_proxy":
      return createTrustedProxyAuthBackend({
        secret: requiredEnvironment("AUTH_PROXY_SECRET"),
        issuer: requiredEnvironment("AUTH_PROXY_ISSUER"),
        audience: requiredEnvironment("AUTH_PROXY_AUDIENCE"),
        loginUrl: requiredEnvironment("AUTH_PROXY_LOGIN_URL"),
        logoutUrl: requiredEnvironment("AUTH_PROXY_LOGOUT_URL")
      });
    default:
      throw new Error("AUTH_PROVIDER must be one of: email, trusted_proxy");
  }
})();

export const handleApiRequest = createApiHandler({
  webOrigin,
  apiTokens,
  goals,
  organizations,
  auth
});

if (import.meta.main) {
  await migrateApiDatabase(database);

  const server = Bun.serve({
    hostname: host,
    port,
    fetch: handleApiRequest
  });

  console.log(`REST API listening on http://${server.hostname}:${server.port}`);
}

function requiredEnvironment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
