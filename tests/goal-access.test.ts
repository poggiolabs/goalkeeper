import { describe, expect, test } from "bun:test";
import {
  resolveScopedGoalAccess,
  type ScopedGoalPrincipal
} from "../services/api/src/goals/access";

const principal: ScopedGoalPrincipal = {
  userId: "user-1",
  organizationId: "organization-1",
  scopes: ["goals:read", "goals:write"],
  actor: { kind: "client", id: "client-1", runId: null },
  authentication: { kind: "oauth", subjectId: "client-1" },
  clientInfo: { name: "test-client", version: "1.0.0" }
};

describe("scoped goal access", () => {
  test("requires both a goal scope and live organization membership", async () => {
    await expect(
      resolveScopedGoalAccess({
        principal: { ...principal, scopes: [] },
        scopeNamespace: "goals",
        operation: "read",
        roleForUser: () => "member"
      })
    ).rejects.toMatchObject({ code: "insufficient_scope", status: 403 });

    await expect(
      resolveScopedGoalAccess({
        principal,
        scopeNamespace: "goals",
        operation: "read",
        roleForUser: () => null
      })
    ).rejects.toMatchObject({ code: "permission_denied", status: 403 });
  });

  test("allows read-all for members but reserves write-all for administrators", async () => {
    await expect(
      resolveScopedGoalAccess({
        principal: { ...principal, scopes: ["goals:read:all"] },
        scopeNamespace: "goals",
        operation: "read",
        roleForUser: () => "member"
      })
    ).resolves.toMatchObject({ readAll: true, writeAll: false });

    await expect(
      resolveScopedGoalAccess({
        principal: { ...principal, scopes: ["goals:write:all"] },
        scopeNamespace: "goals",
        operation: "write",
        roleForUser: () => "member"
      })
    ).resolves.toMatchObject({ readAll: false, writeAll: false });

    await expect(
      resolveScopedGoalAccess({
        principal: { ...principal, scopes: ["goals:write:all"] },
        scopeNamespace: "goals",
        operation: "write",
        roleForUser: () => "admin"
      })
    ).resolves.toMatchObject({ readAll: false, writeAll: true });
  });

  test("preserves the verified actor, authentication, and client attribution", async () => {
    await expect(
      resolveScopedGoalAccess({
        principal,
        scopeNamespace: "goals",
        operation: "write",
        roleForUser: () => "owner"
      })
    ).resolves.toMatchObject({
      actor: principal.actor,
      authentication: principal.authentication,
      clientInfo: principal.clientInfo
    });
  });

  test("requires dedicated label scopes without all-access variants", async () => {
    await expect(
      resolveScopedGoalAccess({
        principal: { ...principal, scopes: ["goals:read:all"] },
        scopeNamespace: "labels",
        operation: "read",
        roleForUser: () => "admin"
      })
    ).rejects.toMatchObject({ code: "insufficient_scope", status: 403 });

    await expect(
      resolveScopedGoalAccess({
        principal: { ...principal, scopes: ["labels:read"] },
        scopeNamespace: "labels",
        operation: "read",
        roleForUser: () => "member"
      })
    ).resolves.toMatchObject({ readAll: false, writeAll: false });

    await expect(
      resolveScopedGoalAccess({
        principal: { ...principal, scopes: ["labels:write"] },
        scopeNamespace: "labels",
        operation: "write",
        roleForUser: () => "member"
      })
    ).resolves.toMatchObject({ readAll: false, writeAll: false });
  });
});
