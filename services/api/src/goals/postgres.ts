import { SQL } from "bun";
import type {
  GoalAttribution,
  GoalActor,
  GoalAuthentication,
  GoalClientInfo,
  GoalCriterion,
  GoalLabelRecord,
  GoalRecord,
  GoalRepository,
  GoalStatusUpdateRecord,
  GoalStatus
} from "./types";
import { GoalRepositoryError } from "./types";

type GoalRow = {
  id: string;
  organization_id: string;
  title: string;
  detailed_description: string;
  status: GoalStatus;
  owner_user_id: string;
  criteria: GoalCriterion[] | string;
  revision: number | string;
  created_at: Date | string;
  created_by_user_id: string;
  updated_at: Date | string;
  updated_by_user_id: string;
};

type GoalLabelRow = {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  description: string | null;
  created_at: Date | string;
  created_by_user_id: string;
  updated_at: Date | string;
  updated_by_user_id: string;
};

type GoalUpdateRow = {
  id: string;
  organization_id: string;
  goal_id: string;
  revision: number | string;
  status: GoalStatus;
  summary: string;
  details: string;
  authority_user_id: string;
  actor_kind: GoalActor["kind"];
  actor_id: string;
  actor_run_id: string | null;
  authn_kind: GoalAuthentication["kind"];
  authn_subject_id: string | null;
  client_name: string | null;
  client_version: string | null;
  idempotency_key: string;
  created_at: Date | string;
};

type NewGoalUpdateInput = {
  organizationId: string;
  goalId: string;
  revision: number;
  status: GoalStatus;
  summary: string;
  details: string;
  idempotencyKey: string;
  attribution: GoalAttribution;
};

export function createPostgresGoalRepository(sql: SQL): GoalRepository {
  return {
    async listGoals({ organizationId, ownerUserId, status, labelId }) {
      const rows = await sql<GoalRow[]>`
        select g.*
        from goals g
        where g.organization_id = ${organizationId}::uuid
          and (${ownerUserId}::text is null or g.owner_user_id = ${ownerUserId})
          and (${status}::goal_status is null or g.status = ${status}::goal_status)
          and (
            ${labelId}::uuid is null
            or exists (
              select 1
              from goal_label_assignments a
              where a.goal_id = g.id and a.label_id = ${labelId}::uuid
            )
          )
        order by g.updated_at desc, g.id
      `;
      return attachLabels(sql, rows);
    },

    async getGoal(organizationId, goalId) {
      const rows = await sql<GoalRow[]>`
        select *
        from goals
        where organization_id = ${organizationId}::uuid
          and id = ${goalId}::uuid
      `;
      return rows[0] ? (await attachLabels(sql, rows))[0]! : null;
    },

    async insertGoal(record, labelIds, attribution) {
      return sql.begin(async (transaction) => {
        await requireLabels(transaction, record.organizationId, labelIds);
        const [row] = await transaction<GoalRow[]>`
          insert into goals (
            organization_id,
            title,
            detailed_description,
            status,
            owner_user_id,
            criteria,
            created_by_user_id,
            updated_by_user_id
          ) values (
            ${record.organizationId}::uuid,
            ${record.title},
            ${record.detailedDescription},
            ${record.status}::goal_status,
            ${record.ownerUserId},
            ${record.criteria},
            ${record.createdByUserId},
            ${record.updatedByUserId}
          )
          returning *
        `;
        if (!row) throw new Error("Goal insert did not return a record");
        await assignLabels(transaction, row.id, labelIds);
        await insertGoalUpdate(transaction, {
          organizationId: record.organizationId,
          goalId: row.id,
          revision: 1,
          status: record.status,
          summary: "Goal created",
          details: "Initial goal state.",
          idempotencyKey: "goal-created",
          attribution
        });
        return (await attachLabels(transaction, [row]))[0]!;
      });
    },

    async updateGoal({
      organizationId,
      goalId,
      actorUserId,
      allowAll,
      update,
      labelIds
    }) {
      return sql.begin(async (transaction) => {
        const [locked] = await transaction<GoalRow[]>`
          select *
          from goals
          where organization_id = ${organizationId}::uuid
            and id = ${goalId}::uuid
            and (${allowAll} or owner_user_id = ${actorUserId})
          for update
        `;
        if (!locked) return null;
        if (labelIds) {
          await requireLabels(transaction, organizationId, labelIds);
        }
        const [row] = await transaction<GoalRow[]>`
          update goals
          set title = ${update.title},
              detailed_description = ${update.detailedDescription},
              owner_user_id = ${update.ownerUserId},
              criteria = ${update.criteria},
              updated_by_user_id = ${update.updatedByUserId},
              updated_at = now()
          where id = ${goalId}::uuid
          returning *
        `;
        if (!row) return null;
        if (labelIds) {
          await transaction`
            delete from goal_label_assignments
            where goal_id = ${goalId}::uuid
          `;
          await assignLabels(transaction, goalId, labelIds);
        }
        return (await attachLabels(transaction, [row]))[0]!;
      });
    },

    async listUpdates({ organizationId, goalId }) {
      const rows = await sql<GoalUpdateRow[]>`
        select *
        from goal_updates
        where organization_id = ${organizationId}::uuid
          and goal_id = ${goalId}::uuid
        order by revision
      `;
      return rows.map(toGoalUpdateRecord);
    },

    async appendUpdate(input) {
      return sql.begin(async (transaction) => {
        const [goal] = await transaction<GoalRow[]>`
          select *
          from goals
          where organization_id = ${input.organizationId}::uuid
            and id = ${input.goalId}::uuid
            and (${input.allowAll} or owner_user_id = ${input.actorUserId})
          for update
        `;
        if (!goal) throw new GoalRepositoryError("goal_not_found");

        const [existing] = await transaction<GoalUpdateRow[]>`
          select *
          from goal_updates
          where goal_id = ${input.goalId}::uuid
            and idempotency_key = ${input.idempotencyKey}
        `;
        if (existing) {
          if (matchesGoalUpdate(existing, input)) {
            return toGoalUpdateRecord(existing);
          }
          throw new GoalRepositoryError("idempotency_conflict");
        }

        const currentRevision = Number(goal.revision);
        if (currentRevision !== input.expectedRevision) {
          throw new GoalRepositoryError("revision_conflict");
        }
        const revision = currentRevision + 1;
        const update = await insertGoalUpdate(transaction, {
          ...input,
          revision
        });
        await transaction`
          update goals
          set status = ${input.status}::goal_status,
              revision = ${revision},
              updated_by_user_id = ${input.attribution.authorityUserId},
              updated_at = now()
          where id = ${input.goalId}::uuid
        `;
        return update;
      });
    },

    async listLabels(organizationId) {
      const rows = await sql<GoalLabelRow[]>`
        select *
        from goal_labels
        where organization_id = ${organizationId}::uuid
        order by lower(name), id
      `;
      return rows.map(toLabelRecord);
    },

    async getLabel(organizationId, labelId) {
      const [row] = await sql<GoalLabelRow[]>`
        select *
        from goal_labels
        where organization_id = ${organizationId}::uuid
          and id = ${labelId}::uuid
      `;
      return row ? toLabelRecord(row) : null;
    },

    async insertLabel(record) {
      try {
        const [row] = await sql<GoalLabelRow[]>`
          insert into goal_labels (
            organization_id,
            name,
            color,
            description,
            created_by_user_id,
            updated_by_user_id
          ) values (
            ${record.organizationId}::uuid,
            ${record.name},
            ${record.color},
            ${record.description},
            ${record.createdByUserId},
            ${record.updatedByUserId}
          )
          returning *
        `;
        if (!row) throw new Error("Goal label insert did not return a record");
        return toLabelRecord(row);
      } catch (error) {
        if (isUniqueViolation(error)) return null;
        throw error;
      }
    },

    async updateLabel({
      organizationId,
      labelId,
      name,
      color,
      description,
      updatedByUserId
    }) {
      try {
        const [row] = await sql<GoalLabelRow[]>`
          update goal_labels
          set name = ${name},
              color = ${color},
              description = ${description},
              updated_by_user_id = ${updatedByUserId},
              updated_at = now()
          where organization_id = ${organizationId}::uuid
            and id = ${labelId}::uuid
          returning *
        `;
        return row ? toLabelRecord(row) : null;
      } catch (error) {
        if (isUniqueViolation(error)) return "conflict";
        throw error;
      }
    },

    async deleteLabel(organizationId, labelId) {
      return sql.begin(async (transaction) => {
        const [label] = await transaction<{ id: string }[]>`
          select id
          from goal_labels
          where organization_id = ${organizationId}::uuid
            and id = ${labelId}::uuid
          for update
        `;
        if (!label) return "not_found" as const;
        const [usage] = await transaction<{ used: boolean }[]>`
          select exists (
            select 1
            from goal_label_assignments
            where label_id = ${labelId}::uuid
          ) as used
        `;
        if (usage?.used) return "in_use" as const;
        await transaction`
          delete from goal_labels
          where organization_id = ${organizationId}::uuid
            and id = ${labelId}::uuid
        `;
        return "deleted" as const;
      });
    }
  };
}

async function insertGoalUpdate(
  sql: SQL,
  input: NewGoalUpdateInput
): Promise<GoalStatusUpdateRecord> {
  const [row] = await sql<GoalUpdateRow[]>`
    insert into goal_updates (
      organization_id,
      goal_id,
      revision,
      status,
      summary,
      details,
      authority_user_id,
      actor_kind,
      actor_id,
      actor_run_id,
      authn_kind,
      authn_subject_id,
      client_name,
      client_version,
      idempotency_key
    ) values (
      ${input.organizationId}::uuid,
      ${input.goalId}::uuid,
      ${input.revision},
      ${input.status}::goal_status,
      ${input.summary},
      ${input.details},
      ${input.attribution.authorityUserId},
      ${input.attribution.actor.kind}::goal_actor_kind,
      ${input.attribution.actor.id},
      ${input.attribution.actor.runId},
      ${input.attribution.authentication.kind}::goal_authn_kind,
      ${input.attribution.authentication.subjectId},
      ${input.attribution.clientInfo?.name ?? null},
      ${input.attribution.clientInfo?.version ?? null},
      ${input.idempotencyKey}
    )
    returning *
  `;
  if (!row) throw new Error("Goal update insert did not return a record");
  return toGoalUpdateRecord(row);
}

function matchesGoalUpdate(
  row: GoalUpdateRow,
  input: Omit<NewGoalUpdateInput, "revision"> & { expectedRevision: number }
): boolean {
  const clientInfo = input.attribution.clientInfo;
  return (
    Number(row.revision) === input.expectedRevision + 1 &&
    row.status === input.status &&
    row.summary === input.summary &&
    row.details === input.details &&
    row.authority_user_id === input.attribution.authorityUserId &&
    row.actor_kind === input.attribution.actor.kind &&
    row.actor_id === input.attribution.actor.id &&
    row.actor_run_id === input.attribution.actor.runId &&
    row.authn_kind === input.attribution.authentication.kind &&
    row.authn_subject_id === input.attribution.authentication.subjectId &&
    row.client_name === (clientInfo?.name ?? null) &&
    row.client_version === (clientInfo?.version ?? null)
  );
}

async function requireLabels(
  sql: SQL,
  organizationId: string,
  labelIds: string[]
) {
  if (labelIds.length === 0) return;
  const rows = await sql<{ id: string }[]>`
    select id
    from goal_labels
    where organization_id = ${organizationId}::uuid
      and id = any(${sql.array(labelIds, "UUID")})
  `;
  if (rows.length !== labelIds.length) {
    throw new GoalRepositoryError("invalid_labels");
  }
}

async function assignLabels(sql: SQL, goalId: string, labelIds: string[]) {
  for (const labelId of labelIds) {
    await sql`
      insert into goal_label_assignments (goal_id, label_id)
      values (${goalId}::uuid, ${labelId}::uuid)
    `;
  }
}

async function attachLabels(sql: SQL, rows: GoalRow[]): Promise<GoalRecord[]> {
  if (rows.length === 0) return [];
  const goalIds = rows.map((row) => row.id);
  const labels = await sql<(GoalLabelRow & { goal_id: string })[]>`
    select a.goal_id, l.*
    from goal_label_assignments a
    join goal_labels l on l.id = a.label_id
    where a.goal_id = any(${sql.array(goalIds, "UUID")})
    order by lower(l.name), l.id
  `;
  const byGoal = new Map<string, GoalLabelRecord[]>();
  for (const row of labels) {
    const values = byGoal.get(row.goal_id) ?? [];
    values.push(toLabelRecord(row));
    byGoal.set(row.goal_id, values);
  }
  return rows.map((row) => toGoalRecord(row, byGoal.get(row.id) ?? []));
}

function toGoalRecord(row: GoalRow, labels: GoalLabelRecord[]): GoalRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    detailedDescription: row.detailed_description,
    status: row.status,
    ownerUserId: row.owner_user_id,
    labels,
    criteria: toCriteria(row.criteria),
    revision: Number(row.revision),
    createdAt: toDate(row.created_at),
    createdByUserId: row.created_by_user_id,
    updatedAt: toDate(row.updated_at),
    updatedByUserId: row.updated_by_user_id
  };
}

function toCriteria(value: GoalRow["criteria"]): GoalCriterion[] {
  const criteria: GoalCriterion[] =
    typeof value === "string"
      ? (JSON.parse(value) as GoalCriterion[])
      : value;
  return criteria.map((criterion) => ({ ...criterion }));
}

function toLabelRecord(row: GoalLabelRow): GoalLabelRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    color: row.color,
    description: row.description,
    createdAt: toDate(row.created_at),
    createdByUserId: row.created_by_user_id,
    updatedAt: toDate(row.updated_at),
    updatedByUserId: row.updated_by_user_id
  };
}

function toGoalUpdateRecord(row: GoalUpdateRow): GoalStatusUpdateRecord {
  const actor: GoalActor =
    row.actor_kind === "agent"
      ? { kind: "agent", id: row.actor_id, runId: row.actor_run_id }
      : { kind: row.actor_kind, id: row.actor_id, runId: null };
  const clientInfo: GoalClientInfo | null =
    row.client_name && row.client_version
      ? { name: row.client_name, version: row.client_version }
      : null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    goalId: row.goal_id,
    revision: Number(row.revision),
    status: row.status,
    summary: row.summary,
    details: row.details,
    authorityUserId: row.authority_user_id,
    actor,
    authentication: {
      kind: row.authn_kind,
      subjectId: row.authn_subject_id
    },
    clientInfo,
    idempotencyKey: row.idempotency_key,
    createdAt: toDate(row.created_at)
  };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "errno" in error &&
    (error as { errno?: unknown }).errno === "23505"
  );
}
