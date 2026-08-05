import { describe, expect, test } from "bun:test";
import { parseMcpPort } from "./config";

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
});
