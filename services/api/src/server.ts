import { SQL } from "bun";
import { createApiHandler } from "./app";
import {
  createPostgresApiTokenRepository,
  migrateApiDatabase
} from "./api-tokens/postgres";
import { createApiTokenService } from "./api-tokens/service";
import { LogEmailDelivery } from "./auth/email-delivery";
import { createPostgresEmailAuthBackend } from "./auth/email";
import { createPostgresOrganizationRepository } from "./organizations/postgres";
import { createOrganizationService } from "./organizations/service";
import { createPostgresGoalRepository } from "./goals/postgres";
import { createGoalService } from "./goals/service";

const host = process.env.API_HOST ?? "0.0.0.0";
const port = Number(process.env.API_PORT ?? 3001);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
const apiOrigin = process.env.PUBLIC_API_URL ?? "http://localhost:3001";
const authProvider = process.env.AUTH_PROVIDER ?? "email";
const emailDelivery = process.env.AUTH_EMAIL_DELIVERY ?? "log";
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
if (authProvider !== "email") {
  throw new Error(
    "The standalone API supports AUTH_PROVIDER=email. Inject another AuthBackend into createApiHandler()."
  );
}
if (emailDelivery !== "log" || process.env.NODE_ENV === "production") {
  throw new Error(
    "AUTH_EMAIL_DELIVERY=log is available only outside production. Inject production email delivery with the email AuthBackend."
  );
}
const auth = createPostgresEmailAuthBackend({
  sql: database,
  webOrigin,
  apiOrigin,
  emailDelivery: new LogEmailDelivery()
});

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
