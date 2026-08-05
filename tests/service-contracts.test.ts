import { describe, expect, test } from "bun:test";
import { createApiHandler } from "../services/api/src/app";
import { createApiTokenService } from "../services/api/src/api-tokens/service";
import { apiRoutes } from "../services/api/src/routes";
import { apiOpenApiDocument } from "../services/api/src/spec";
import { MemoryApiTokenRepository } from "./helpers/memory-api-token-repository";
import { MemoryEmailAuthBackend } from "./helpers/memory-email-auth-backend";

const webOrigin = "http://localhost:3000";
const authBackend = new MemoryEmailAuthBackend(webOrigin);
const handleApiRequest = createApiHandler({
  webOrigin,
  apiTokens: createApiTokenService(new MemoryApiTokenRepository()),
  auth: authBackend
});

describe("REST API contract", () => {
  test("serves the documented health route", async () => {
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.health.path}`)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "api", status: "ok" });
    expect(apiOpenApiDocument.paths[apiRoutes.health.path].get).toBeDefined();
  });

  test("returns 404 for an unknown route", async () => {
    const response = await handleApiRequest(
      new Request("http://localhost/v1/unknown")
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  test("handles credentialed CORS preflight", async () => {
    const response = await handleApiRequest(
      new Request("http://localhost/health", { method: "OPTIONS" })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(webOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, POST, DELETE, OPTIONS"
    );
  });
});

describe("authentication contract", () => {
  test("requires a session for the account identity", async () => {
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authSession.path}`)
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  test("registers, verifies, signs in, and returns the canonical user", async () => {
    const registerResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authRegister.path}`, {
        method: "POST",
        headers: { origin: webOrigin, "content-type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "correct horse battery staple",
          displayName: "Test User"
        })
      })
    );
    expect(registerResponse.status).toBe(202);
    expect(await registerResponse.json()).toEqual({
      emailVerificationRequired: true,
      email: "test@example.com"
    });

    const verificationToken = [...authBackend.verificationTokens.keys()][0]!;
    const verificationResponse = await handleApiRequest(
      new Request(
        `http://localhost${apiRoutes.authVerifyEmail.path}?token=${encodeURIComponent(verificationToken)}`
      )
    );
    expect(verificationResponse.status).toBe(302);
    expect(verificationResponse.headers.get("location")).toBe(
      `${webOrigin}/?verified=1`
    );
    expect(verificationResponse.headers.get("cache-control")).toBe("no-store");
    expect(verificationResponse.headers.get("referrer-policy")).toBe(
      "no-referrer"
    );

    const replayResponse = await handleApiRequest(
      new Request(
        `http://localhost${apiRoutes.authVerifyEmail.path}?token=${encodeURIComponent(verificationToken)}`
      )
    );
    expect(replayResponse.status).toBe(302);
    expect(replayResponse.headers.get("location")).toBe(
      `${webOrigin}/?verification=invalid`
    );

    const loginResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authEmailLogin.path}`, {
        method: "POST",
        headers: { origin: webOrigin, "content-type": "application/json" },
        body: JSON.stringify({
          email: "test@example.com",
          password: "correct horse battery staple",
          returnTo: `${webOrigin}/account`
        })
      })
    );

    expect(loginResponse.status).toBe(200);
    expect(await loginResponse.clone().json()).toEqual({
      redirectTo: `${webOrigin}/account`
    });
    const cookie = loginResponse.headers.get("set-cookie");
    expect(cookie).toContain("test_session=");
    expect(cookie).toContain("HttpOnly");

    const sessionResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authSession.path}`, {
        headers: { cookie: cookie ?? "" }
      })
    );

    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toEqual({
      user: {
        id: expect.any(String),
        displayName: "Test User",
        email: "test@example.com"
      }
    });
  });

  test("rejects an external post-login destination", async () => {
    const response = await handleApiRequest(
      new Request(
        `http://localhost${apiRoutes.authLogin.path}?returnTo=${encodeURIComponent("https://example.net/account")}`
      )
    );

    expect(response.headers.get("location")).toBe(`${webOrigin}/account`);
  });

  test("exposes the configured authentication method", async () => {
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authConfig.path}`)
    );
    expect(await response.json()).toEqual({ method: "email" });
  });

  test("logs out and clears the session", async () => {
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authLogout.path}`, {
        method: "POST",
        headers: {
          cookie: "test_session=missing",
          origin: webOrigin
        }
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await response.json()).toEqual({
      redirectTo: `${webOrigin}/`
    });
  });

  test("rejects logout from another browser origin", async () => {
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authLogout.path}`, {
        method: "POST",
        headers: {
          cookie: "goalkeeper_session=local",
          origin: "https://example.net"
        }
      })
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  test("documents every authentication route", () => {
    expect(apiOpenApiDocument.paths[apiRoutes.authSession.path].get).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.authConfig.path].get).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.authLogin.path].get).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.authEmailLogin.path].post).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.authRegister.path].post).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.authVerifyEmail.path].get).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.authCallback.path].get).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.authLogout.path].post).toBeDefined();
  });

});

describe("API token management contract", () => {
  async function authenticatedCookie(): Promise<string> {
    const email = `${crypto.randomUUID()}@example.com`;
    authBackend.addVerifiedUser({
      email,
      password: "correct horse battery staple",
      displayName: "Token User"
    });
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authEmailLogin.path}`, {
        method: "POST",
        headers: { origin: webOrigin, "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password: "correct horse battery staple",
          returnTo: `${webOrigin}/account`
        })
      })
    );
    return response.headers.get("set-cookie") ?? "";
  }

  test("requires an interactive session", async () => {
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.apiTokensList.path}`)
    );
    expect(response.status).toBe(401);
  });

  test("creates, lists, and revokes a scoped token", async () => {
    const cookie = await authenticatedCookie();
    const createResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.apiTokensCreate.path}`, {
        method: "POST",
        headers: {
          cookie,
          origin: webOrigin,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Contract token",
          scopes: ["goals:read:own"],
          expiresInDays: 30
        })
      })
    );
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()) as {
      token: { id: string };
      secret: string;
    };
    expect(created.secret).toMatch(/^gk_/);

    const listResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.apiTokensList.path}`, {
        headers: { cookie }
      })
    );
    const listed = (await listResponse.json()) as {
      tokens: Array<{ id: string; secret?: string }>;
    };
    expect(listed.tokens.some((token) => token.id === created.token.id)).toBe(true);
    expect(listed.tokens[0]).not.toHaveProperty("secret");

    const revokeResponse = await handleApiRequest(
      new Request(`http://localhost/v1/api-tokens/${created.token.id}`, {
        method: "DELETE",
        headers: { cookie, origin: webOrigin }
      })
    );
    expect(revokeResponse.status).toBe(200);
  });

  test("rejects token mutations from another browser origin", async () => {
    const cookie = await authenticatedCookie();
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.apiTokensCreate.path}`, {
        method: "POST",
        headers: {
          cookie,
          origin: "https://example.net",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          name: "Blocked",
          scopes: ["goals:read:own"]
        })
      })
    );
    expect(response.status).toBe(403);
  });

  test("documents every API token route", () => {
    expect(
      apiOpenApiDocument.paths[apiRoutes.apiTokenScopes.path].get
    ).toBeDefined();
    expect(
      apiOpenApiDocument.paths[apiRoutes.apiTokensList.path].get
    ).toBeDefined();
    expect(
      apiOpenApiDocument.paths[apiRoutes.apiTokensCreate.path].post
    ).toBeDefined();
    expect(
      apiOpenApiDocument.paths[apiRoutes.apiTokenRevoke.path].delete
    ).toBeDefined();
  });

  test("returns the canonical scope registry", async () => {
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.apiTokenScopes.path}`)
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scopes: [
        expect.objectContaining({ id: "goals:read:own", default: true }),
        expect.objectContaining({ id: "goals:write:own", default: false }),
        expect.objectContaining({ id: "goals:read:all", default: false }),
        expect.objectContaining({ id: "goals:write:all", default: false })
      ]
    });
  });
});
