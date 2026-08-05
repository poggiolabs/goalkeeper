import type {
  GoalLabelRecord,
  GoalRecord,
  GoalRepository,
  NewGoalLabelRecord,
  NewGoalRecord
} from "../../services/api/src/goals/types";
import { GoalRepositoryError } from "../../services/api/src/goals/types";

export class MemoryGoalRepository implements GoalRepository {
  readonly goals: GoalRecord[] = [];
  readonly labels: GoalLabelRecord[] = [];
  private tick = 0;

  async listGoals({ organizationId, ownerUserId, status, labelId }: Parameters<
    GoalRepository["listGoals"]
  >[0]): Promise<GoalRecord[]> {
    return this.goals
      .filter(
        (goal) =>
          goal.organizationId === organizationId &&
          (!ownerUserId || goal.ownerUserId === ownerUserId) &&
          (!status || goal.status === status) &&
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
    labelIds: string[]
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
    return true;
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
    updatedBy
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
      updatedBy,
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
  return { ...goal, labels: goal.labels.map(copyLabel) };
}

function copyLabel(label: GoalLabelRecord): GoalLabelRecord {
  return { ...label };
}
