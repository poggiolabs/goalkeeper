import { describe, expect, test } from "bun:test";
import { parseMcpPort, parseMcpScopeList } from "./config";

describe("MCP configuration", () => {
  test("defaults and accepts valid TCP ports", () => {
    expect(parseMcpPort(undefined)).toBe(3002);
    expect(parseMcpPort("1")).toBe(1);
    expect(parseMcpPort("65535")).toBe(65_535);
  });

  test("rejects malformed and out-of-range ports", () => {
    for (const value of ["", "abc", "3002.5", "0", "65536"]) {
      expect(() => parseMcpPort(value)).toThrow(
        "MCP_PORT must be an integer between 1 and 65535"
      );
    }
  });

  test("parses and deduplicates RFC 6749 scope-token values", () => {
    expect(
      parseMcpScopeList(undefined, "MCP_OAUTH_INITIAL_SCOPES")
    ).toBeUndefined();
    expect(
      parseMcpScopeList(
        "goals:read, labels:write,goals:read",
        "MCP_OAUTH_INITIAL_SCOPES"
      )
    ).toEqual(["goals:read", "labels:write"]);
  });

  test("rejects scopes that are unsafe in OAuth challenge headers", () => {
    for (const value of [
      "",
      "goals:read labels:read",
      'goals:read\"',
      "goals:read\\labels:read",
      "goals:réad",
      "goals:read\nlabels:read"
    ]) {
      expect(() =>
        parseMcpScopeList(value, "MCP_OAUTH_INITIAL_SCOPES")
      ).toThrow(
        "MCP_OAUTH_INITIAL_SCOPES must be a comma-separated list of RFC 6749 scope-token values"
      );
    }
  });
});
