export const goalStatuses = ["active", "completed", "paused", "archived"] as const;

export class GoalRepositoryError extends Error {
  constructor(
    readonly code:
      | "invalid_labels"
      | "goal_not_found"
      | "revision_conflict"
      | "idempotency_conflict"
  ) {
    super(code);
    this.name = "GoalRepositoryError";
  }
}

export type GoalStatus = (typeof goalStatuses)[number];

export type GoalCriterion = {
  title: string;
  description: string;
};

export type GoalActor =
  | { kind: "user"; id: string; runId: null }
  | { kind: "client"; id: string; runId: null }
  | { kind: "agent"; id: string; runId: string | null };

export type GoalAuthentication = {
  kind: "session" | "api_token" | "oauth" | "unknown";
  subjectId: string | null;
};

export type GoalClientInfo = {
  name: string;
  version: string;
};

export type GoalAttribution = {
  authorityUserId: string;
  actor: GoalActor;
  authentication: GoalAuthentication;
  clientInfo: GoalClientInfo | null;
};

export type GoalLabel = {
  id: string;
  organizationId: string;
  name: string;
  color: string | null;
  description: string | null;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
};

export type Goal = {
  id: string;
  organizationId: string;
  title: string;
  detailedDescription: string;
  status: GoalStatus;
  ownerUserId: string;
  labels: GoalLabel[];
  criteria: GoalCriterion[];
  revision: number;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string;
};

export type GoalUpdate = GoalAttribution & {
  id: string;
  organizationId: string;
  goalId: string;
  revision: number;
  status: GoalStatus;
  summary: string;
  details: string;
  idempotencyKey: string;
  createdAt: string;
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
  | "detailedDescription"
  | "ownerUserId"
  | "criteria"
  | "updatedByUserId"
>;

export type GoalStatusUpdateRecord = Omit<GoalUpdate, "createdAt"> & {
  createdAt: Date;
};

export interface GoalRepository {
  listGoals(input: {
    organizationId: string;
    ownerUserId: string | null;
    status: GoalStatus | null;
    labelId: string | null;
  }): Promise<GoalRecord[]>;
  getGoal(organizationId: string, goalId: string): Promise<GoalRecord | null>;
  insertGoal(
    record: NewGoalRecord,
    labelIds: string[],
    attribution: GoalAttribution
  ): Promise<GoalRecord>;
  updateGoal(input: {
    organizationId: string;
    goalId: string;
    actorUserId: string;
    allowAll: boolean;
    update: GoalUpdateRecord;
    labelIds: string[] | null;
  }): Promise<GoalRecord | null>;
  listUpdates(input: {
    organizationId: string;
    goalId: string;
  }): Promise<GoalStatusUpdateRecord[]>;
  appendUpdate(input: {
    organizationId: string;
    goalId: string;
    actorUserId: string;
    allowAll: boolean;
    expectedRevision: number;
    status: GoalStatus;
    summary: string;
    details: string;
    idempotencyKey: string;
    attribution: GoalAttribution;
  }): Promise<GoalStatusUpdateRecord>;
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
    updatedByUserId: string;
  }): Promise<GoalLabelRecord | "conflict" | null>;
  deleteLabel(
    organizationId: string,
    labelId: string
  ): Promise<"deleted" | "in_use" | "not_found">;
}
