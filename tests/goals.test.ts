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
    writeAll: false
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
      ]
    });

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
    await service.updateGoal(all, first.goal.id, { status: "paused" });

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

  test("rejects schedules and cross-organization labels", async () => {
    const { service, all } = createHarness();
    await expect(
      service.createGoal(all, {
        detailedDescription: "Do not smuggle execution policy into goal state",
        schedules: []
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
});
