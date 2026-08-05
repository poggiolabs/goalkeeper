import { describe, expect, test } from "bun:test";
import {
  assertOAuthProviderConfiguration,
  type McpOAuthProvider
} from "./auth";

function provider(
  issuer: string,
  registrationEndpoint: string
): McpOAuthProvider {
  return {
    metadata: {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: registrationEndpoint,
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
});
