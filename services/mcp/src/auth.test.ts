import { describe, expect, test } from "bun:test";
import {
  assertOAuthProviderConfiguration,
  validateMcpResourceUrl,
  type McpOAuthProvider
} from "./auth";

function provider(
  issuer: string,
  registrationEndpoint?: string,
  endpoints: {
    authorization?: string;
    token?: string;
  } = {}
): McpOAuthProvider {
  return {
    metadata: {
      issuer,
      authorization_endpoint: endpoints.authorization ?? `${issuer}/authorize`,
      token_endpoint: endpoints.token ?? `${issuer}/token`,
      ...(registrationEndpoint
        ? { registration_endpoint: registrationEndpoint }
        : {}),
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"]
    },
    async verifyAccessToken() {
      return null;
    }
  };
}

describe("MCP OAuth provider configuration", () => {
  test("requires HTTPS for issuer and dynamic registration metadata", () => {
    expect(() =>
      assertOAuthProviderConfiguration(
        provider("http://auth.example.com", "https://auth.example.com/register"),
        false
      )
    ).toThrow("MCP OAuth issuer must use HTTPS");
    expect(() =>
      assertOAuthProviderConfiguration(
        provider("https://auth.example.com", "http://auth.example.com/register"),
        false
      )
    ).toThrow("MCP OAuth dynamic registration endpoint must use HTTPS");
  });

  test("requires absolute HTTPS authorization and token endpoints", () => {
    expect(() =>
      assertOAuthProviderConfiguration(
        provider("https://auth.example.com", undefined, {
          authorization: "http://auth.example.com/authorize"
        }),
        false
      )
    ).toThrow("MCP OAuth authorization endpoint must use HTTPS");
    expect(() =>
      assertOAuthProviderConfiguration(
        provider("https://auth.example.com", undefined, {
          token: "not-a-url"
        }),
        false
      )
    ).toThrow("MCP OAuth token endpoint must be a valid URL");
  });

  test("limits explicitly insecure provider metadata to HTTP loopback URLs", () => {
    expect(() =>
      assertOAuthProviderConfiguration(
        provider("http://auth.example.com", "https://auth.example.com/register"),
        true
      )
    ).toThrow("MCP OAuth issuer must use HTTPS");
    expect(() =>
      assertOAuthProviderConfiguration(
        provider("ftp://localhost", "http://localhost/register"),
        true
      )
    ).toThrow("MCP OAuth issuer must use HTTPS");
    expect(() =>
      assertOAuthProviderConfiguration(
        provider("http://localhost:3000", "http://127.0.0.1:3000/register"),
        true
      )
    ).not.toThrow();
    expect(() =>
      assertOAuthProviderConfiguration(
        provider("http://[::1]:3000", "http://[::1]:3000/register"),
        true
      )
    ).not.toThrow();
  });

  test("permits providers that use CIMD or pre-registered clients instead of DCR", () => {
    expect(() =>
      assertOAuthProviderConfiguration(
        provider("https://auth.example.com"),
        false
      )
    ).not.toThrow();
  });
});

describe("MCP resource identifiers", () => {
  test("requires HTTPS except for explicit loopback development", () => {
    expect(validateMcpResourceUrl("https://mcp.example.com/mcp").href).toBe(
      "https://mcp.example.com/mcp"
    );
    expect(validateMcpResourceUrl("http://localhost:3001/mcp").href).toBe(
      "http://localhost:3001/mcp"
    );
    expect(validateMcpResourceUrl("http://127.0.0.1:3001/mcp").href).toBe(
      "http://127.0.0.1:3001/mcp"
    );
    expect(validateMcpResourceUrl("http://[::1]:3001/mcp").href).toBe(
      "http://[::1]:3001/mcp"
    );

    expect(() =>
      validateMcpResourceUrl("http://mcp.example.com/mcp")
    ).toThrow("must use HTTPS outside loopback development");
    expect(() => validateMcpResourceUrl("ftp://localhost/mcp")).toThrow(
      "must use HTTPS outside loopback development"
    );
  });

  test("rejects fragments and embedded credentials", () => {
    expect(() =>
      validateMcpResourceUrl("https://mcp.example.com/mcp#other")
    ).toThrow("must not contain a fragment");
    expect(() =>
      validateMcpResourceUrl("https://user:secret@mcp.example.com/mcp")
    ).toThrow("must not contain credentials");
  });
});
