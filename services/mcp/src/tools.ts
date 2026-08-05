import {
  McpServer,
  type AuthInfo,
  type CallToolResult
} from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { ApiTokenError } from "../../api/src/api-tokens/service";
import { apiTokenScopes } from "../../api/src/api-tokens/types";
import {
  GoalError,
  type GoalAccess,
  type GoalService
} from "../../api/src/goals/service";
import { goalStatuses } from "../../api/src/goals/types";
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
        "Manage durable organization goals and their labels. Execution schedules are not part of this server."
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
        const access = await resolveAccess(input, "read");
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
        input.goals.getGoal(await resolveAccess(input, "read"), goalId)
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
        input.goals.createGoal(await resolveAccess(input, "write"), request)
      )
  );

  server.registerTool(
    "update_goal",
    {
      title: "Update goal",
      description:
        "Update goal description, criteria, state, ownership, or labels.",
      inputSchema: z
        .object({
          goalId: z.uuid(),
          title: z.string().min(1).max(200).optional(),
          detailedDescription: z.string().min(1).optional(),
          status: z.enum(goalStatuses).optional(),
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
          await resolveAccess(input, "write"),
          goalId,
          request
        )
      )
  );

  server.registerTool(
    "delete_goal",
    {
      title: "Delete goal",
      description: "Permanently delete a goal.",
      inputSchema: z.object({ goalId: z.uuid() }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false
      }
    },
    ({ goalId }) =>
      runTool(async () => {
        await input.goals.deleteGoal(await resolveAccess(input, "write"), goalId);
        return { deleted: true, goalId };
      })
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
        input.goals.listLabels(await resolveAccess(input, "read"))
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
        input.goals.getLabel(await resolveAccess(input, "read"), labelId)
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
        input.goals.createLabel(await resolveAccess(input, "write"), request)
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
          await resolveAccess(input, "write"),
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
          await resolveAccess(input, "write"),
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
  operation: "read" | "write"
): Promise<GoalAccess> {
  const principal = principalFromAuthInfo(input.authInfo);
  const role = await input.organizations.roleForUser(
    principal.userId,
    principal.organizationId
  );
  if (!role) {
    throw new ApiTokenError(
      "permission_denied",
      "The credential owner is no longer an organization member",
      403
    );
  }
  const ownScope = `goals:${operation}`;
  const allScope = `${ownScope}:all`;
  if (
    !input.authInfo.scopes.includes(ownScope) &&
    !input.authInfo.scopes.includes(allScope)
  ) {
    throw new ApiTokenError(
      "insufficient_scope",
      `This tool requires ${ownScope} or ${allScope}`,
      403
    );
  }
  return {
    userId: principal.userId,
    organizationId: principal.organizationId,
    readAll: operation === "read" && input.authInfo.scopes.includes(allScope),
    writeAll:
      operation === "write" &&
      input.authInfo.scopes.includes(allScope) &&
      (role === "owner" || role === "admin")
  };
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
    if (error instanceof GoalError || error instanceof ApiTokenError) {
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
