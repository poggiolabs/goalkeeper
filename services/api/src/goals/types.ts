export const goalStatuses = ["active", "completed", "paused", "archived"] as const;

export class GoalRepositoryError extends Error {
  constructor(readonly code: "invalid_labels") {
    super(code);
    this.name = "GoalRepositoryError";
  }
}

export type GoalStatus = (typeof goalStatuses)[number];

export type GoalLabel = {
  id: string;
  organizationId: string;
  name: string;
  color: string | null;
  description: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type Goal = {
  id: string;
  organizationId: string;
  title: string;
  prompt: string;
  status: GoalStatus;
  ownerUserId: string;
  labels: GoalLabel[];
  measurementMethod: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
};

export type GoalLabelRecord = Omit<
  GoalLabel,
  "createdAt" | "updatedAt"
> & {
  createdAt: Date;
  updatedAt: Date;
};

export type GoalRecord = Omit<
  Goal,
  "labels" | "createdAt" | "updatedAt"
> & {
  labels: GoalLabelRecord[];
  createdAt: Date;
  updatedAt: Date;
};

export type NewGoalRecord = Omit<
  GoalRecord,
  "id" | "labels" | "createdAt" | "updatedAt"
>;

export type NewGoalLabelRecord = Omit<
  GoalLabelRecord,
  "id" | "createdAt" | "updatedAt"
>;

export type GoalUpdateRecord = Pick<
  GoalRecord,
  | "title"
  | "prompt"
  | "status"
  | "ownerUserId"
  | "measurementMethod"
  | "updatedBy"
>;

export interface GoalRepository {
  listGoals(input: {
    organizationId: string;
    ownerUserId: string | null;
    status: GoalStatus | null;
    labelId: string | null;
  }): Promise<GoalRecord[]>;
  getGoal(organizationId: string, goalId: string): Promise<GoalRecord | null>;
  insertGoal(record: NewGoalRecord, labelIds: string[]): Promise<GoalRecord>;
  updateGoal(input: {
    organizationId: string;
    goalId: string;
    actorUserId: string;
    allowAll: boolean;
    update: GoalUpdateRecord;
    labelIds: string[] | null;
  }): Promise<GoalRecord | null>;
  deleteGoal(input: {
    organizationId: string;
    goalId: string;
    actorUserId: string;
    allowAll: boolean;
  }): Promise<boolean>;
  listLabels(organizationId: string): Promise<GoalLabelRecord[]>;
  getLabel(
    organizationId: string,
    labelId: string
  ): Promise<GoalLabelRecord | null>;
  insertLabel(record: NewGoalLabelRecord): Promise<GoalLabelRecord | null>;
  updateLabel(input: {
    organizationId: string;
    labelId: string;
    name: string;
    color: string | null;
    description: string | null;
    updatedBy: string;
  }): Promise<GoalLabelRecord | "conflict" | null>;
  deleteLabel(
    organizationId: string,
    labelId: string
  ): Promise<"deleted" | "in_use" | "not_found">;
}
