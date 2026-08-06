import type {
  Goal,
  GoalActor,
  GoalAuthentication,
  GoalClientInfo,
  GoalCriterion,
  GoalEvaluation,
  GoalHealth,
  GoalLabel,
  GoalLabelRecord,
  GoalRecord,
  GoalRepository,
  GoalStatusUpdateRecord,
  GoalStatus,
  GoalTimeframe
} from "./types";
import {
  GoalRepositoryError,
  goalEvaluationResults,
  goalHealthValues,
  goalStatuses
} from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const maximumLabelsPerGoal = 20;
const maximumCriteriaPerGoal = 100;

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
  actor: GoalActor;
  authentication: GoalAuthentication;
  clientInfo: GoalClientInfo | null;
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
        health: filters.health,
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
      if (input.ownerUserId) {
        await requireMember(options, input.ownerUserId, access.organizationId);
      }
      const record = await goalRepositoryOperation(() =>
        repository.insertGoal(
          {
            organizationId: access.organizationId,
            title: input.title ?? generateGoalTitle(input.detailedDescription),
            detailedDescription: input.detailedDescription,
            status: input.status,
            health: null,
            timeframe: input.timeframe,
            currentEvaluation: null,
            ownerUserId: input.ownerUserId,
            criteria: input.criteria,
            revision: 1,
            createdByUserId: access.userId,
            updatedByUserId: access.userId
          },
          input.labelIds,
          attributionFor(access)
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
      const ownerUserId =
        input.ownerUserId === undefined
          ? existing.ownerUserId
          : input.ownerUserId;
      if (ownerUserId !== existing.ownerUserId && !access.writeAll) {
        throw new GoalError(
          "goal_owner_forbidden",
          "Changing a goal owner requires all-goals access",
          403
        );
      }
      if (input.ownerUserId !== undefined && ownerUserId) {
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
            detailedDescription:
              input.detailedDescription ?? existing.detailedDescription,
            timeframe: input.timeframe ?? existing.timeframe,
            ownerUserId,
            criteria: input.criteria ?? existing.criteria,
            updatedByUserId: access.userId
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

    async listUpdates(access: GoalAccess, goalId: string) {
      const existing = await repository.getGoal(
        access.organizationId,
        normalizeId(goalId, "goal")
      );
      if (!existing || (!access.readAll && existing.ownerUserId !== access.userId)) {
        throw notFound("goal");
      }
      return {
        updates: (
          await repository.listUpdates({
            organizationId: access.organizationId,
            goalId: existing.id
          })
        ).map(toGoalUpdate)
      };
    },

    async reportUpdate(access: GoalAccess, goalId: string, request: unknown) {
      const input = normalizeGoalStatusUpdate(request);
      const existing = await repository.getGoal(
        access.organizationId,
        normalizeId(goalId, "goal")
      );
      if (!existing || (!access.writeAll && existing.ownerUserId !== access.userId)) {
        throw notFound("goal");
      }
      const update = await goalRepositoryOperation(() =>
        repository.appendUpdate({
          organizationId: access.organizationId,
          goalId: existing.id,
          actorUserId: access.userId,
          allowAll: access.writeAll,
          expectedRevision: input.expectedRevision,
          status: input.status,
          health: input.health,
          evaluation:
            input.evaluation === null
              ? null
              : {
                  result: input.evaluation.result,
                  asOf: new Date(input.evaluation.asOf)
                },
          summary: input.summary,
          details: input.details,
          idempotencyKey: input.idempotencyKey,
          attribution: attributionFor(access)
        })
      );
      return { update: toGoalUpdate(update) };
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
        createdByUserId: access.userId,
        updatedByUserId: access.userId
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
        updatedByUserId: access.userId
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
    "detailedDescription",
    "timeframe",
    "ownerUserId",
    "labelIds",
    "criteria"
  ]);
  return {
    title:
      candidate.title === undefined
        ? null
        : requiredString(candidate.title, "goal title", 200),
    detailedDescription: requiredLongText(
      candidate.detailedDescription,
      "goal detailed description"
    ),
    status: "active" as const,
    timeframe: goalTimeframe(candidate.timeframe, false),
    ownerUserId:
      candidate.ownerUserId === undefined
        ? defaultOwnerUserId
        : optionalOwnerUserId(candidate.ownerUserId),
    labelIds: labelIds(candidate.labelIds),
    criteria: goalCriteria(candidate.criteria)
  };
}

function normalizeGoalUpdate(request: unknown) {
  const candidate = objectWithKeys(request, [
    "title",
    "detailedDescription",
    "timeframe",
    "ownerUserId",
    "labelIds",
    "criteria"
  ]);
  if (Object.keys(candidate).length === 0) {
    throw new GoalError("empty_goal_update", "At least one update field is required");
  }
  return {
    title:
      candidate.title === undefined
        ? undefined
        : requiredString(candidate.title, "goal title", 200),
    detailedDescription:
      candidate.detailedDescription === undefined
        ? undefined
        : requiredLongText(
            candidate.detailedDescription,
            "goal detailed description"
          ),
    timeframe:
      candidate.timeframe === undefined
        ? undefined
        : goalTimeframe(candidate.timeframe, true),
    ownerUserId:
      candidate.ownerUserId === undefined
        ? undefined
        : optionalOwnerUserId(candidate.ownerUserId),
    labelIds:
      candidate.labelIds === undefined ? null : labelIds(candidate.labelIds),
    criteria:
      candidate.criteria === undefined
        ? undefined
        : goalCriteria(candidate.criteria)
  };
}

function normalizeGoalStatusUpdate(request: unknown) {
  const candidate = objectWithKeys(request, [
    "status",
    "health",
    "evaluation",
    "summary",
    "details",
    "expectedRevision",
    "idempotencyKey"
  ]);
  const status = goalStatus(candidate.status);
  const health =
    candidate.health === undefined || candidate.health === null
      ? null
      : goalHealth(candidate.health);
  if (health !== null && (status === "completed" || status === "archived")) {
    throw new GoalError(
      "invalid_goal_health",
      "Completed and archived goals cannot report health"
    );
  }
  return {
    status,
    health,
    evaluation:
      candidate.evaluation === undefined || candidate.evaluation === null
        ? null
        : goalEvaluation(candidate.evaluation),
    summary: requiredString(candidate.summary, "update summary", 500),
    details: requiredLongText(candidate.details, "update details"),
    expectedRevision: positiveInteger(
      candidate.expectedRevision,
      "expected revision"
    ),
    idempotencyKey: requiredString(
      candidate.idempotencyKey,
      "idempotency key",
      200
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
  health: GoalHealth | null;
  ownerUserId: string | null;
  labelId: string | null;
} {
  const status = searchParams.get("status");
  const health = searchParams.get("health");
  const ownerUserId = searchParams.get("ownerUserId");
  const labelId = searchParams.get("labelId");
  return {
    status: status === null ? null : goalStatus(status),
    health: health === null ? null : goalHealth(health),
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

function optionalOwnerUserId(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value, "goal owner", 200);
}

function requiredLongText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new GoalError(
      "invalid_goal_request",
      `${field} must contain text`
    );
  }
  return value;
}

function goalCriteria(value: unknown): GoalCriterion[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumCriteriaPerGoal) {
    throw new GoalError(
      "invalid_goal_criteria",
      `criteria must contain at most ${maximumCriteriaPerGoal} items`
    );
  }
  return value.map((criterion, index) => {
    if (!criterion || typeof criterion !== "object" || Array.isArray(criterion)) {
      throw invalidCriterion(index, "must be an object");
    }
    const candidate = criterion as Record<string, unknown>;
    const unknown = Object.keys(candidate).find(
      (key) => key !== "title" && key !== "description"
    );
    if (unknown) {
      throw invalidCriterion(index, `contains unsupported field: ${unknown}`);
    }
    try {
      return {
        title: requiredString(candidate.title, "criterion title", 200),
        description: requiredString(
          candidate.description,
          "criterion description",
          10_000,
          false
        )
      };
    } catch (error) {
      if (error instanceof GoalError) {
        throw invalidCriterion(index, error.message);
      }
      throw error;
    }
  });
}

function invalidCriterion(index: number, message: string): GoalError {
  return new GoalError(
    "invalid_goal_criteria",
    `Criterion ${index + 1} ${message}`
  );
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new GoalError(
      "invalid_goal_request",
      `${field} must be a positive integer`
    );
  }
  return value as number;
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

function goalHealth(value: unknown): GoalHealth {
  if (
    typeof value !== "string" ||
    !(goalHealthValues as readonly string[]).includes(value)
  ) {
    throw new GoalError(
      "invalid_goal_health",
      `Goal health must be one of: ${goalHealthValues.join(", ")}`
    );
  }
  return value as GoalHealth;
}

function goalTimeframe(
  value: unknown,
  allowUnspecified: boolean
): GoalTimeframe {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GoalError(
      "invalid_goal_timeframe",
      "Goal timeframe must be an object"
    );
  }
  const candidate = value as Record<string, unknown>;
  const unknown = Object.keys(candidate).find(
    (key) => key !== "kind" && key !== "targetDate"
  );
  if (unknown) {
    throw new GoalError(
      "invalid_goal_timeframe",
      `Unsupported timeframe field: ${unknown}`
    );
  }
  if (candidate.kind === "continuous") {
    if (candidate.targetDate !== undefined) {
      throw invalidTimeframe("Continuous goals cannot have a target date");
    }
    return { kind: "continuous" };
  }
  if (candidate.kind === "deadline") {
    return {
      kind: "deadline",
      targetDate: dateOnly(candidate.targetDate, "goal target date")
    };
  }
  if (candidate.kind === "unspecified" && allowUnspecified) {
    if (candidate.targetDate !== undefined) {
      throw invalidTimeframe("Unspecified goals cannot have a target date");
    }
    return { kind: "unspecified" };
  }
  throw invalidTimeframe(
    allowUnspecified
      ? "Goal timeframe must be unspecified, deadline, or continuous"
      : "Goal timeframe must be deadline or continuous"
  );
}

function goalEvaluation(value: unknown): GoalEvaluation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new GoalError(
      "invalid_goal_evaluation",
      "Goal evaluation must be an object"
    );
  }
  const candidate = value as Record<string, unknown>;
  const unknown = Object.keys(candidate).find(
    (key) => key !== "result" && key !== "asOf"
  );
  if (unknown) {
    throw new GoalError(
      "invalid_goal_evaluation",
      `Unsupported evaluation field: ${unknown}`
    );
  }
  if (
    typeof candidate.result !== "string" ||
    !(goalEvaluationResults as readonly string[]).includes(candidate.result)
  ) {
    throw new GoalError(
      "invalid_goal_evaluation",
      `Evaluation result must be one of: ${goalEvaluationResults.join(", ")}`
    );
  }
  if (
    typeof candidate.asOf !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      candidate.asOf
    )
  ) {
    throw new GoalError(
      "invalid_goal_evaluation",
      "Evaluation asOf must be an ISO 8601 timestamp"
    );
  }
  const asOf = new Date(candidate.asOf);
  if (Number.isNaN(asOf.getTime())) {
    throw new GoalError(
      "invalid_goal_evaluation",
      "Evaluation asOf must be an ISO 8601 timestamp"
    );
  }
  return {
    result: candidate.result as GoalEvaluation["result"],
    asOf: asOf.toISOString()
  };
}

function dateOnly(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidTimeframe(`${field} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw invalidTimeframe(`${field} must be a valid date`);
  }
  return value;
}

function invalidTimeframe(message: string): GoalError {
  return new GoalError("invalid_goal_timeframe", message);
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
    if (error instanceof GoalRepositoryError && error.code === "goal_not_found") {
      throw notFound("goal");
    }
    if (error instanceof GoalRepositoryError && error.code === "revision_conflict") {
      throw new GoalError(
        "goal_revision_conflict",
        "The goal changed after the reported revision",
        409
      );
    }
    if (
      error instanceof GoalRepositoryError &&
      error.code === "idempotency_conflict"
    ) {
      throw new GoalError(
        "goal_update_idempotency_conflict",
        "The idempotency key was already used for a different update",
        409
      );
    }
    throw error;
  }
}

function attributionFor(access: GoalAccess) {
  return {
    authorityUserId: access.userId,
    actor: access.actor,
    authentication: access.authentication,
    clientInfo: access.clientInfo
  };
}

function generateGoalTitle(detailedDescription: string): string {
  const normalized = detailedDescription.replace(/\s+/g, " ").trim();
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
    timeframe: { ...record.timeframe },
    currentEvaluation: record.currentEvaluation
      ? {
          result: record.currentEvaluation.result,
          asOf: record.currentEvaluation.asOf.toISOString()
        }
      : null,
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

function toGoalUpdate(record: GoalStatusUpdateRecord) {
  return {
    ...record,
    evaluation: record.evaluation
      ? {
          result: record.evaluation.result,
          asOf: record.evaluation.asOf.toISOString()
        }
      : null,
    createdAt: record.createdAt.toISOString()
  };
}
