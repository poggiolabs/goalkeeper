import {
  McpServer,
  type AuthInfo,
  type CallToolResult
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { apiTokenScopes } from "../../api/src/api-tokens/types";
import { resolveScopedGoalAccess } from "../../api/src/goals/access";
import {
  GoalError,
  type GoalAccess,
  type GoalService
} from "../../api/src/goals/service";
import {
  goalStatuses,
  type GoalClientInfo
} from "../../api/src/goals/types";
import type { OrganizationService } from "../../api/src/organizations/service";
import { principalFromAuthInfo } from "./auth";

const goalCriterionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(10_000)
});

export function createGoalkeeperMcpServer(input: {
  authInfo: AuthInfo;
  goals: GoalService;
  organizations: OrganizationService;
}): McpServer {
  const server = new McpServer(
    { name: "goalkeeper", version: "0.0.0" },
    {
      instructions:
        "Manage durable organization goals, append-only status updates, and labels."
    }
  );

  server.registerTool(
    "list_goals",
    {
      title: "List goals",
      description: "List goals visible to the authenticated principal.",
      inputSchema: z.object({
        status: z.enum(goalStatuses).optional(),
        ownerUserId: z.string().min(1).max(200).optional(),
        labelId: z.uuid().optional()
      }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    ({ status, ownerUserId, labelId }) =>
      runTool(async () => {
        const access = await resolveAccess(input, server, "read");
        const filters = new URLSearchParams();
        if (status) filters.set("status", status);
        if (ownerUserId) filters.set("ownerUserId", ownerUserId);
        if (labelId) filters.set("labelId", labelId);
        return input.goals.listGoals(access, filters);
      })
  );

  server.registerTool(
    "get_goal",
    {
      title: "Get goal",
      description: "Get one goal by ID.",
      inputSchema: z.object({ goalId: z.uuid() }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    ({ goalId }) =>
      runTool(async () =>
        input.goals.getGoal(await resolveAccess(input, server, "read"), goalId)
      )
  );

  server.registerTool(
    "create_goal",
    {
      title: "Create goal",
      description: "Create an active durable goal.",
      inputSchema: z.object({
        detailedDescription: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        ownerUserId: z.string().min(1).max(200).optional(),
        labelIds: z.array(z.uuid()).max(20).optional(),
        criteria: z.array(goalCriterionSchema).max(100).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    (request) =>
      runTool(async () =>
        input.goals.createGoal(
          await resolveAccess(input, server, "write"),
          request
        )
      )
  );

  server.registerTool(
    "update_goal",
    {
      title: "Update goal",
      description:
        "Update goal description, criteria, ownership, or labels. Use report_goal_update to change status.",
      inputSchema: z
        .object({
          goalId: z.uuid(),
          title: z.string().min(1).max(200).optional(),
          detailedDescription: z.string().min(1).optional(),
          ownerUserId: z.string().min(1).max(200).optional(),
          labelIds: z.array(z.uuid()).max(20).optional(),
          criteria: z.array(goalCriterionSchema).max(100).optional()
        })
        .refine(
          ({ goalId: _goalId, ...update }) =>
            Object.values(update).some((value) => value !== undefined),
          { message: "At least one update field is required" }
        ),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    ({ goalId, ...request }) =>
      runTool(async () =>
        input.goals.updateGoal(
          await resolveAccess(input, server, "write"),
          goalId,
          request
        )
      )
  );

  server.registerTool(
    "list_goal_updates",
    {
      title: "List goal updates",
      description: "List a goal's append-only status history.",
      inputSchema: z.object({ goalId: z.uuid() }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    ({ goalId }) =>
      runTool(async () =>
        input.goals.listUpdates(
          await resolveAccess(input, server, "read"),
          goalId
        )
      )
  );

  server.registerTool(
    "report_goal_update",
    {
      title: "Report goal update",
      description:
        "Append a status report and atomically advance the goal's status and revision.",
      inputSchema: z.object({
        goalId: z.uuid(),
        status: z.enum(goalStatuses),
        summary: z.string().min(1).max(500),
        details: z.string().min(1),
        expectedRevision: z.number().int().positive(),
        idempotencyKey: z.string().min(1).max(200)
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true
      }
    },
    ({ goalId, ...request }) =>
      runTool(async () =>
        input.goals.reportUpdate(
          await resolveAccess(input, server, "write"),
          goalId,
          request
        )
      )
  );

  server.registerTool(
    "list_goal_labels",
    {
      title: "List goal labels",
      description: "List the organization's goal labels.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    () =>
      runTool(async () =>
        input.goals.listLabels(await resolveAccess(input, server, "read"))
      )
  );

  server.registerTool(
    "get_goal_label",
    {
      title: "Get goal label",
      description: "Get one goal label by ID.",
      inputSchema: z.object({ labelId: z.uuid() }),
      annotations: { readOnlyHint: true, idempotentHint: true }
    },
    ({ labelId }) =>
      runTool(async () =>
        input.goals.getLabel(
          await resolveAccess(input, server, "read"),
          labelId
        )
      )
  );

  server.registerTool(
    "create_goal_label",
    {
      title: "Create goal label",
      description: "Create an organization goal label.",
      inputSchema: z.object({
        name: z.string().min(1).max(64),
        color: z.string().min(1).max(32).nullable().optional(),
        description: z.string().min(1).max(500).nullable().optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    (request) =>
      runTool(async () =>
        input.goals.createLabel(
          await resolveAccess(input, server, "write"),
          request
        )
      )
  );

  server.registerTool(
    "update_goal_label",
    {
      title: "Update goal label",
      description: "Rename or update an organization goal label.",
      inputSchema: z
        .object({
          labelId: z.uuid(),
          name: z.string().min(1).max(64).optional(),
          color: z.string().min(1).max(32).nullable().optional(),
          description: z.string().min(1).max(500).nullable().optional()
        })
        .refine(
          ({ labelId: _labelId, ...update }) =>
            Object.values(update).some((value) => value !== undefined),
          { message: "At least one update field is required" }
        ),
      annotations: { readOnlyHint: false, destructiveHint: false }
    },
    ({ labelId, ...request }) =>
      runTool(async () =>
        input.goals.updateLabel(
          await resolveAccess(input, server, "write"),
          labelId,
          request
        )
      )
  );

  server.registerTool(
    "delete_goal_label",
    {
      title: "Delete goal label",
      description: "Delete an unassigned organization goal label.",
      inputSchema: z.object({ labelId: z.uuid() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false
      }
    },
    ({ labelId }) =>
      runTool(async () => {
        await input.goals.deleteLabel(
          await resolveAccess(input, server, "write"),
          labelId
        );
        return { deleted: true, labelId };
      })
  );

  return server;
}

async function resolveAccess(
  input: {
    authInfo: AuthInfo;
    organizations: OrganizationService;
  },
  server: McpServer,
  operation: "read" | "write"
): Promise<GoalAccess> {
  const principal = principalFromAuthInfo(input.authInfo);
  return resolveScopedGoalAccess({
    principal: {
      userId: principal.userId,
      organizationId: principal.organizationId,
      scopes: input.authInfo.scopes,
      actor: principal.actor,
      authentication: principal.authentication,
      clientInfo: clientInfoFrom(server)
    },
    operation,
    roleForUser: (userId, organizationId) =>
      input.organizations.roleForUser(userId, organizationId)
  });
}

function clientInfoFrom(server: McpServer): GoalClientInfo | null {
  const implementation = server.server.getClientVersion();
  if (!implementation) return null;
  const name = implementation.name.trim().slice(0, 200);
  const version = implementation.version.trim().slice(0, 100);
  return name && version ? { name, version } : null;
}

async function runTool(operation: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const result = await operation();
    const structuredContent = asObject(result);
    return {
      content: [{ type: "text", text: JSON.stringify(structuredContent) }],
      structuredContent
    };
  } catch (error) {
    if (error instanceof GoalError) {
      const structuredContent = {
        error: error.code,
        message: error.message,
        status: error.status
      };
      return {
        isError: true,
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent
      };
    }
    throw error;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { result: value };
}

export const mcpGoalScopes = apiTokenScopes;
