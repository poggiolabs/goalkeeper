import { describe, expect, test } from "bun:test";
import { createOrganizationService } from "../../api/src/organizations/service";
import { MemoryOrganizationRepository } from "../../../tests/helpers/memory-organization-repository";
import {
  createTrustedProxyMcpOAuthProvider,
  type TrustedMcpOAuthAssertion
} from "./trusted-oauth-proxy";

const secret = "mcp-proxy-secret-that-is-at-least-thirty-two-bytes";
const nowSeconds = 1_800_000_000;
const resource = new URL("https://goalkeep.example/mcp");
const metadata = {
  issuer: "https://auth.example.com",
  authorization_endpoint: "https://auth.example.com/oauth2/authorize",
  token_endpoint: "https://auth.example.com/oauth2/token",
  registration_endpoint: "https://auth.example.com/oauth2/register",
  response_types_supported: ["code"],
  code_challenge_methods_supported: ["S256"]
};

function provider(organizations = createOrganizationService(
  new MemoryOrganizationRepository()
)) {
  return createTrustedProxyMcpOAuthProvider({
    secret,
    issuer: "deployment-ingress",
    audience: "goalkeeper-mcp-production",
    metadata,
    organizations,
    now: () => new Date(nowSeconds * 1000)
  });
}

async function authorizedProvider() {
  const organizations = createOrganizationService(
    new MemoryOrganizationRepository()
  );
  const context = await organizations.ensureForUser({
    id: "external:user_01",
    displayName: "Ada Lovelace",
    email: "ada@example.com"
  });
  return {
    provider: provider(organizations),
    organizationId: context.activeOrganizationId
  };
}

function assertion(
  organizationId: string,
  overrides: Partial<TrustedMcpOAuthAssertion> = {}
): TrustedMcpOAuthAssertion {
  return {
    v: 1,
    iss: "deployment-ingress",
    aud: "goalkeeper-mcp-production",
    iat: nowSeconds,
    exp: nowSeconds + 30,
    resource: resource.href,
    clientId: "claude-dcr-client",
    scopes: ["goals:read", "labels:read"],
    userId: "external:user_01",
    organizationId,
    ...overrides
  };
}

describe("trusted MCP OAuth proxy", () => {
  test("verifies a short-lived assertion for the explicitly selected organization", async () => {
    const authorized = await authorizedProvider();
    const result = await authorized.provider.verifyAccessToken(
      await sign(assertion(authorized.organizationId)),
      { resource }
    );
    expect(result).toMatchObject({
      userId: "external:user_01",
      organizationId: authorized.organizationId,
      clientId: "claude-dcr-client",
      scopes: ["goals:read", "labels:read"],
      expiresAt: nowSeconds + 30,
      resource: resource.href
    });
  });

  test("rejects tampering, the wrong deployment coordinates, and stale assertions", async () => {
    const authorized = await authorizedProvider();
    const valid = await sign(assertion(authorized.organizationId));
    expect(await authorized.provider.verifyAccessToken(`${valid}x`, { resource }))
      .toBeNull();
    expect(await authorized.provider.verifyAccessToken(
      await sign(assertion(authorized.organizationId, { aud: "other-service" })),
      { resource }
    )).toBeNull();
    expect(await authorized.provider.verifyAccessToken(
      await sign(assertion(authorized.organizationId, {
        resource: "https://other.example/mcp"
      })),
      { resource }
    )).toBeNull();
    expect(await authorized.provider.verifyAccessToken(
      await sign(assertion(authorized.organizationId, { iat: nowSeconds - 31 })),
      { resource }
    )).toBeNull();
    expect(await authorized.provider.verifyAccessToken(
      await sign(assertion(authorized.organizationId, { exp: nowSeconds })),
      { resource }
    )).toBeNull();
    expect(await authorized.provider.verifyAccessToken(
      await sign(assertion(authorized.organizationId, { exp: nowSeconds + 31 })),
      { resource }
    )).toBeNull();
  });

  test("rejects a selected organization without live user membership", async () => {
    const authorized = await authorizedProvider();
    expect(await authorized.provider.verifyAccessToken(
      await sign(assertion(crypto.randomUUID())),
      { resource }
    )).toBeNull();
  });

  test("requires an independent high-entropy ingress key", () => {
    expect(() => createTrustedProxyMcpOAuthProvider({
      secret: "too-short",
      issuer: "deployment-ingress",
      audience: "goalkeeper-mcp-production",
      metadata,
      organizations: createOrganizationService(new MemoryOrganizationRepository())
    })).toThrow("MCP_OAUTH_PROXY_SECRET must contain at least 32 bytes");
  });

  test("does not allow deployments to extend the assertion lifetime boundary", () => {
    expect(() => createTrustedProxyMcpOAuthProvider({
      secret,
      issuer: "deployment-ingress",
      audience: "goalkeeper-mcp-production",
      metadata,
      organizations: createOrganizationService(new MemoryOrganizationRepository()),
      maximumAgeSeconds: 31
    })).toThrow("MCP OAuth proxy maximum age must be an integer from 1 to 30");
  });
});

async function sign(value: TrustedMcpOAuthAssertion) {
  const encoded = base64UrlEncode(JSON.stringify(value));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encoded)
  );
  return `${encoded}.${base64UrlEncode(signature)}`;
}

function base64UrlEncode(value: string | ArrayBuffer) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
