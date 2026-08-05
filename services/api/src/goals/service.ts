import type {
  Goal,
  GoalLabel,
  GoalLabelRecord,
  GoalRecord,
  GoalRepository,
  GoalStatus
} from "./types";
import { GoalRepositoryError, goalStatuses } from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumLabelsPerGoal = 20;

export class GoalError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "GoalError";
  }
}

export type GoalService = ReturnType<typeof createGoalService>;

export type GoalAccess = {
  userId: string;
  organizationId: string;
  readAll: boolean;
  writeAll: boolean;
};

export function createGoalService(
  repository: GoalRepository,
  options: {
    isOrganizationMember: (
      userId: string,
      organizationId: string
    ) => boolean | Promise<boolean>;
  }
) {
  return {
    async listGoals(access: GoalAccess, searchParams: URLSearchParams) {
      const filters = normalizeGoalFilters(searchParams);
      const records = await repository.listGoals({
        organizationId: access.organizationId,
        ownerUserId: access.readAll ? filters.ownerUserId : access.userId,
        status: filters.status,
        labelId: filters.labelId
      });
      return { goals: records.map(toGoal) };
    },

    async getGoal(access: GoalAccess, goalId: string): Promise<{ goal: Goal }> {
      const record = await repository.getGoal(
        access.organizationId,
        normalizeId(goalId, "goal")
      );
      if (!record || (!access.readAll && record.ownerUserId !== access.userId)) {
        throw notFound("goal");
      }
      return { goal: toGoal(record) };
    },

    async createGoal(access: GoalAccess, request: unknown): Promise<{ goal: Goal }> {
      const input = normalizeGoalCreate(request, access.userId);
      if (input.ownerUserId !== access.userId && !access.writeAll) {
        throw new GoalError(
          "goal_owner_forbidden",
          "Writing goals owned by another member requires all-goals access",
          403
        );
      }
      await requireMember(options, input.ownerUserId, access.organizationId);
      const record = await goalRepositoryOperation(() =>
        repository.insertGoal(
          {
            organizationId: access.organizationId,
            title: input.title ?? generateGoalTitle(input.prompt),
            prompt: input.prompt,
            status: "active",
            ownerUserId: input.ownerUserId,
            measurementMethod: input.measurementMethod,
            createdBy: access.userId,
            updatedBy: access.userId
          },
          input.labelIds
        )
      );
      return { goal: toGoal(record) };
    },

    async updateGoal(
      access: GoalAccess,
      goalId: string,
      request: unknown
    ): Promise<{ goal: Goal }> {
      const input = normalizeGoalUpdate(request);
      const existing = await repository.getGoal(
        access.organizationId,
        normalizeId(goalId, "goal")
      );
      if (!existing || (!access.writeAll && existing.ownerUserId !== access.userId)) {
        throw notFound("goal");
      }
      const ownerUserId = input.ownerUserId ?? existing.ownerUserId;
      if (ownerUserId !== existing.ownerUserId && !access.writeAll) {
        throw new GoalError(
          "goal_owner_forbidden",
          "Changing a goal owner requires all-goals access",
          403
        );
      }
      if (input.ownerUserId) {
        await requireMember(options, ownerUserId, access.organizationId);
      }
      const record = await goalRepositoryOperation(() =>
        repository.updateGoal({
          organizationId: access.organizationId,
          goalId: existing.id,
          actorUserId: access.userId,
          allowAll: access.writeAll,
          update: {
            title: input.title ?? existing.title,
            prompt: input.prompt ?? existing.prompt,
            status: input.status ?? existing.status,
            ownerUserId,
            measurementMethod:
              input.measurementMethod === undefined
                ? existing.measurementMethod
                : input.measurementMethod,
            updatedBy: access.userId
          },
          labelIds: input.labelIds
        })
      );
      if (!record) throw notFound("goal");
      return { goal: toGoal(record) };
    },

    async deleteGoal(access: GoalAccess, goalId: string): Promise<void> {
      const deleted = await repository.deleteGoal({
        organizationId: access.organizationId,
        goalId: normalizeId(goalId, "goal"),
        actorUserId: access.userId,
        allowAll: access.writeAll
      });
      if (!deleted) throw notFound("goal");
    },

    async listLabels(access: GoalAccess): Promise<{ labels: GoalLabel[] }> {
      return {
        labels: (await repository.listLabels(access.organizationId)).map(toLabel)
      };
    },

    async getLabel(
      access: GoalAccess,
      labelId: string
    ): Promise<{ label: GoalLabel }> {
      const record = await repository.getLabel(
        access.organizationId,
        normalizeId(labelId, "label")
      );
      if (!record) throw notFound("label");
      return { label: toLabel(record) };
    },

    async createLabel(
      access: GoalAccess,
      request: unknown
    ): Promise<{ label: GoalLabel }> {
      const input = normalizeLabelCreate(request);
      const record = await repository.insertLabel({
        organizationId: access.organizationId,
        ...input,
        createdBy: access.userId,
        updatedBy: access.userId
      });
      if (!record) {
        throw new GoalError(
          "goal_label_exists",
          "A goal label with this name already exists",
          409
        );
      }
      return { label: toLabel(record) };
    },

    async updateLabel(
      access: GoalAccess,
      labelId: string,
      request: unknown
    ): Promise<{ label: GoalLabel }> {
      const id = normalizeId(labelId, "label");
      const existing = await repository.getLabel(access.organizationId, id);
      if (!existing) throw notFound("label");
      const input = normalizeLabelUpdate(request);
      const record = await repository.updateLabel({
        organizationId: access.organizationId,
        labelId: id,
        name: input.name ?? existing.name,
        color: input.color === undefined ? existing.color : input.color,
        description:
          input.description === undefined
            ? existing.description
            : input.description,
        updatedBy: access.userId
      });
      if (record === "conflict") {
        throw new GoalError(
          "goal_label_exists",
          "A goal label with this name already exists",
          409
        );
      }
      if (!record) throw notFound("label");
      return { label: toLabel(record) };
    },

    async deleteLabel(access: GoalAccess, labelId: string): Promise<void> {
      const result = await repository.deleteLabel(
        access.organizationId,
        normalizeId(labelId, "label")
      );
      if (result === "not_found") throw notFound("label");
      if (result === "in_use") {
        throw new GoalError(
          "goal_label_in_use",
          "Remove this label from goals before deleting it",
          409
        );
      }
    }
  };
}

async function requireMember(
  options: {
    isOrganizationMember: (
      userId: string,
      organizationId: string
    ) => boolean | Promise<boolean>;
  },
  userId: string,
  organizationId: string
) {
  if (!(await options.isOrganizationMember(userId, organizationId))) {
    throw new GoalError(
      "invalid_goal_owner",
      "Goal owner must be an active organization member"
    );
  }
}

function normalizeGoalCreate(request: unknown, defaultOwnerUserId: string) {
  const candidate = objectWithKeys(request, [
    "title",
    "prompt",
    "ownerUserId",
    "labelIds",
    "measurementMethod"
  ]);
  return {
    title:
      candidate.title === undefined
        ? null
        : requiredString(candidate.title, "goal title", 200),
    prompt: requiredString(candidate.prompt, "goal prompt", 50_000, false),
    ownerUserId:
      candidate.ownerUserId === undefined
        ? defaultOwnerUserId
        : requiredString(candidate.ownerUserId, "goal owner", 200),
    labelIds: labelIds(candidate.labelIds),
    measurementMethod: optionalNullableString(
      candidate.measurementMethod,
      "measurement method",
      10_000
    )
  };
}

function normalizeGoalUpdate(request: unknown) {
  const candidate = objectWithKeys(request, [
    "title",
    "prompt",
    "status",
    "ownerUserId",
    "labelIds",
    "measurementMethod"
  ]);
  if (Object.keys(candidate).length === 0) {
    throw new GoalError("empty_goal_update", "At least one update field is required");
  }
  return {
    title:
      candidate.title === undefined
        ? undefined
        : requiredString(candidate.title, "goal title", 200),
    prompt:
      candidate.prompt === undefined
        ? undefined
        : requiredString(candidate.prompt, "goal prompt", 50_000, false),
    status:
      candidate.status === undefined ? undefined : goalStatus(candidate.status),
    ownerUserId:
      candidate.ownerUserId === undefined
        ? undefined
        : requiredString(candidate.ownerUserId, "goal owner", 200),
    labelIds:
      candidate.labelIds === undefined ? null : labelIds(candidate.labelIds),
    measurementMethod:
      candidate.measurementMethod === undefined
        ? undefined
        : optionalNullableString(
            candidate.measurementMethod,
            "measurement method",
            10_000
          )
  };
}

function normalizeLabelCreate(request: unknown) {
  const candidate = objectWithKeys(request, ["name", "color", "description"]);
  return {
    name: requiredString(candidate.name, "label name", 64),
    color: optionalNullableString(candidate.color, "label color", 32),
    description: optionalNullableString(
      candidate.description,
      "label description",
      500
    )
  };
}

function normalizeLabelUpdate(request: unknown) {
  const candidate = objectWithKeys(request, ["name", "color", "description"]);
  if (Object.keys(candidate).length === 0) {
    throw new GoalError(
      "empty_goal_label_update",
      "At least one update field is required"
    );
  }
  return {
    name:
      candidate.name === undefined
        ? undefined
        : requiredString(candidate.name, "label name", 64),
    color:
      candidate.color === undefined
        ? undefined
        : optionalNullableString(candidate.color, "label color", 32),
    description:
      candidate.description === undefined
        ? undefined
        : optionalNullableString(
            candidate.description,
            "label description",
            500
          )
  };
}

function normalizeGoalFilters(searchParams: URLSearchParams): {
  status: GoalStatus | null;
  ownerUserId: string | null;
  labelId: string | null;
} {
  const status = searchParams.get("status");
  const ownerUserId = searchParams.get("ownerUserId");
  const labelId = searchParams.get("labelId");
  return {
    status: status === null ? null : goalStatus(status),
    ownerUserId:
      ownerUserId === null
        ? null
        : requiredString(ownerUserId, "goal owner", 200),
    labelId: labelId === null ? null : normalizeId(labelId, "label")
  };
}

function objectWithKeys(
  request: unknown,
  allowedKeys: string[]
): Record<string, unknown> {
  if (!request || typeof request !== "object" || Array.isArray(request)) {
    throw new GoalError("invalid_goal_request", "Request body must be an object");
  }
  const candidate = request as Record<string, unknown>;
  const unknown = Object.keys(candidate).find((key) => !allowedKeys.includes(key));
  if (unknown) {
    throw new GoalError(
      "invalid_goal_request",
      `Unsupported request field: ${unknown}`
    );
  }
  return candidate;
}

function requiredString(
  value: unknown,
  field: string,
  maximumLength: number,
  trim = true
): string {
  if (typeof value !== "string" || !value.trim() || value.length > maximumLength) {
    throw new GoalError(
      "invalid_goal_request",
      `${field} must contain 1-${maximumLength} characters`
    );
  }
  return trim ? value.trim() : value;
}

function optionalNullableString(
  value: unknown,
  field: string,
  maximumLength: number
): string | null {
  if (value === undefined || value === null) return null;
  return requiredString(value, field, maximumLength);
}

function labelIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumLabelsPerGoal) {
    throw new GoalError(
      "invalid_goal_labels",
      `labelIds must contain at most ${maximumLabelsPerGoal} label IDs`
    );
  }
  const ids = [...new Set(value.map((id) => normalizeId(id, "label")))];
  return ids;
}

function goalStatus(value: unknown): GoalStatus {
  if (
    typeof value !== "string" ||
    !(goalStatuses as readonly string[]).includes(value)
  ) {
    throw new GoalError(
      "invalid_goal_status",
      `Goal status must be one of: ${goalStatuses.join(", ")}`
    );
  }
  return value as GoalStatus;
}

function normalizeId(value: unknown, resource: "goal" | "label"): string {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw notFound(resource);
  }
  return value;
}

function notFound(resource: "goal" | "label") {
  return new GoalError(
    resource === "goal" ? "goal_not_found" : "goal_label_not_found",
    resource === "goal" ? "Goal not found" : "Goal label not found",
    404
  );
}

async function goalRepositoryOperation<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof GoalRepositoryError && error.code === "invalid_labels") {
      throw new GoalError(
        "invalid_goal_labels",
        "Every label must belong to the active organization"
      );
    }
    throw error;
  }
}

function generateGoalTitle(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, " ").trim();
  const sentence = (normalized.split(/\.\s/, 1)[0] || normalized).replace(
    /[.!?]+$/,
    ""
  );
  if (sentence.length <= 72) return sentence;
  const candidate = sentence.slice(0, 71);
  const prefix = candidate.replace(/\s+\S*$/, "").replace(/[ ,;:-]+$/, "");
  return `${prefix || candidate.trimEnd()}…`;
}

function toGoal(record: GoalRecord): Goal {
  return {
    ...record,
    labels: record.labels.map(toLabel),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}

function toLabel(record: GoalLabelRecord): GoalLabel {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  };
}
