import { afterEach, describe, expect, test } from "bun:test";
import {
  createOrganization,
  listApiTokens,
  listOrganizationMembers,
  loginWithEmail,
  switchOrganization,
  subscribeToAuthUnauthorized,
  updateOrganizationMemberRole,
  updateOrganizationName
} from "../apps/web/src/auth-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("web authentication client", () => {
  test("preserves invalid-credential messages from email login", async () => {
    globalThis.fetch = async () =>
      Response.json(
        {
          error: "invalid_credentials",
          message: "Invalid email or password"
        },
        { status: 401 }
      );

    await expect(
      loginWithEmail("http://localhost:3001", {
        email: "user@example.com",
        password: "incorrect password",
        returnTo: "http://localhost:3000/account"
      })
    ).rejects.toThrow("Invalid email or password");
  });

  test("notifies shared auth state when an authenticated request returns 401", async () => {
    let notifications = 0;
    const unsubscribe = subscribeToAuthUnauthorized(() => {
      notifications += 1;
    });
    globalThis.fetch = async () =>
      Response.json({ error: "unauthorized" }, { status: 401 });

    try {
      await expect(listApiTokens("http://localhost:3001")).rejects.toThrow(
        "Authentication is required."
      );
      expect(notifications).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  test("creates and switches organizations with credentialed requests", async () => {
    const organizationId = crypto.randomUUID();
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: input.toString(), init });
      return Response.json({
        activeOrganizationId: organizationId,
        organizations: [
          { id: organizationId, name: "Example", role: "owner" }
        ]
      });
    };

    await createOrganization("http://localhost:3001", "Example");
    await switchOrganization("http://localhost:3001", organizationId);

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: "http://localhost:3001/v1/organizations",
      init: {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ name: "Example" })
      }
    });
    expect(requests[1]).toMatchObject({
      url: "http://localhost:3001/v1/organizations/switch",
      init: {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ organizationId })
      }
    });
  });

  test("updates organization details and member roles", async () => {
    const userId = "user/with path chars";
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = async (input, init) => {
      requests.push({ url: input.toString(), init });
      if (input.toString().endsWith("/members")) {
        return Response.json({
          members: [
            {
              userId,
              displayName: "Team Member",
              email: "member@example.com",
              role: "member"
            }
          ]
        });
      }
      if (input.toString().includes("/members/")) {
        return Response.json({
          member: {
            userId,
            displayName: "Team Member",
            email: "member@example.com",
            role: "admin"
          }
        });
      }
      return Response.json({
        activeOrganizationId: crypto.randomUUID(),
        organizations: []
      });
    };

    await updateOrganizationName("http://localhost:3001", "Renamed");
    await listOrganizationMembers("http://localhost:3001");
    await updateOrganizationMemberRole(
      "http://localhost:3001",
      userId,
      "admin"
    );

    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      url: "http://localhost:3001/v1/organizations/current",
      init: {
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({ name: "Renamed" })
      }
    });
    expect(requests[1]).toMatchObject({
      url: "http://localhost:3001/v1/organizations/current/members",
      init: { credentials: "include" }
    });
    expect(requests[2]).toMatchObject({
      url: "http://localhost:3001/v1/organizations/current/members/user%2Fwith%20path%20chars",
      init: {
        method: "PATCH",
        credentials: "include",
        body: JSON.stringify({ role: "admin" })
      }
    });
  });
});
