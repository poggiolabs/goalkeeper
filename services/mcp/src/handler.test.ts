import { describe, expect, test } from "bun:test";
import {
  Client,
  InsufficientScopeError,
  StreamableHTTPClientTransport
} from "@modelcontextprotocol/client";
import { createApiTokenService } from "../../api/src/api-tokens/service";
import { createGoalService } from "../../api/src/goals/service";
import { createOrganizationService } from "../../api/src/organizations/service";
import { MemoryApiTokenRepository } from "../../../tests/helpers/memory-api-token-repository";
import { MemoryGoalRepository } from "../../../tests/helpers/memory-goal-repository";
import { MemoryOrganizationRepository } from "../../../tests/helpers/memory-organization-repository";
import type { McpOAuthProvider } from "./auth";
import { createGoalkeeperMcpHandler } from "./handler";

async function createHarness() {
  const organizationRepository = new MemoryOrganizationRepository();
  const organizations = createOrganizationService(organizationRepository);
  const apiTokens = createApiTokenService(new MemoryApiTokenRepository());
  const goals = createGoalService(new MemoryGoalRepository(), {
    isOrganizationMember: async (userId, organizationId) =>
      (await organizations.roleForUser(userId, organizationId)) !== null
  });
  const user = {
    id: "user-1",
    displayName: "MCP User",
    email: "mcp@example.com"
  };
  const organization = await organizations.ensureForUser(user);
  const handler = createGoalkeeperMcpHandler({
    apiTokens,
    goals,
    organizations,
    publicMcpUrl: "http://mcp.test/mcp",
    allowedHosts: ["mcp.test"],
    allowedOrigins: ["http://mcp.test"]
  });
  return {
    apiTokens,
    goals,
    organizations,
    user,
    organizationId: organization.activeOrganizationId,
    handler
  };
}

function fetchThrough(
  handler: { fetch(request: Request): Promise<Response> },
  input: string | URL | Request,
  init?: RequestInit
) {
  const request = new Request(input, init);
  const headers = new Headers(request.headers);
  headers.set("host", new URL(request.url).host);
  return handler.fetch(new Request(request, { headers }));
}

describe("Goalkeeper MCP server", () => {
  test("negotiates modern MCP and serves goal tools with API-token auth", async () => {
    const harness = await createHarness();
    const token = await harness.apiTokens.create(
      harness.user.id,
      harness.organizationId,
      {
        name: "MCP integration",
        scopes: ["goals:read", "goals:write"]
      }
    );
    const client = new Client(
      { name: "goalkeeper-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } }
    );
    const transport = new StreamableHTTPClientTransport(
      new URL("http://mcp.test/mcp"),
      {
        authProvider: { token: async () => token.secret },
        fetch: (input, init) => fetchThrough(harness.handler, input, init)
      }
    );

    try {
      await client.connect(transport);
      expect(client.getServerVersion()).toMatchObject({ name: "goalkeeper" });
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "list_goals",
          "create_goal",
          "update_goal",
          "list_goal_updates",
          "report_goal_update",
          "list_goal_labels"
        ])
      );

      const labelResult = await client.callTool({
        name: "create_goal_label",
        arguments: { name: "MCP" }
      });
      expect(labelResult.isError).not.toBe(true);
      const label = (labelResult.structuredContent as {
        label: { id: string };
      }).label;
      const createResult = await client.callTool({
        name: "create_goal",
        arguments: {
          detailedDescription: "Manage goals through a modern MCP server",
          criteria: [
            {
              title: "MCP access",
              description: "The goal is readable through MCP."
            }
          ],
          labelIds: [label.id]
        }
      });
      expect(createResult.isError).not.toBe(true);
      const goal = (createResult.structuredContent as {
        goal: { id: string };
      }).goal;

      const updateResult = await client.callTool({
        name: "report_goal_update",
        arguments: {
          goalId: goal.id,
          status: "completed",
          summary: "MCP contract complete",
          details: "The goal is readable and mutable through MCP.",
          expectedRevision: 1,
          idempotencyKey: "mcp-contract-complete"
        }
      });
      expect(updateResult.structuredContent).toMatchObject({
        update: {
          goalId: goal.id,
          revision: 2,
          status: "completed",
          authorityUserId: harness.user.id,
          actor: { kind: "client", id: token.token.id, runId: null },
          authentication: { kind: "api_token", subjectId: token.token.id },
          clientInfo: { name: "goalkeeper-test", version: "1.0.0" }
        }
      });

      const updatesResult = await client.callTool({
        name: "list_goal_updates",
        arguments: { goalId: goal.id }
      });
      expect(
        (updatesResult.structuredContent as { updates: unknown[] }).updates
      ).toHaveLength(2);

      const listResult = await client.callTool({
        name: "list_goals",
        arguments: {}
      });
      expect(listResult.structuredContent).toMatchObject({
        goals: [
          {
            detailedDescription: "Manage goals through a modern MCP server",
            criteria: [
              {
                title: "MCP access",
                description: "The goal is readable through MCP."
              }
            ],
            labels: [{ id: label.id, name: "MCP" }],
            status: "completed",
            revision: 2
          }
        ]
      });
    } finally {
      await client.close();
      await harness.handler.close();
    }
  });

  test("returns a modern OAuth scope challenge before tool dispatch", async () => {
    const harness = await createHarness();
    const token = await harness.apiTokens.create(
      harness.user.id,
      harness.organizationId,
      { name: "Read only", scopes: ["goals:read"] }
    );
    const client = new Client(
      { name: "goalkeeper-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } }
    );
    const transport = new StreamableHTTPClientTransport(
      new URL("http://mcp.test/mcp"),
      {
        authProvider: { token: async () => token.secret },
        fetch: (input, init) => fetchThrough(harness.handler, input, init)
      }
    );
    try {
      await client.connect(transport);
      await expect(
        client.callTool({
          name: "create_goal",
          arguments: { detailedDescription: "This must be denied" }
        })
      ).rejects.toBeInstanceOf(InsufficientScopeError);
    } finally {
      await client.close();
      await harness.handler.close();
    }
  });

  test("publishes RFC 9728 and provider DCR discovery metadata", async () => {
    const harness = await createHarness();
    const oauthProvider: McpOAuthProvider = {
      metadata: {
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        registration_endpoint: "https://auth.example.com/register",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        client_id_metadata_document_supported: true
      },
      async verifyAccessToken() {
        return null;
      }
    };
    const handler = createGoalkeeperMcpHandler({
      apiTokens: harness.apiTokens,
      goals: harness.goals,
      organizations: harness.organizations,
      publicMcpUrl: "https://mcp.example.com/mcp",
      oauthProvider
    });

    const protectedMetadata = await handler.fetch(
      new Request(
        "https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
      )
    );
    expect(protectedMetadata.status).toBe(200);
    expect(await protectedMetadata.json()).toMatchObject({
      resource: "https://mcp.example.com/mcp",
      authorization_servers: ["https://auth.example.com"],
      scopes_supported: [
        "goals:read",
        "goals:write",
        "goals:read:all",
        "goals:write:all"
      ]
    });

    const authorizationMetadata = await handler.fetch(
      new Request(
        "https://mcp.example.com/.well-known/oauth-authorization-server"
      )
    );
    expect(await authorizationMetadata.json()).toMatchObject({
      issuer: "https://auth.example.com",
      registration_endpoint: "https://auth.example.com/register",
      client_id_metadata_document_supported: true
    });

    const unauthorized = await handler.fetch(
      new Request("https://mcp.example.com/mcp", {
        method: "POST",
        headers: {
          host: "mcp.example.com",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "server/discover",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": {
                name: "test",
                version: "1.0.0"
              },
              "io.modelcontextprotocol/clientCapabilities": {}
            }
          }
        })
      })
    );
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"'
    );
    await handler.close();
    await harness.handler.close();
  });

  test("rejects an OAuth identity issued for another resource", async () => {
    const harness = await createHarness();
    const oauthProvider: McpOAuthProvider = {
      metadata: {
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        registration_endpoint: "https://auth.example.com/register",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"]
      },
      async verifyAccessToken() {
        return {
          userId: harness.user.id,
          organizationId: harness.organizationId,
          clientId: "test-client",
          scopes: ["goals:read"],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          resource: "https://other.example.com/mcp"
        };
      }
    };
    const handler = createGoalkeeperMcpHandler({
      apiTokens: harness.apiTokens,
      goals: harness.goals,
      organizations: harness.organizations,
      publicMcpUrl: "https://mcp.example.com/mcp",
      oauthProvider
    });
    const response = await handler.fetch(
      new Request("https://mcp.example.com/mcp", {
        method: "POST",
        headers: {
          host: "mcp.example.com",
          authorization: "Bearer oauth-token",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "server/discover",
          params: {
            _meta: {
              "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              "io.modelcontextprotocol/clientInfo": {
                name: "test",
                version: "1.0.0"
              },
              "io.modelcontextprotocol/clientCapabilities": {}
            }
          }
        })
      })
    );
    expect(response.status).toBe(401);
    await handler.close();
    await harness.handler.close();
  });

  test("accepts a provider-validated OAuth token for the exact MCP resource", async () => {
    const harness = await createHarness();
    const oauthProvider: McpOAuthProvider = {
      metadata: {
        issuer: "https://auth.example.com",
        authorization_endpoint: "https://auth.example.com/authorize",
        token_endpoint: "https://auth.example.com/token",
        registration_endpoint: "https://auth.example.com/register",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"]
      },
      async verifyAccessToken(token) {
        if (token !== "valid-oauth-token") return null;
        return {
          userId: harness.user.id,
          organizationId: harness.organizationId,
          clientId: "oauth-client",
          scopes: ["openid", "goals:read", "goals:write"],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          resource: "https://mcp.example.com/mcp",
          actor: {
            kind: "agent",
            id: "market-research-agent",
            runId: "run-7"
          }
        };
      }
    };
    const handler = createGoalkeeperMcpHandler({
      apiTokens: harness.apiTokens,
      goals: harness.goals,
      organizations: harness.organizations,
      publicMcpUrl: "https://mcp.example.com/mcp",
      oauthProvider
    });
    const client = new Client(
      { name: "goalkeeper-oauth-test", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } }
    );
    const transport = new StreamableHTTPClientTransport(
      new URL("https://mcp.example.com/mcp"),
      {
        authProvider: { token: async () => "valid-oauth-token" },
        fetch: (input, init) => fetchThrough(handler, input, init)
      }
    );
    try {
      await client.connect(transport);
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      const result = await client.callTool({
        name: "list_goals",
        arguments: {}
      });
      expect(result.structuredContent).toEqual({ goals: [] });
      const createResult = await client.callTool({
        name: "create_goal",
        arguments: { detailedDescription: "Verify OAuth agent attribution" }
      });
      const goal = (createResult.structuredContent as {
        goal: { id: string };
      }).goal;
      const updateResult = await client.callTool({
        name: "report_goal_update",
        arguments: {
          goalId: goal.id,
          status: "active",
          summary: "Research underway",
          details: "The agent completed the initial source review.",
          expectedRevision: 1,
          idempotencyKey: "run-7-source-review"
        }
      });
      expect(updateResult.structuredContent).toMatchObject({
        update: {
          authorityUserId: harness.user.id,
          actor: {
            kind: "agent",
            id: "market-research-agent",
            runId: "run-7"
          },
          authentication: { kind: "oauth", subjectId: "oauth-client" },
          clientInfo: {
            name: "goalkeeper-oauth-test",
            version: "1.0.0"
          }
        }
      });
    } finally {
      await client.close();
      await handler.close();
      await harness.handler.close();
    }
  });
});
