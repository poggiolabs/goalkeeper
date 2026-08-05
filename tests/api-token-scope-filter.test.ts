import { describe, expect, test } from "bun:test";
import {
  filterScopes,
  fuzzyMatchesScope
} from "../apps/web/src/lib/api-token-scopes";

const scopes = [
  { id: "goals:read", description: "Read goals owned by the token owner." },
  {
    id: "goals:read:all",
    description: "Read every goal visible to the token owner."
  },
  {
    id: "billing:write",
    description: "Manage subscription billing."
  }
];

describe("API token scope filtering", () => {
  test("sorts scopes asciibetically without mutating the registry", () => {
    expect(filterScopes(scopes, "")).toEqual([
      scopes[2],
      scopes[0],
      scopes[1]
    ]);
    expect(scopes[0]?.id).toBe("goals:read");
  });

  test("fuzzy matches identifier and description subsequences", () => {
    expect(fuzzyMatchesScope(scopes[1]!, "grall")).toBe(true);
    expect(fuzzyMatchesScope(scopes[1]!, "evry visbl")).toBe(true);
    expect(fuzzyMatchesScope(scopes[0]!, "billing")).toBe(false);
  });

  test("returns a flat filtered list", () => {
    expect(filterScopes(scopes, "sub bill")).toEqual([scopes[2]]);
  });
});
