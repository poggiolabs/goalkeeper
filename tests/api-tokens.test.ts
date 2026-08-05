import { describe, expect, test } from "bun:test";
import {
  ApiTokenError,
  authorizeApiToken,
  createApiTokenService,
  hashToken
} from "../services/api/src/api-tokens/service";
import {
  apiTokenScopeRegistry,
  apiTokenScopes as serviceScopes,
  defaultApiTokenScopes
} from "../services/api/src/api-tokens/types";
import { apiOpenApiDocument } from "../services/api/src/spec";
import { MemoryApiTokenRepository } from "./helpers/memory-api-token-repository";

function createHarness() {
  const repository = new MemoryApiTokenRepository();
  let currentTime = new Date("2026-08-04T12:00:00.000Z");
  let nextByte = 0;
  const service = createApiTokenService(repository, {
    now: () => currentTime,
    randomBytes(length) {
      return Uint8Array.from(
        { length },
        () => (nextByte++ % 255) + 1
      );
    }
  });

  return {
    repository,
    service,
    setTime(value: string) {
      currentTime = new Date(value);
    }
  };
}

describe("API token lifecycle", () => {
  test("returns a secret once and stores only its SHA-256 hash", async () => {
    const { repository, service } = createHarness();
    const created = await service.create("user-1", {
      name: "Automation",
      scopes: ["goals:read:own", "goals:write:all"],
      expiresInDays: 30
    });

    expect(created.secret).toMatch(/^gk_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/);
    expect(created.token).toMatchObject({
      name: "Automation",
      prefix: created.secret.slice(0, "gk_".length + 16),
      scopes: ["goals:read:own", "goals:write:all"],
      expiresAt: "2026-09-03T12:00:00.000Z"
    });
    expect(repository.records[0]?.tokenHash).toBe(
      await hashToken(created.secret)
    );
    expect(repository.records[0]?.tokenHash).not.toBe(created.secret);

    const listed = await service.list("user-1");
    expect(listed.tokens[0]?.id).toBe(created.token.id);
    expect(listed).not.toHaveProperty("secret");
  });

  test("uses a 90-day default and rejects invalid scope requests", async () => {
    const { service } = createHarness();
    const created = await service.create("user-1", {
      name: "Default lifetime",
      scopes: ["goals:read:own"]
    });
    expect(created.token.expiresAt).toBe("2026-11-02T12:00:00.000Z");

    await expect(
      service.create("user-1", { name: "No scopes", scopes: [] })
    ).rejects.toMatchObject({ code: "invalid_api_token_scopes" });
    await expect(
      service.create("user-1", {
        name: "Unknown scope",
        scopes: ["admin:all"]
      })
    ).rejects.toMatchObject({ code: "invalid_api_token_scopes" });
  });

  test("resolves bearer credentials with a sessionless principal", async () => {
    const harness = createHarness();
    const { repository, service } = harness;
    const created = await service.create("user-1", {
      name: "Goal updater",
      scopes: ["goals:write:all"]
    });

    const principal = await service.resolveRequest(
      new Request("http://localhost/v1/goals", {
        headers: { authorization: `bearer ${created.secret}` }
      })
    );
    expect(principal).toEqual({
      kind: "apiToken",
      tokenId: created.token.id,
      userId: "user-1",
      sessionId: null,
      scopes: ["goals:write:all"]
    });
    expect(repository.records[0]?.lastUsedAt?.toISOString()).toBe(
      "2026-08-04T12:00:00.000Z"
    );
    expect(await service.resolve("not-a-token")).toBeNull();

    harness.setTime("2026-08-04T12:03:00.000Z");
    await service.resolve(created.secret);
    expect(repository.records[0]?.lastUsedAt?.toISOString()).toBe(
      "2026-08-04T12:00:00.000Z"
    );

    harness.setTime("2026-08-04T12:06:00.000Z");
    await service.resolve(created.secret);
    expect(repository.records[0]?.lastUsedAt?.toISOString()).toBe(
      "2026-08-04T12:06:00.000Z"
    );
  });

  test("revocation, expiration, and owner isolation fail closed", async () => {
    const harness = createHarness();
    const created = await harness.service.create("user-1", {
      name: "Temporary",
      scopes: ["goals:read:own"],
      expiresInDays: 1
    });

    await expect(
      harness.service.revoke("user-2", created.token.id)
    ).rejects.toMatchObject({ code: "api_token_not_found" });
    expect(await harness.service.resolve(created.secret)).not.toBeNull();

    await harness.service.revoke("user-1", created.token.id);
    expect(await harness.service.resolve(created.secret)).toBeNull();

    const expiring = await harness.service.create("user-1", {
      name: "Expiring",
      scopes: ["goals:read:own"],
      expiresInDays: 1
    });
    harness.setTime("2026-08-05T12:00:00.001Z");
    expect(await harness.service.resolve(expiring.secret)).toBeNull();
  });
});

describe("API token authorization", () => {
  const principal = {
    kind: "apiToken" as const,
    tokenId: crypto.randomUUID(),
    userId: "user-1",
    sessionId: null,
    scopes: ["goals:read:own" as const]
  };

  test("requires both the canonical scope and the owner's live authority", async () => {
    await expect(
      authorizeApiToken(principal, "goals.read.own", () => true)
    ).resolves.toMatchObject({
      allowed: true,
      acceptedScopes: ["goals:read:own", "goals:read:all"]
    });
    await expect(
      authorizeApiToken(principal, "goals.write.own", () => true)
    ).rejects.toMatchObject({ code: "insufficient_scope" });
    await expect(
      authorizeApiToken(principal, "goals.read.own", () => false)
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  test("all-goals scopes include the corresponding own-goals capability", async () => {
    await expect(
      authorizeApiToken(
        { ...principal, scopes: ["goals:read:all"] },
        "goals.read.own",
        () => true
      )
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      authorizeApiToken(principal, "goals.read.all", () => true)
    ).rejects.toMatchObject({ code: "insufficient_scope" });
  });

  test("defaults to denying unmapped operations", async () => {
    await expect(
      authorizeApiToken(principal, "tokens.create", () => true)
    ).rejects.toEqual(
      new ApiTokenError(
        "api_token_not_allowed",
        "API tokens cannot access this operation",
        403
      )
    );
  });
});

test("API token scopes stay aligned across the registry and OpenAPI", () => {
  expect(apiTokenScopeRegistry.map((scope) => scope.id)).toEqual(serviceScopes);
  expect(defaultApiTokenScopes).toEqual(["goals:read:own"]);
  expect(apiOpenApiDocument.components.schemas.ApiTokenScope.enum).toEqual(
    serviceScopes
  );
});
