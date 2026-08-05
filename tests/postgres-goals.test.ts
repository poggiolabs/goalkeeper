import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { migrateApiDatabase } from "../services/api/src/api-tokens/postgres";
import { createPostgresGoalRepository } from "../services/api/src/goals/postgres";
import {
  createGoalService,
  type GoalAccess
} from "../services/api/src/goals/service";
import { createPostgresOrganizationRepository } from "../services/api/src/organizations/postgres";
import { createOrganizationService } from "../services/api/src/organizations/service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("PostgreSQL goals", () => {
  const schema = `goals_test_${crypto.randomUUID().replaceAll("-", "")}`;
  let admin: SQL;
  let database: SQL;
  let organizations: ReturnType<typeof createOrganizationService>;
  let goals: ReturnType<typeof createGoalService>;

  beforeAll(async () => {
    admin = new SQL(testDatabaseUrl!);
    await admin.unsafe(`create schema ${schema}`);
    const scopedUrl = new URL(testDatabaseUrl!);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    database = new SQL(scopedUrl.toString());
    await migrateApiDatabase(database);
    organizations = createOrganizationService(
      createPostgresOrganizationRepository(database)
    );
    goals = createGoalService(createPostgresGoalRepository(database), {
      isOrganizationMember: async (userId, organizationId) =>
        (await organizations.roleForUser(userId, organizationId)) !== null
    });
  });

  afterAll(async () => {
    await database?.close();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.close();
  });

  test("persists tenant-scoped goal and label CRUD", async () => {
    const owner = {
      id: crypto.randomUUID(),
      displayName: "Goal Owner",
      email: "goal-owner@example.com"
    };
    const context = await organizations.ensureForUser(owner);
    const access: GoalAccess = {
      userId: owner.id,
      organizationId: context.activeOrganizationId,
      readAll: true,
      writeAll: true,
      actor: { kind: "user", id: owner.id, runId: null },
      authentication: { kind: "session", subjectId: crypto.randomUUID() },
      clientInfo: null
    };
    const { label } = await goals.createLabel(access, {
      name: "Launch",
      color: "#22c55e"
    });
    const { goal } = await goals.createGoal(access, {
      detailedDescription: "Ship the durable goal domain",
      labelIds: [label.id]
    });
    expect((await goals.getGoal(access, goal.id)).goal).toMatchObject({
      id: goal.id,
      ownerUserId: owner.id,
      labels: [{ id: label.id, name: "Launch" }]
    });

    const updated = await goals.updateGoal(access, goal.id, {
      criteria: [
        {
          title: "Database checks",
          description: "All database checks pass"
        }
      ]
    });
    expect(updated.goal).toMatchObject({
      status: "active",
      criteria: [
        {
          title: "Database checks",
          description: "All database checks pass"
        }
      ]
    });
    const { update } = await goals.reportUpdate(access, goal.id, {
      status: "completed",
      summary: "Database contract complete",
      details: "The goal and label persistence checks pass.",
      expectedRevision: 1,
      idempotencyKey: "database-contract-complete"
    });
    expect(update).toMatchObject({
      revision: 2,
      status: "completed",
      authorityUserId: owner.id,
      actor: { kind: "user", id: owner.id, runId: null },
      authentication: {
        kind: "session",
        subjectId: access.authentication.subjectId
      }
    });
    expect((await goals.listUpdates(access, goal.id)).updates).toHaveLength(2);
    const [statusColumn] = await database<
      { data_type: string; udt_name: string }[]
    >`
      select data_type, udt_name
      from information_schema.columns
      where table_schema = ${schema}
        and table_name = 'goals'
        and column_name = 'status'
    `;
    expect(statusColumn).toEqual({
      data_type: "USER-DEFINED",
      udt_name: "goal_status"
    });
    await expect(goals.deleteLabel(access, label.id)).rejects.toMatchObject({
      code: "goal_label_in_use"
    });
    await goals.updateGoal(access, goal.id, { labelIds: [] });
    await goals.deleteLabel(access, label.id);
    await goals.reportUpdate(access, goal.id, {
      status: "archived",
      summary: "Goal archived",
      details: "The historical record remains available.",
      expectedRevision: 2,
      idempotencyKey: "archive-completed-goal"
    });
    await expect(goals.getGoal(access, goal.id)).resolves.toMatchObject({
      goal: { status: "archived", revision: 3 }
    });
  });

  test("enforces case-insensitive label uniqueness per organization", async () => {
    const firstUser = {
      id: crypto.randomUUID(),
      displayName: "First Owner",
      email: "first-owner@example.com"
    };
    const secondUser = {
      id: crypto.randomUUID(),
      displayName: "Second Owner",
      email: "second-owner@example.com"
    };
    const first = await organizations.ensureForUser(firstUser);
    const second = await organizations.ensureForUser(secondUser);
    const firstAccess: GoalAccess = {
      userId: firstUser.id,
      organizationId: first.activeOrganizationId,
      readAll: true,
      writeAll: true,
      actor: { kind: "user", id: firstUser.id, runId: null },
      authentication: { kind: "session", subjectId: crypto.randomUUID() },
      clientInfo: null
    };
    const secondAccess: GoalAccess = {
      userId: secondUser.id,
      organizationId: second.activeOrganizationId,
      readAll: true,
      writeAll: true,
      actor: { kind: "user", id: secondUser.id, runId: null },
      authentication: { kind: "session", subjectId: crypto.randomUUID() },
      clientInfo: null
    };
    await goals.createLabel(firstAccess, { name: "Customer" });
    await expect(
      goals.createLabel(firstAccess, { name: "customer" })
    ).rejects.toMatchObject({ code: "goal_label_exists" });
    await expect(
      goals.createLabel(secondAccess, { name: "customer" })
    ).resolves.toMatchObject({ label: { name: "customer" } });
  });
});
