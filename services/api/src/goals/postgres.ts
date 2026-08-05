import { SQL } from "bun";
import type {
  GoalLabelRecord,
  GoalRecord,
  GoalRepository,
  GoalStatus
} from "./types";
import { GoalRepositoryError } from "./types";

type GoalRow = {
  id: string;
  organization_id: string;
  title: string;
  prompt: string;
  status: GoalStatus;
  owner_user_id: string;
  measurement_method: string | null;
  created_at: Date | string;
  created_by: string;
  updated_at: Date | string;
  updated_by: string;
};

type GoalLabelRow = {
  id: string;
  organization_id: string;
  name: string;
  color: string | null;
  description: string | null;
  created_at: Date | string;
  created_by: string;
  updated_at: Date | string;
  updated_by: string;
};

export function createPostgresGoalRepository(sql: SQL): GoalRepository {
  return {
    async listGoals({ organizationId, ownerUserId, status, labelId }) {
      const rows = await sql<GoalRow[]>`
        select g.*
        from goals g
        where g.organization_id = ${organizationId}::uuid
          and (${ownerUserId}::text is null or g.owner_user_id = ${ownerUserId})
          and (${status}::text is null or g.status = ${status})
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

    async insertGoal(record, labelIds) {
      return sql.begin(async (transaction) => {
        await requireLabels(transaction, record.organizationId, labelIds);
        const [row] = await transaction<GoalRow[]>`
          insert into goals (
            organization_id,
            title,
            prompt,
            status,
            owner_user_id,
            measurement_method,
            created_by,
            updated_by
          ) values (
            ${record.organizationId}::uuid,
            ${record.title},
            ${record.prompt},
            ${record.status},
            ${record.ownerUserId},
            ${record.measurementMethod},
            ${record.createdBy},
            ${record.updatedBy}
          )
          returning *
        `;
        if (!row) throw new Error("Goal insert did not return a record");
        await assignLabels(transaction, row.id, labelIds);
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
              prompt = ${update.prompt},
              status = ${update.status},
              owner_user_id = ${update.ownerUserId},
              measurement_method = ${update.measurementMethod},
              updated_by = ${update.updatedBy},
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

    async deleteGoal({ organizationId, goalId, actorUserId, allowAll }) {
      const rows = await sql<{ id: string }[]>`
        delete from goals
        where organization_id = ${organizationId}::uuid
          and id = ${goalId}::uuid
          and (${allowAll} or owner_user_id = ${actorUserId})
        returning id
      `;
      return rows.length === 1;
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
            created_by,
            updated_by
          ) values (
            ${record.organizationId}::uuid,
            ${record.name},
            ${record.color},
            ${record.description},
            ${record.createdBy},
            ${record.updatedBy}
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
      updatedBy
    }) {
      try {
        const [row] = await sql<GoalLabelRow[]>`
          update goal_labels
          set name = ${name},
              color = ${color},
              description = ${description},
              updated_by = ${updatedBy},
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
    prompt: row.prompt,
    status: row.status,
    ownerUserId: row.owner_user_id,
    labels,
    measurementMethod: row.measurement_method,
    createdAt: toDate(row.created_at),
    createdBy: row.created_by,
    updatedAt: toDate(row.updated_at),
    updatedBy: row.updated_by
  };
}

function toLabelRecord(row: GoalLabelRow): GoalLabelRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    color: row.color,
    description: row.description,
    createdAt: toDate(row.created_at),
    createdBy: row.created_by,
    updatedAt: toDate(row.updated_at),
    updatedBy: row.updated_by
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
