export const goalStatuses = [
  "active",
  "completed",
  "paused",
  "archived"
] as const;

export const goalTimeframeKinds = [
  "unspecified",
  "deadline",
  "continuous"
] as const;

export const goalEvaluationResults = ["met", "not_met", "unknown"] as const;

export const goalHealthValues = ["on_track", "at_risk", "off_track"] as const;

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
export type GoalTimeframeKind = (typeof goalTimeframeKinds)[number];
export type GoalEvaluationResult = (typeof goalEvaluationResults)[number];
export type GoalHealth = (typeof goalHealthValues)[number];

export type GoalTimeframe =
  | { kind: "unspecified" }
  | { kind: "continuous" }
  | { kind: "deadline"; targetDate: string };

export type GoalEvaluation = {
  result: GoalEvaluationResult;
  asOf: string;
};

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
  health: GoalHealth | null;
  timeframe: GoalTimeframe;
  currentEvaluation: GoalEvaluation | null;
  ownerUserId: string | null;
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
  health: GoalHealth | null;
  evaluation: GoalEvaluation | null;
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
  "labels" | "currentEvaluation" | "createdAt" | "updatedAt"
> & {
  labels: GoalLabelRecord[];
  currentEvaluation: GoalEvaluationRecord | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GoalEvaluationRecord = Omit<GoalEvaluation, "asOf"> & {
  asOf: Date;
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
  | "timeframe"
  | "ownerUserId"
  | "criteria"
  | "updatedByUserId"
>;

export type GoalStatusUpdateRecord = Omit<
  GoalUpdate,
  "evaluation" | "createdAt"
> & {
  evaluation: GoalEvaluationRecord | null;
  createdAt: Date;
};

export interface GoalRepository {
  listGoals(input: {
    organizationId: string;
    ownerUserId: string | null;
    status: GoalStatus | null;
    health: GoalHealth | null;
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
  deleteGoal(input: {
    organizationId: string;
    goalId: string;
    actorUserId: string;
    allowAll: boolean;
  }): Promise<boolean>;
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
    health: GoalHealth | null;
    evaluation: GoalEvaluationRecord | null;
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
