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
      timeframe: { kind: "deadline", targetDate: "2026-09-30" },
      labelIds: [label.id]
    });
    const { goal: removable } = await goals.createGoal(access, {
      title: "Temporary outcome",
      detailedDescription: "Delete this goal after persistence is verified.",
      timeframe: { kind: "continuous" }
    });
    expect((await goals.getGoal(access, goal.id)).goal).toMatchObject({
      id: goal.id,
      health: null,
      ownerUserId: owner.id,
      labels: [{ id: label.id, name: "Launch" }]
    });
    expect((await goals.getGoal(access, removable.id)).goal).toMatchObject({
      id: removable.id,
      status: "active",
      revision: 1
    });
    expect(
      (await goals.updateGoal(access, removable.id, { ownerUserId: null })).goal
        .ownerUserId
    ).toBeNull();
    await goals.deleteGoal(access, removable.id);
    await expect(goals.getGoal(access, removable.id)).rejects.toMatchObject({
      code: "goal_not_found"
    });
    const [deletedHistory] = await database<{ count: number }[]>`
      select count(*)::int as count
      from goal_updates
      where goal_id = ${removable.id}::uuid
    `;
    expect(deletedHistory?.count).toBe(0);

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
    const healthUpdate = await goals.reportUpdate(access, goal.id, {
      status: "active",
      health: "at_risk",
      summary: "Database checks delayed",
      details: "The persistence checks are still running.",
      expectedRevision: 1,
      idempotencyKey: "database-contract-at-risk"
    });
    expect(healthUpdate.update).toMatchObject({
      revision: 2,
      status: "active",
      health: "at_risk"
    });
    expect(
      (await goals.listGoals(access, new URLSearchParams({ health: "at_risk" })))
        .goals.map((candidate) => candidate.id)
    ).toEqual([goal.id]);

    const { update } = await goals.reportUpdate(access, goal.id, {
      status: "completed",
      evaluation: { result: "met", asOf: "2026-09-30T17:00:00.000Z" },
      summary: "Database contract complete",
      details: "The goal and label persistence checks pass.",
      expectedRevision: 2,
      idempotencyKey: "database-contract-complete"
    });
    expect(update).toMatchObject({
      revision: 3,
      status: "completed",
      health: null,
      evaluation: { result: "met", asOf: "2026-09-30T17:00:00.000Z" },
      authorityUserId: owner.id,
      actor: { kind: "user", id: owner.id, runId: null },
      authentication: {
        kind: "session",
        subjectId: access.authentication.subjectId
      }
    });
    expect((await goals.getGoal(access, goal.id)).goal).toMatchObject({
      health: null,
      timeframe: { kind: "deadline", targetDate: "2026-09-30" },
      currentEvaluation: {
        result: "met",
        asOf: "2026-09-30T17:00:00.000Z"
      }
    });
    expect((await goals.listUpdates(access, goal.id)).updates).toHaveLength(3);
    const [statusColumn, healthColumn] = await database<
      { data_type: string; udt_name: string }[]
    >`
      select data_type, udt_name
      from information_schema.columns
      where table_schema = ${schema}
        and table_name = 'goals'
        and column_name in ('status', 'health')
      order by column_name desc
    `;
    expect(statusColumn).toEqual({
      data_type: "USER-DEFINED",
      udt_name: "goal_status"
    });
    expect(healthColumn).toEqual({
      data_type: "USER-DEFINED",
      udt_name: "goal_health"
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
      expectedRevision: 3,
      idempotencyKey: "archive-completed-goal"
    });
    await expect(goals.getGoal(access, goal.id)).resolves.toMatchObject({
      goal: { status: "archived", health: null, revision: 4 }
    });
  });

  test("archives legacy persisted drafts and removes the draft enum value", async () => {
    const owner = {
      id: crypto.randomUUID(),
      displayName: "Legacy Draft Owner",
      email: "legacy-draft@example.com"
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
    const { goal } = await goals.createGoal(access, {
      detailedDescription: "Preserve an object created by the former draft model",
      timeframe: { kind: "continuous" }
    });

    await database`alter type goal_status add value 'draft' before 'active'`;
    await database`
      update goals set status = 'draft'::goal_status where id = ${goal.id}::uuid
    `;
    await database`
      update goal_updates
      set status = 'draft'::goal_status
      where goal_id = ${goal.id}::uuid
    `;
    await database`
      delete from api_schema_migrations where id = '013_remove_goal_draft_status'
    `;

    await migrateApiDatabase(database);

    const [migrated] = await database<
      { goal_status: string; update_status: string }[]
    >`
      select
        goals.status::text as goal_status,
        goal_updates.status::text as update_status
      from goals
      join goal_updates on goal_updates.goal_id = goals.id
      where goals.id = ${goal.id}::uuid
    `;
    expect(migrated).toEqual({
      goal_status: "archived",
      update_status: "archived"
    });
    const enumValues = await database<{ enumlabel: string }[]>`
      select pg_enum.enumlabel
      from pg_enum
      join pg_type on pg_type.oid = pg_enum.enumtypid
      where pg_type.typname = 'goal_status'
        and pg_type.typnamespace = current_schema()::regnamespace
      order by pg_enum.enumsortorder
    `;
    expect(enumValues.map((row) => row.enumlabel)).toEqual([
      "active",
      "completed",
      "paused",
      "archived"
    ]);
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

  test("resumes migration when the composite goal index already exists", async () => {
    const compatibilitySchema = `goals_compat_${crypto
      .randomUUID()
      .replaceAll("-", "")}`;
    await admin.unsafe(`create schema ${compatibilitySchema}`);
    const scopedUrl = new URL(testDatabaseUrl!);
    scopedUrl.searchParams.set(
      "options",
      `-csearch_path=${compatibilitySchema}`
    );
    const compatibilityDatabase = new SQL(scopedUrl.toString());

    try {
      await migrateApiDatabase(compatibilityDatabase);
      await compatibilityDatabase.begin(async (transaction) => {
        await transaction`delete from api_schema_migrations where id = '009_goal_updates'`;
        await transaction`drop table goal_updates`;
        await transaction`alter table goal_labels rename column created_by_user_id to created_by`;
        await transaction`alter table goal_labels rename column updated_by_user_id to updated_by`;
        await transaction`alter table goals rename column created_by_user_id to created_by`;
        await transaction`alter table goals rename column updated_by_user_id to updated_by`;
        await transaction`alter table goals drop column revision`;
        await transaction`drop type goal_actor_kind`;
        await transaction`drop type goal_authn_kind`;
      });

      await expect(
        migrateApiDatabase(compatibilityDatabase)
      ).resolves.toBeUndefined();
      const [state] = await compatibilityDatabase<
        { migration_applied: boolean; updates_table: string | null }[]
      >`
        select
          exists (
            select 1 from api_schema_migrations where id = '009_goal_updates'
          ) as migration_applied,
          to_regclass('goal_updates')::text as updates_table
      `;
      expect(state).toEqual({
        migration_applied: true,
        updates_table: "goal_updates"
      });
    } finally {
      await compatibilityDatabase.close();
      await admin.unsafe(`drop schema if exists ${compatibilitySchema} cascade`);
    }
  });
});
