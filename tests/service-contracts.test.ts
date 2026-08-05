import { describe, expect, test } from "bun:test";
import { createApiHandler } from "../services/api/src/app";
import { createApiTokenService } from "../services/api/src/api-tokens/service";
import { apiRoutes } from "../services/api/src/routes";
import { apiOpenApiDocument } from "../services/api/src/spec";
import { MemoryApiTokenRepository } from "./helpers/memory-api-token-repository";
import { MemoryEmailAuthBackend } from "./helpers/memory-email-auth-backend";
import { MemoryOrganizationRepository } from "./helpers/memory-organization-repository";
import { createOrganizationService } from "../services/api/src/organizations/service";
import { MemoryGoalRepository } from "./helpers/memory-goal-repository";
import { createGoalService } from "../services/api/src/goals/service";

const webOrigin = "http://localhost:3000";
const authBackend = new MemoryEmailAuthBackend(webOrigin);
const organizationRepository = new MemoryOrganizationRepository();
const goalRepository = new MemoryGoalRepository();
const organizations = createOrganizationService(organizationRepository);
const apiTokens = createApiTokenService(new MemoryApiTokenRepository());
const handleApiRequest = createApiHandler({
  webOrigin,
  apiTokens,
  organizations,
  goals: createGoalService(goalRepository, {
    isOrganizationMember: async (userId, organizationId) =>
      (await organizations.roleForUser(userId, organizationId)) !== null
  }),
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
      "GET, POST, PATCH, DELETE, OPTIONS"
    );
  });
});

describe("goal REST contract", () => {
  async function authenticatedGoalUser() {
    const email = `${crypto.randomUUID()}@example.com`;
    const user = authBackend.addVerifiedUser({
      email,
      password: "correct horse battery staple",
      displayName: "Goal User"
    });
    const login = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authEmailLogin.path}`, {
        method: "POST",
        headers: { origin: webOrigin, "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password: "correct horse battery staple",
          returnTo: `${webOrigin}/goals`
        })
      })
    );
    const cookie = login.headers.get("set-cookie") ?? "";
    const session = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authSession.path}`, {
        headers: { cookie }
      })
    );
    const context = (await session.json()) as { activeOrganizationId: string };
    return { user, cookie, organizationId: context.activeOrganizationId };
  }

  test("serves label and goal CRUD to sessions and scoped API tokens", async () => {
    const { user, cookie, organizationId } = await authenticatedGoalUser();
    const labelResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.goalLabelsCreate.path}`, {
        method: "POST",
        headers: {
          cookie,
          origin: webOrigin,
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "Launch", color: "#22c55e" })
      })
    );
    expect(labelResponse.status).toBe(201);
    const { label } = (await labelResponse.json()) as { label: { id: string } };

    const createResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.goalsCreate.path}`, {
        method: "POST",
        headers: {
          cookie,
          origin: webOrigin,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          detailedDescription: "Launch the first durable goals API",
          criteria: [
            {
              title: "Available",
              description: "The API serves durable goal state."
            }
          ],
          labelIds: [label.id]
        })
      })
    );
    expect(createResponse.status).toBe(201);
    const { goal } = (await createResponse.json()) as { goal: { id: string } };

    const readToken = await apiTokens.create(user.id, organizationId, {
      name: "MCP reader",
      scopes: ["goals:read"]
    });
    const listResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.goalsList.path}`, {
        headers: { authorization: `Bearer ${readToken.secret}` }
      })
    );
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      goals: [{ id: goal.id, labels: [{ id: label.id }] }]
    });

    const deniedLabelList = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.goalLabelsList.path}`, {
        headers: { authorization: `Bearer ${readToken.secret}` }
      })
    );
    expect(deniedLabelList.status).toBe(403);
    expect(await deniedLabelList.json()).toMatchObject({
      error: "insufficient_scope"
    });

    const labelToken = await apiTokens.create(user.id, organizationId, {
      name: "Label manager",
      scopes: ["labels:read", "labels:write"]
    });
    const labelList = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.goalLabelsList.path}`, {
        headers: { authorization: `Bearer ${labelToken.secret}` }
      })
    );
    expect(labelList.status).toBe(200);
    expect(await labelList.json()).toMatchObject({
      labels: [{ id: label.id }]
    });
    const tokenLabelCreate = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.goalLabelsCreate.path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${labelToken.secret}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "API token" })
      })
    );
    expect(tokenLabelCreate.status).toBe(201);

    const denied = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.goalsCreate.path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${readToken.secret}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          detailedDescription: "This must not be created"
        })
      })
    );
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "insufficient_scope" });

    const writeToken = await apiTokens.create(user.id, organizationId, {
      name: "MCP writer",
      scopes: ["goals:write"]
    });
    const tokenCreate = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.goalsCreate.path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${writeToken.secret}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          detailedDescription: "Create without a browser origin"
        })
      })
    );
    expect(tokenCreate.status).toBe(201);

    const updateResponse = await handleApiRequest(
      new Request(
        `http://localhost/v1/goals/${goal.id}/updates`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${writeToken.secret}`,
            "content-type": "application/json"
          },
          body: JSON.stringify({
            status: "completed",
            summary: "Launch complete",
            details: "The durable goals API is available.",
            expectedRevision: 1,
            idempotencyKey: "launch-complete"
          })
        }
      )
    );
    expect(updateResponse.status).toBe(201);
    expect(await updateResponse.json()).toMatchObject({
      update: {
        goalId: goal.id,
        revision: 2,
        status: "completed",
        authorityUserId: user.id,
        actor: { kind: "client", id: writeToken.token.id, runId: null },
        authentication: {
          kind: "api_token",
          subjectId: writeToken.token.id
        },
        clientInfo: null
      }
    });
  });

  test("fails closed for invalid bearer credentials and browser CSRF", async () => {
    const { cookie } = await authenticatedGoalUser();
    const invalid = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.goalsList.path}`, {
        headers: { authorization: "Bearer invalid" }
      })
    );
    expect(invalid.status).toBe(401);
    expect(await invalid.json()).toMatchObject({ error: "invalid_api_token" });

    const crossOrigin = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.goalsCreate.path}`, {
        method: "POST",
        headers: {
          cookie,
          origin: "https://example.net",
          "content-type": "application/json"
        },
        body: JSON.stringify({ detailedDescription: "Blocked" })
      })
    );
    expect(crossOrigin.status).toBe(403);
  });

  test("documents every goal and label route", () => {
    expect(apiOpenApiDocument.paths[apiRoutes.goalsList.path].get).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.goalsCreate.path].post).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.goalGet.path].get).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.goalUpdate.path].patch).toBeDefined();
    expect(
      apiOpenApiDocument.paths[apiRoutes.goalUpdatesList.path].get
    ).toBeDefined();
    expect(
      apiOpenApiDocument.paths[apiRoutes.goalUpdatesCreate.path].post
    ).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.goalLabelsList.path].get).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.goalLabelsCreate.path].post).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.goalLabelGet.path].get).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.goalLabelUpdate.path].patch).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.goalLabelDelete.path].delete).toBeDefined();
  });
});

describe("authentication contract", () => {
  test("requires a session for the account identity", async () => {
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authSession.path}`, {
        headers: { cookie: "test_session=invalid" }
      })
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
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
    expect(registerResponse.headers.get("cache-control")).toBe("no-store");
    expect(await registerResponse.json()).toEqual({
      emailVerificationRequired: true,
      email: "test@example.com"
    });

    const verificationToken = [...authBackend.verificationTokens.keys()][0]!;
    const scannerResponse = await handleApiRequest(
      new Request(
        `http://localhost${apiRoutes.authVerifyEmail.path}?token=${encodeURIComponent(verificationToken)}`
      )
    );
    expect(scannerResponse.status).toBe(404);
    expect(authBackend.verificationTokens.has(verificationToken)).toBe(true);

    const verificationResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authVerifyEmail.path}`, {
        method: "POST",
        headers: { origin: webOrigin, "content-type": "application/json" },
        body: JSON.stringify({ token: verificationToken })
      })
    );
    expect(verificationResponse.status).toBe(200);
    expect(await verificationResponse.clone().json()).toEqual({
      redirectTo: `${webOrigin}/sign-in?verified=1`
    });
    expect(verificationResponse.headers.get("cache-control")).toBe("no-store");
    expect(verificationResponse.headers.get("referrer-policy")).toBe(
      "no-referrer"
    );

    const replayResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authVerifyEmail.path}`, {
        method: "POST",
        headers: { origin: webOrigin, "content-type": "application/json" },
        body: JSON.stringify({ token: verificationToken })
      })
    );
    expect(replayResponse.status).toBe(400);
    expect(replayResponse.headers.get("cache-control")).toBe("no-store");
    expect(replayResponse.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await replayResponse.json()).toEqual({
      error: "invalid_or_expired_token",
      message: "Invalid token"
    });

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
    expect(loginResponse.headers.get("cache-control")).toBe("no-store");
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
    expect(sessionResponse.headers.get("cache-control")).toBe("no-store");
    expect(await sessionResponse.json()).toEqual({
      user: {
        id: expect.any(String),
        displayName: "Test User",
        email: "test@example.com"
      },
      activeOrganizationId: expect.any(String),
      organizations: [
        {
          id: expect.any(String),
          name: "Test User",
          role: "owner"
        }
      ]
    });
  });

  test("rejects an external post-login destination", async () => {
    const response = await handleApiRequest(
      new Request(
        `http://localhost${apiRoutes.authLogin.path}?returnTo=${encodeURIComponent("https://example.net/account")}`
      )
    );

    expect(response.headers.get("location")).toBe(`${webOrigin}/home`);
  });

  test("prevents callback responses from being cached or referred", async () => {
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authCallback.path}`)
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
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
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await response.json()).toEqual({
      redirectTo: `${webOrigin}/sign-in`
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

  test("rejects logout without an explicit browser origin", async () => {
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authLogout.path}`, {
        method: "POST",
        headers: { cookie: "goalkeeper_session=local" }
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
    expect(apiOpenApiDocument.paths[apiRoutes.authVerifyEmail.path].post).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.authCallback.path].get).toBeDefined();
    expect(apiOpenApiDocument.paths[apiRoutes.authLogout.path].post).toBeDefined();
  });

});

describe("organization contract", () => {
  async function authenticatedUser(displayName = "Organization User") {
    const email = `${crypto.randomUUID()}@example.com`;
    const user = authBackend.addVerifiedUser({
      email,
      password: "correct horse battery staple",
      displayName
    });
    const response = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authEmailLogin.path}`, {
        method: "POST",
        headers: { origin: webOrigin, "content-type": "application/json" },
        body: JSON.stringify({
          email,
          password: "correct horse battery staple",
          returnTo: `${webOrigin}/home`
        })
      })
    );
    return { user, cookie: response.headers.get("set-cookie") ?? "" };
  }

  test("creates one organization named after the user on first session", async () => {
    const { user, cookie } = await authenticatedUser("Ada Lovelace");

    const first = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authSession.path}`, {
        headers: { cookie }
      })
    );
    const firstSession = (await first.json()) as {
      activeOrganizationId: string;
      organizations: Array<{ id: string; name: string; role: string }>;
    };
    const second = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authSession.path}`, {
        headers: { cookie }
      })
    );
    const secondSession = (await second.json()) as typeof firstSession;

    expect(firstSession.organizations).toEqual([
      {
        id: firstSession.activeOrganizationId,
        name: "Ada Lovelace",
        role: "owner"
      }
    ]);
    expect(secondSession).toEqual(firstSession);
    expect(
      organizationRepository.memberships.get(firstSession.activeOrganizationId)?.size
    ).toBe(1);
  });

  test("creates and switches organizations while rejecting non-members", async () => {
    const { cookie } = await authenticatedUser();
    await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authSession.path}`, {
        headers: { cookie }
      })
    );

    const createdResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.organizationsCreate.path}`, {
        method: "POST",
        headers: {
          cookie,
          origin: webOrigin,
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "Second Organization" })
      })
    );
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as {
      activeOrganizationId: string;
      organizations: Array<{ id: string; name: string }>;
    };
    expect(created.organizations).toHaveLength(2);
    expect(
      created.organizations.find(({ id }) => id === created.activeOrganizationId)?.name
    ).toBe("Second Organization");

    const original = created.organizations.find(
      ({ id }) => id !== created.activeOrganizationId
    )!;
    const switchedResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.organizationsSwitch.path}`, {
        method: "POST",
        headers: {
          cookie,
          origin: webOrigin,
          "content-type": "application/json"
        },
        body: JSON.stringify({ organizationId: original.id })
      })
    );
    expect(switchedResponse.status).toBe(200);
    expect(await switchedResponse.json()).toMatchObject({
      activeOrganizationId: original.id
    });

    const forbidden = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.organizationsSwitch.path}`, {
        method: "POST",
        headers: {
          cookie,
          origin: webOrigin,
          "content-type": "application/json"
        },
        body: JSON.stringify({ organizationId: crypto.randomUUID() })
      })
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ error: "membership_not_found" });
  });

  test("requires authentication and same-origin mutation requests", async () => {
    const unauthenticated = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.organizationsList.path}`)
    );
    expect(unauthenticated.status).toBe(401);

    const { cookie } = await authenticatedUser();
    const crossOrigin = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.organizationsCreate.path}`, {
        method: "POST",
        headers: {
          cookie,
          origin: "https://example.net",
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "Blocked" })
      })
    );
    expect(crossOrigin.status).toBe(403);
  });

  test("lets administrators rename organizations and manage non-owner roles", async () => {
    const owner = await authenticatedUser("Owner User");
    const ownerSessionResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.authSession.path}`, {
        headers: { cookie: owner.cookie }
      })
    );
    const ownerSession = (await ownerSessionResponse.json()) as {
      activeOrganizationId: string;
    };
    const admin = await authenticatedUser("Admin User");
    const member = await authenticatedUser("Member User");
    organizationRepository.addMember(
      ownerSession.activeOrganizationId,
      admin.user,
      "admin"
    );
    organizationRepository.addMember(
      ownerSession.activeOrganizationId,
      member.user,
      "member"
    );

    const deniedRename = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.organizationUpdate.path}`, {
        method: "PATCH",
        headers: {
          cookie: member.cookie,
          origin: webOrigin,
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "Denied" })
      })
    );
    expect(deniedRename.status).toBe(403);

    const renamed = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.organizationUpdate.path}`, {
        method: "PATCH",
        headers: {
          cookie: admin.cookie,
          origin: webOrigin,
          "content-type": "application/json"
        },
        body: JSON.stringify({ name: "Renamed Organization" })
      })
    );
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      activeOrganizationId: ownerSession.activeOrganizationId,
      organizations: [
        {
          id: ownerSession.activeOrganizationId,
          name: "Renamed Organization",
          role: "admin"
        }
      ]
    });

    const membersResponse = await handleApiRequest(
      new Request(`http://localhost${apiRoutes.organizationMembersList.path}`, {
        headers: { cookie: owner.cookie }
      })
    );
    expect(membersResponse.status).toBe(200);
    expect(await membersResponse.json()).toMatchObject({
      members: [
        { userId: owner.user.id, role: "owner" },
        { userId: admin.user.id, role: "admin" },
        { userId: member.user.id, role: "member" }
      ]
    });

    const memberRolePath = apiRoutes.organizationMemberUpdate.path.replace(
      "{userId}",
      encodeURIComponent(member.user.id)
    );
    const promoted = await handleApiRequest(
      new Request(`http://localhost${memberRolePath}`, {
        method: "PATCH",
        headers: {
          cookie: admin.cookie,
          origin: webOrigin,
          "content-type": "application/json"
        },
        body: JSON.stringify({ role: "admin" })
      })
    );
    expect(promoted.status).toBe(200);
    expect(await promoted.json()).toMatchObject({
      member: { userId: member.user.id, role: "admin" }
    });

    const ownerRolePath = apiRoutes.organizationMemberUpdate.path.replace(
      "{userId}",
      encodeURIComponent(owner.user.id)
    );
    const ownerRoleChange = await handleApiRequest(
      new Request(`http://localhost${ownerRolePath}`, {
        method: "PATCH",
        headers: {
          cookie: admin.cookie,
          origin: webOrigin,
          "content-type": "application/json"
        },
        body: JSON.stringify({ role: "member" })
      })
    );
    expect(ownerRoleChange.status).toBe(403);
  });

  test("documents every organization route", () => {
    expect(
      apiOpenApiDocument.paths[apiRoutes.organizationsList.path].get
    ).toBeDefined();
    expect(
      apiOpenApiDocument.paths[apiRoutes.organizationsCreate.path].post
    ).toBeDefined();
    expect(
      apiOpenApiDocument.paths[apiRoutes.organizationsSwitch.path].post
    ).toBeDefined();
    expect(
      apiOpenApiDocument.paths[apiRoutes.organizationUpdate.path].patch
    ).toBeDefined();
    expect(
      apiOpenApiDocument.paths[apiRoutes.organizationMembersList.path].get
    ).toBeDefined();
    expect(
      apiOpenApiDocument.paths[apiRoutes.organizationMemberUpdate.path].patch
    ).toBeDefined();
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
    expect(response.headers.get("cache-control")).toBe("no-store");
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
          scopes: ["goals:read"],
          expiresInDays: 30
        })
      })
    );
    expect(createResponse.status).toBe(201);
    expect(createResponse.headers.get("cache-control")).toBe("no-store");
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
    expect(listResponse.headers.get("cache-control")).toBe("no-store");
    expect(listed.tokens.some((token) => token.id === created.token.id)).toBe(true);
    expect(listed.tokens[0]).not.toHaveProperty("secret");

    const revokeResponse = await handleApiRequest(
      new Request(`http://localhost/v1/api-tokens/${created.token.id}`, {
        method: "DELETE",
        headers: { cookie, origin: webOrigin }
      })
    );
    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.headers.get("cache-control")).toBe("no-store");
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
          scopes: ["goals:read"]
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
        expect.objectContaining({ id: "goals:read", default: true }),
        expect.objectContaining({ id: "goals:write", default: false }),
        expect.objectContaining({ id: "goals:read:all", default: false }),
        expect.objectContaining({ id: "goals:write:all", default: false }),
        expect.objectContaining({ id: "labels:read", default: false }),
        expect.objectContaining({ id: "labels:write", default: false })
      ]
    });
  });
});
