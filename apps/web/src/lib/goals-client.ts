import { assertApiResponse } from "@/auth-client";

export const goalStatuses = [
  "active",
  "paused",
  "completed",
  "archived"
] as const;

export type GoalStatus = (typeof goalStatuses)[number];
export const goalHealthValues = ["on_track", "at_risk", "off_track"] as const;
export type GoalHealth = (typeof goalHealthValues)[number];
export type GoalTimeframe =
  | { kind: "unspecified" }
  | { kind: "continuous" }
  | { kind: "deadline"; targetDate: string };
export type GoalEvaluationResult = "met" | "not_met" | "unknown";
export type GoalEvaluation = {
  result: GoalEvaluationResult;
  asOf: string;
};

export type GoalCriterion = {
  title: string;
  description: string;
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

export type GoalUpdate = {
  id: string;
  organizationId: string;
  goalId: string;
  revision: number;
  status: GoalStatus;
  health: GoalHealth | null;
  evaluation: GoalEvaluation | null;
  summary: string;
  details: string;
  authorityUserId: string;
  actor: {
    kind: "user" | "client" | "agent";
    id: string;
    runId: string | null;
  };
  authentication: {
    kind: "session" | "api_token" | "oauth" | "unknown";
    subjectId: string | null;
  };
  clientInfo: { name: string; version: string } | null;
  idempotencyKey: string;
  createdAt: string;
};

export type GoalFormInput = {
  title: string;
  detailedDescription: string;
  timeframe: GoalTimeframe;
  ownerUserId: string | null;
  labelIds: string[];
  criteria: GoalCriterion[];
};

async function request<T>(
  apiUrl: string,
  path: string,
  fallbackMessage: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(new URL(path, apiUrl), {
    credentials: "include",
    ...init,
    headers: init?.body
      ? { "content-type": "application/json", ...init.headers }
      : init?.headers
  });
  await assertApiResponse(response, fallbackMessage);
  return response.json() as Promise<T>;
}

export async function listGoals(
  apiUrl: string,
  signal?: AbortSignal
): Promise<Goal[]> {
  const result = await request<{ goals: Goal[] }>(
    apiUrl,
    "/v1/goals",
    "Unable to load goals.",
    { signal }
  );
  return result.goals;
}

export async function getGoal(
  apiUrl: string,
  goalId: string,
  signal?: AbortSignal
): Promise<Goal> {
  const result = await request<{ goal: Goal }>(
    apiUrl,
    `/v1/goals/${encodeURIComponent(goalId)}`,
    "Unable to load the goal.",
    { signal }
  );
  return result.goal;
}

export async function createGoal(
  apiUrl: string,
  input: GoalFormInput
): Promise<Goal> {
  const result = await request<{ goal: Goal }>(
    apiUrl,
    "/v1/goals",
    "Unable to create a goal.",
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
  return result.goal;
}

export async function updateGoal(
  apiUrl: string,
  goalId: string,
  input: GoalFormInput
): Promise<Goal> {
  const result = await request<{ goal: Goal }>(
    apiUrl,
    `/v1/goals/${encodeURIComponent(goalId)}`,
    "Unable to save the goal.",
    { method: "PATCH", body: JSON.stringify(input) }
  );
  return result.goal;
}

export async function deleteGoal(apiUrl: string, goalId: string): Promise<void> {
  const response = await fetch(
    new URL(`/v1/goals/${encodeURIComponent(goalId)}`, apiUrl),
    { method: "DELETE", credentials: "include" }
  );
  await assertApiResponse(response, "Unable to delete the goal.");
}

export async function listGoalUpdates(
  apiUrl: string,
  goalId: string,
  signal?: AbortSignal
): Promise<GoalUpdate[]> {
  const result = await request<{ updates: GoalUpdate[] }>(
    apiUrl,
    `/v1/goals/${encodeURIComponent(goalId)}/updates`,
    "Unable to load goal history.",
    { signal }
  );
  return result.updates;
}

export async function createGoalUpdate(
  apiUrl: string,
  goal: Goal,
  input: {
    status: GoalStatus;
    health: GoalHealth | null;
    evaluation: GoalEvaluation | null;
    summary: string;
    details: string;
  }
): Promise<GoalUpdate> {
  const result = await request<{ update: GoalUpdate }>(
    apiUrl,
    `/v1/goals/${encodeURIComponent(goal.id)}/updates`,
    "Unable to post the goal update.",
    {
      method: "POST",
      body: JSON.stringify({
        ...input,
        expectedRevision: goal.revision,
        idempotencyKey: `web-${input.status}-${crypto.randomUUID()}`
      })
    }
  );
  return result.update;
}

export async function listGoalLabels(
  apiUrl: string,
  signal?: AbortSignal
): Promise<GoalLabel[]> {
  const result = await request<{ labels: GoalLabel[] }>(
    apiUrl,
    "/v1/goal-labels",
    "Unable to load labels.",
    { signal }
  );
  return result.labels;
}

export async function createGoalLabel(
  apiUrl: string,
  input: Pick<GoalLabel, "name" | "color" | "description">
): Promise<GoalLabel> {
  const result = await request<{ label: GoalLabel }>(
    apiUrl,
    "/v1/goal-labels",
    "Unable to create the label.",
    { method: "POST", body: JSON.stringify(input) }
  );
  return result.label;
}

export async function updateGoalLabel(
  apiUrl: string,
  labelId: string,
  input: Pick<GoalLabel, "name" | "color" | "description">
): Promise<GoalLabel> {
  const result = await request<{ label: GoalLabel }>(
    apiUrl,
    `/v1/goal-labels/${encodeURIComponent(labelId)}`,
    "Unable to update the label.",
    { method: "PATCH", body: JSON.stringify(input) }
  );
  return result.label;
}

export async function deleteGoalLabel(
  apiUrl: string,
  labelId: string
): Promise<void> {
  const response = await fetch(
    new URL(`/v1/goal-labels/${encodeURIComponent(labelId)}`, apiUrl),
    { method: "DELETE", credentials: "include" }
  );
  await assertApiResponse(response, "Unable to delete the label.");
}
