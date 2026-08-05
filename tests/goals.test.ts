import { describe, expect, test } from "bun:test";
import {
  createGoalService,
  type GoalAccess
} from "../services/api/src/goals/service";
import { MemoryGoalRepository } from "./helpers/memory-goal-repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";

function createHarness() {
  const repository = new MemoryGoalRepository();
  const members = new Map([
    [organizationId, new Set(["user-1", "user-2"])],
    [otherOrganizationId, new Set(["user-1"])]
  ]);
  const service = createGoalService(repository, {
    isOrganizationMember: (userId, candidateOrganizationId) =>
      members.get(candidateOrganizationId)?.has(userId) ?? false
  });
  const own: GoalAccess = {
    userId: "user-1",
    organizationId,
    readAll: false,
    writeAll: false,
    actor: { kind: "user", id: "user-1", runId: null },
    authentication: { kind: "session", subjectId: "session-1" },
    clientInfo: null
  };
  const all: GoalAccess = { ...own, readAll: true, writeAll: true };
  return { repository, service, own, all };
}

describe("goals and labels", () => {
  test("creates labels and goals with stable label references", async () => {
    const { service, own } = createHarness();
    const { label } = await service.createLabel(own, {
      name: "Priority",
      color: "#22c55e",
      description: "Work that should happen next"
    });
    const { goal } = await service.createGoal(own, {
      detailedDescription:
        "Ship the goals API.\n\n- Keep the state model small.\n- Preserve Markdown.",
      labelIds: [label.id],
      criteria: [
        {
          title: "Contract passes",
          description: "The public CRUD contract passes its tests."
        }
      ]
    });

    expect(goal).toMatchObject({
      title: "Ship the goals API",
      detailedDescription:
        "Ship the goals API.\n\n- Keep the state model small.\n- Preserve Markdown.",
      status: "active",
      ownerUserId: "user-1",
      labels: [{ id: label.id, name: "Priority" }],
      criteria: [
        {
          title: "Contract passes",
          description: "The public CRUD contract passes its tests."
        }
      ],
      revision: 1,
      createdByUserId: "user-1",
      updatedByUserId: "user-1"
    });

    expect((await service.listUpdates(own, goal.id)).updates).toMatchObject([
      {
        goalId: goal.id,
        revision: 1,
        status: "active",
        summary: "Goal created",
        authorityUserId: "user-1",
        actor: { kind: "user", id: "user-1", runId: null },
        authentication: { kind: "session", subjectId: "session-1" },
        clientInfo: null
      }
    ]);

    const renamed = await service.updateLabel(own, label.id, {
      name: "Next",
      description: null
    });
    expect(renamed.label).toMatchObject({ id: label.id, name: "Next" });
    expect((await service.getGoal(own, goal.id)).goal.labels[0]).toMatchObject({
      id: label.id,
      name: "Next"
    });
  });

  test("enforces own-goal access and validates owner membership", async () => {
    const { service, own, all } = createHarness();
    const other = await service.createGoal(all, {
      title: "Team goal",
      detailedDescription: "Achieve the team outcome",
      ownerUserId: "user-2"
    });

    expect((await service.listGoals(own, new URLSearchParams())).goals).toEqual([]);
    await expect(service.getGoal(own, other.goal.id)).rejects.toMatchObject({
      code: "goal_not_found"
    });
    await expect(
      service.createGoal(own, {
        detailedDescription: "Assign without authority",
        ownerUserId: "user-2"
      })
    ).rejects.toMatchObject({ code: "goal_owner_forbidden" });
    await expect(
      service.createGoal(all, {
        detailedDescription: "Assign outside the organization",
        ownerUserId: "not-a-member"
      })
    ).rejects.toMatchObject({ code: "invalid_goal_owner" });
  });

  test("filters goals and blocks deletion of assigned labels", async () => {
    const { service, all } = createHarness();
    const { label } = await service.createLabel(all, { name: "Revenue" });
    const first = await service.createGoal(all, {
      detailedDescription: "Increase expansion revenue",
      labelIds: [label.id]
    });
    await service.createGoal(all, {
      detailedDescription: "Reduce support latency"
    });
    await service.reportUpdate(all, first.goal.id, {
      status: "paused",
      summary: "Waiting on a dependency",
      details: "The external dependency is not yet available.",
      expectedRevision: 1,
      idempotencyKey: "pause-for-dependency"
    });

    expect(
      (
        await service.listGoals(
          all,
          new URLSearchParams({ status: "paused", labelId: label.id })
        )
      ).goals.map((goal) => goal.id)
    ).toEqual([first.goal.id]);
    await expect(service.deleteLabel(all, label.id)).rejects.toMatchObject({
      code: "goal_label_in_use"
    });
    await service.updateGoal(all, first.goal.id, { labelIds: [] });
    await expect(service.deleteLabel(all, label.id)).resolves.toBeUndefined();
  });

  test("rejects unsupported fields and cross-organization labels", async () => {
    const { service, all } = createHarness();
    await expect(
      service.createGoal(all, {
        detailedDescription: "Reject fields outside the goal contract",
        unsupportedField: true
      })
    ).rejects.toMatchObject({ code: "invalid_goal_request" });

    const otherAccess = { ...all, organizationId: otherOrganizationId };
    const { label } = await service.createLabel(otherAccess, { name: "Other" });
    await expect(
      service.createGoal(all, {
        detailedDescription: "Keep tenant references isolated",
        labelIds: [label.id]
      })
    ).rejects.toMatchObject({ code: "invalid_goal_labels" });
  });

  test("requires non-empty patches and case-insensitive unique label names", async () => {
    const { service, all } = createHarness();
    const { goal } = await service.createGoal(all, {
      detailedDescription: "A valid goal"
    });
    await expect(service.updateGoal(all, goal.id, {})).rejects.toMatchObject({
      code: "empty_goal_update"
    });
    await expect(
      service.updateGoal(all, goal.id, { status: "completed" })
    ).rejects.toMatchObject({ code: "invalid_goal_request" });
    await service.createLabel(all, { name: "Customer" });
    await expect(
      service.createLabel(all, { name: "customer" })
    ).rejects.toMatchObject({ code: "goal_label_exists" });
  });

  test("validates structured goal criteria", async () => {
    const { service, all } = createHarness();
    await expect(
      service.createGoal(all, {
        detailedDescription: "A goal with malformed criteria",
        criteria: [{ title: "Missing description" }]
      })
    ).rejects.toMatchObject({ code: "invalid_goal_criteria" });
    await expect(
      service.createGoal(all, {
        detailedDescription: "A goal with an unsupported criterion field",
        criteria: [{ title: "Valid", description: "Valid", score: 1 }]
      })
    ).rejects.toMatchObject({ code: "invalid_goal_criteria" });
  });

  test("appends status updates with optimistic concurrency and idempotency", async () => {
    const { service, all } = createHarness();
    const { goal } = await service.createGoal(all, {
      detailedDescription: "Produce a durable result"
    });
    const request = {
      status: "completed",
      summary: "Result delivered",
      details: "The final artifact passed validation.",
      expectedRevision: 1,
      idempotencyKey: "run-42-completed"
    } as const;

    const first = await service.reportUpdate(all, goal.id, request);
    const retry = await service.reportUpdate(all, goal.id, request);
    expect(retry).toEqual(first);
    expect(first.update).toMatchObject({
      revision: 2,
      status: "completed",
      authorityUserId: "user-1",
      actor: { kind: "user", id: "user-1", runId: null },
      authentication: { kind: "session", subjectId: "session-1" }
    });
    expect((await service.getGoal(all, goal.id)).goal).toMatchObject({
      status: "completed",
      revision: 2
    });
    expect((await service.listUpdates(all, goal.id)).updates).toHaveLength(2);

    await expect(
      service.reportUpdate(all, goal.id, {
        ...request,
        idempotencyKey: "stale-update"
      })
    ).rejects.toMatchObject({ code: "goal_revision_conflict", status: 409 });
    await expect(
      service.reportUpdate(all, goal.id, {
        ...request,
        summary: "Different payload"
      })
    ).rejects.toMatchObject({
      code: "goal_update_idempotency_conflict",
      status: 409
    });
  });

  test("attributes an agent separately from the authorizing human", async () => {
    const { service, all } = createHarness();
    const agentAccess: GoalAccess = {
      ...all,
      actor: { kind: "agent", id: "research-agent", runId: "run-42" },
      authentication: { kind: "oauth", subjectId: "oauth-client-1" },
      clientInfo: { name: "Claude Desktop", version: "1.2.3" }
    };
    const { goal } = await service.createGoal(agentAccess, {
      detailedDescription: "Research the target market"
    });
    const { update } = await service.reportUpdate(agentAccess, goal.id, {
      status: "active",
      summary: "Interview synthesis complete",
      details: "Three recurring customer needs were identified.",
      expectedRevision: 1,
      idempotencyKey: "run-42-synthesis"
    });

    expect(update).toMatchObject({
      authorityUserId: "user-1",
      actor: { kind: "agent", id: "research-agent", runId: "run-42" },
      authentication: { kind: "oauth", subjectId: "oauth-client-1" },
      clientInfo: { name: "Claude Desktop", version: "1.2.3" }
    });
  });
});
