import type {
  GoalLabelRecord,
  GoalRecord,
  GoalRepository,
  GoalStatusUpdateRecord,
  NewGoalLabelRecord,
  NewGoalRecord
} from "../../services/api/src/goals/types";
import { GoalRepositoryError } from "../../services/api/src/goals/types";

export class MemoryGoalRepository implements GoalRepository {
  readonly goals: GoalRecord[] = [];
  readonly labels: GoalLabelRecord[] = [];
  readonly updates: GoalStatusUpdateRecord[] = [];
  private tick = 0;

  async listGoals({ organizationId, ownerUserId, status, health, labelId }: Parameters<
    GoalRepository["listGoals"]
  >[0]): Promise<GoalRecord[]> {
    return this.goals
      .filter(
        (goal) =>
          goal.organizationId === organizationId &&
          (!ownerUserId || goal.ownerUserId === ownerUserId) &&
          (!status || goal.status === status) &&
          (!health || goal.health === health) &&
          (!labelId || goal.labels.some((label) => label.id === labelId))
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .map(copyGoal);
  }

  async getGoal(
    organizationId: string,
    goalId: string
  ): Promise<GoalRecord | null> {
    const goal = this.goals.find(
      (candidate) =>
        candidate.organizationId === organizationId && candidate.id === goalId
    );
    return goal ? copyGoal(goal) : null;
  }

  async insertGoal(
    record: NewGoalRecord,
    labelIds: string[],
    attribution: Parameters<GoalRepository["insertGoal"]>[2]
  ): Promise<GoalRecord> {
    const labels = this.resolveLabels(record.organizationId, labelIds);
    const now = this.now();
    const goal: GoalRecord = {
      ...record,
      id: crypto.randomUUID(),
      labels,
      createdAt: now,
      updatedAt: now
    };
    this.goals.push(goal);
    this.updates.push({
      id: crypto.randomUUID(),
      organizationId: record.organizationId,
      goalId: goal.id,
      revision: 1,
      status: record.status,
      health: null,
      evaluation: null,
      summary: "Goal published",
      details: "Goal published.",
      ...copyAttribution(attribution),
      idempotencyKey: "goal-created",
      createdAt: now
    });
    return copyGoal(goal);
  }

  async updateGoal({
    organizationId,
    goalId,
    actorUserId,
    allowAll,
    update,
    labelIds
  }: Parameters<GoalRepository["updateGoal"]>[0]): Promise<GoalRecord | null> {
    const goal = this.goals.find(
      (candidate) =>
        candidate.organizationId === organizationId &&
        candidate.id === goalId &&
        (allowAll || candidate.ownerUserId === actorUserId)
    );
    if (!goal) return null;
    const labels = labelIds
      ? this.resolveLabels(organizationId, labelIds)
      : goal.labels;
    Object.assign(goal, update, { labels, updatedAt: this.now() });
    return copyGoal(goal);
  }

  async deleteGoal({
    organizationId,
    goalId,
    actorUserId,
    allowAll
  }: Parameters<GoalRepository["deleteGoal"]>[0]): Promise<boolean> {
    const index = this.goals.findIndex(
      (goal) =>
        goal.organizationId === organizationId &&
        goal.id === goalId &&
        (allowAll || goal.ownerUserId === actorUserId)
    );
    if (index < 0) return false;
    this.goals.splice(index, 1);
    for (let updateIndex = this.updates.length - 1; updateIndex >= 0; updateIndex -= 1) {
      if (this.updates[updateIndex]?.goalId === goalId) {
        this.updates.splice(updateIndex, 1);
      }
    }
    return true;
  }

  async listUpdates({
    organizationId,
    goalId
  }: Parameters<GoalRepository["listUpdates"]>[0]): Promise<
    GoalStatusUpdateRecord[]
  > {
    return this.updates
      .filter(
        (update) =>
          update.organizationId === organizationId && update.goalId === goalId
      )
      .sort((left, right) => left.revision - right.revision)
      .map(copyUpdate);
  }

  async appendUpdate(
    input: Parameters<GoalRepository["appendUpdate"]>[0]
  ): Promise<GoalStatusUpdateRecord> {
    const goal = this.goals.find(
      (candidate) =>
        candidate.organizationId === input.organizationId &&
        candidate.id === input.goalId &&
        (input.allowAll || candidate.ownerUserId === input.actorUserId)
    );
    if (!goal) throw new GoalRepositoryError("goal_not_found");
    const existing = this.updates.find(
      (update) =>
        update.goalId === input.goalId &&
        update.idempotencyKey === input.idempotencyKey
    );
    if (existing) {
      if (matchesUpdate(existing, input)) return copyUpdate(existing);
      throw new GoalRepositoryError("idempotency_conflict");
    }
    if (goal.revision !== input.expectedRevision) {
      throw new GoalRepositoryError("revision_conflict");
    }
    const update: GoalStatusUpdateRecord = {
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      goalId: input.goalId,
      revision: goal.revision + 1,
      status: input.status,
      health: input.health,
      evaluation: input.evaluation
        ? {
            result: input.evaluation.result,
            asOf: new Date(input.evaluation.asOf)
          }
        : null,
      summary: input.summary,
      details: input.details,
      ...copyAttribution(input.attribution),
      idempotencyKey: input.idempotencyKey,
      createdAt: this.now()
    };
    goal.status = input.status;
    if (input.status === "completed" || input.status === "archived") {
      goal.health = null;
    } else if (input.health) {
      goal.health = input.health;
    }
    if (input.evaluation) {
      goal.currentEvaluation = {
        result: input.evaluation.result,
        asOf: new Date(input.evaluation.asOf)
      };
    }
    goal.revision = update.revision;
    goal.updatedByUserId = input.attribution.authorityUserId;
    goal.updatedAt = update.createdAt;
    this.updates.push(update);
    return copyUpdate(update);
  }

  async listLabels(organizationId: string): Promise<GoalLabelRecord[]> {
    return this.labels
      .filter((label) => label.organizationId === organizationId)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(copyLabel);
  }

  async getLabel(
    organizationId: string,
    labelId: string
  ): Promise<GoalLabelRecord | null> {
    const label = this.labels.find(
      (candidate) =>
        candidate.organizationId === organizationId && candidate.id === labelId
    );
    return label ? copyLabel(label) : null;
  }

  async insertLabel(
    record: NewGoalLabelRecord
  ): Promise<GoalLabelRecord | null> {
    if (this.hasLabelName(record.organizationId, record.name)) return null;
    const now = this.now();
    const label = {
      ...record,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now
    };
    this.labels.push(label);
    return copyLabel(label);
  }

  async updateLabel({
    organizationId,
    labelId,
    name,
    color,
    description,
    updatedByUserId
  }: Parameters<GoalRepository["updateLabel"]>[0]): Promise<
    GoalLabelRecord | "conflict" | null
  > {
    const label = this.labels.find(
      (candidate) =>
        candidate.organizationId === organizationId && candidate.id === labelId
    );
    if (!label) return null;
    if (this.hasLabelName(organizationId, name, labelId)) return "conflict";
    Object.assign(label, {
      name,
      color,
      description,
      updatedByUserId,
      updatedAt: this.now()
    });
    for (const goal of this.goals) {
      const assigned = goal.labels.find((candidate) => candidate.id === labelId);
      if (assigned) Object.assign(assigned, label);
    }
    return copyLabel(label);
  }

  async deleteLabel(
    organizationId: string,
    labelId: string
  ): Promise<"deleted" | "in_use" | "not_found"> {
    const index = this.labels.findIndex(
      (label) =>
        label.organizationId === organizationId && label.id === labelId
    );
    if (index < 0) return "not_found";
    if (this.goals.some((goal) => goal.labels.some((label) => label.id === labelId))) {
      return "in_use";
    }
    this.labels.splice(index, 1);
    return "deleted";
  }

  private resolveLabels(
    organizationId: string,
    labelIds: string[]
  ): GoalLabelRecord[] {
    const labels = labelIds.map((id) =>
      this.labels.find(
        (label) => label.organizationId === organizationId && label.id === id
      )
    );
    if (labels.some((label) => !label)) {
      throw new GoalRepositoryError("invalid_labels");
    }
    return labels.map((label) => copyLabel(label!));
  }

  private hasLabelName(
    organizationId: string,
    name: string,
    exceptId?: string
  ): boolean {
    return this.labels.some(
      (label) =>
        label.organizationId === organizationId &&
        label.id !== exceptId &&
        label.name.toLowerCase() === name.toLowerCase()
    );
  }

  private now(): Date {
    return new Date(Date.UTC(2026, 7, 5, 12, 0, this.tick++));
  }
}

function copyGoal(goal: GoalRecord): GoalRecord {
  return {
    ...goal,
    timeframe: { ...goal.timeframe },
    currentEvaluation: goal.currentEvaluation
      ? {
          result: goal.currentEvaluation.result,
          asOf: new Date(goal.currentEvaluation.asOf)
        }
      : null,
    labels: goal.labels.map(copyLabel),
    criteria: goal.criteria.map((criterion) => ({ ...criterion }))
  };
}

function copyLabel(label: GoalLabelRecord): GoalLabelRecord {
  return { ...label };
}

function copyAttribution<T extends Parameters<GoalRepository["insertGoal"]>[2]>(
  attribution: T
) {
  return {
    authorityUserId: attribution.authorityUserId,
    actor: { ...attribution.actor },
    authentication: { ...attribution.authentication },
    clientInfo: attribution.clientInfo ? { ...attribution.clientInfo } : null
  };
}

function copyUpdate(update: GoalStatusUpdateRecord): GoalStatusUpdateRecord {
  return {
    ...update,
    ...copyAttribution(update),
    evaluation: update.evaluation
      ? {
          result: update.evaluation.result,
          asOf: new Date(update.evaluation.asOf)
        }
      : null,
    createdAt: new Date(update.createdAt)
  };
}

function matchesUpdate(
  update: GoalStatusUpdateRecord,
  input: Parameters<GoalRepository["appendUpdate"]>[0]
): boolean {
  return (
    update.revision === input.expectedRevision + 1 &&
    update.status === input.status &&
    update.health === input.health &&
    evaluationsMatch(update, input) &&
    update.summary === input.summary &&
    update.details === input.details &&
    update.authorityUserId === input.attribution.authorityUserId &&
    update.actor.kind === input.attribution.actor.kind &&
    update.actor.id === input.attribution.actor.id &&
    update.actor.runId === input.attribution.actor.runId &&
    update.authentication.kind === input.attribution.authentication.kind &&
    update.authentication.subjectId ===
      input.attribution.authentication.subjectId &&
    update.clientInfo?.name === input.attribution.clientInfo?.name &&
    update.clientInfo?.version === input.attribution.clientInfo?.version
  );
}

function evaluationsMatch(
  update: GoalStatusUpdateRecord,
  input: Parameters<GoalRepository["appendUpdate"]>[0]
): boolean {
  if (update.evaluation === null || input.evaluation === null) {
    return update.evaluation === null && input.evaluation === null;
  }
  return (
    update.evaluation.result === input.evaluation.result &&
    update.evaluation.asOf.getTime() === input.evaluation.asOf.getTime()
  );
}
