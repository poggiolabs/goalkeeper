import { SQL } from "bun";
import type {
  OrganizationMember,
  OrganizationRepository,
  OrganizationRole,
  OrganizationSummary
} from "./types";

type OrganizationRow = {
  id: string;
  name: string;
  role: OrganizationRole;
};

type OrganizationMemberRow = {
  user_id: string;
  display_name: string;
  email: string | null;
  role: OrganizationRole;
};

export function createPostgresOrganizationRepository(
  sql: SQL
): OrganizationRepository {
  return {
    async ensureForUser(user) {
      return sql.begin(async (transaction) => {
        await lockUserOrganizations(transaction, user.id);
        let organizations = await loadOrganizations(transaction, user.id);

        if (organizations.length === 0) {
          const organization = await insertOrganization(
            transaction,
            user,
            user.displayName
          );
          organizations = [organization];
        }
        await syncMembershipIdentity(transaction, user);

        const activeOrganizationId = await resolveActiveOrganizationId(
          transaction,
          user.id,
          organizations
        );
        return { activeOrganizationId, organizations };
      });
    },

    async createForUser(user, name) {
      return sql.begin(async (transaction) => {
        await lockUserOrganizations(transaction, user.id);
        await syncMembershipIdentity(transaction, user);
        const organization = await insertOrganization(transaction, user, name);
        await setActiveOrganization(transaction, user.id, organization.id);
        const organizations = await loadOrganizations(transaction, user.id);
        return { activeOrganizationId: organization.id, organizations };
      });
    },

    async switchForUser(userId, organizationId) {
      return sql.begin(async (transaction) => {
        await lockUserOrganizations(transaction, userId);
        const organizations = await loadOrganizations(transaction, userId);
        if (!organizations.some((organization) => organization.id === organizationId)) {
          return null;
        }
        await setActiveOrganization(transaction, userId, organizationId);
        return { activeOrganizationId: organizationId, organizations };
      });
    },

    async updateNameForUser(userId, organizationId, name) {
      const rows = await sql<{ id: string }[]>`
        update organizations o
        set name = ${name}, updated_at = now()
        where o.id = ${organizationId}::uuid
          and exists (
            select 1
            from organization_memberships m
            where m.organization_id = o.id
              and m.user_id = ${userId}
              and m.role in ('owner', 'admin')
          )
        returning o.id
      `;
      return rows.length === 1;
    },

    async listMembersForUser(userId, organizationId) {
      const access = await sql<{ allowed: boolean }[]>`
        select exists (
          select 1 from organization_memberships
          where organization_id = ${organizationId}::uuid
            and user_id = ${userId}
        ) as allowed
      `;
      if (!access[0]?.allowed) return null;
      return loadMembers(sql, organizationId);
    },

    async updateMemberRoleForUser(
      actorUserId,
      organizationId,
      memberUserId,
      role
    ) {
      const rows = await sql<OrganizationMemberRow[]>`
        update organization_memberships target
        set role = ${role}, updated_at = now()
        where target.organization_id = ${organizationId}::uuid
          and target.user_id = ${memberUserId}
          and target.role <> 'owner'
          and exists (
            select 1
            from organization_memberships actor
            where actor.organization_id = target.organization_id
              and actor.user_id = ${actorUserId}
              and actor.role in ('owner', 'admin')
          )
        returning target.user_id, target.display_name, target.email, target.role
      `;
      return rows[0] ? toMember(rows[0]) : null;
    },

    async getRoleForUser(userId, organizationId) {
      const [row] = await sql<{ role: OrganizationRole }[]>`
        select role
        from organization_memberships
        where organization_id = ${organizationId}::uuid
          and user_id = ${userId}
      `;
      return row?.role ?? null;
    }
  };
}

async function lockUserOrganizations(sql: SQL, userId: string) {
  await sql`select pg_advisory_xact_lock(hashtext(${`goalkeeper:organizations:${userId}`}))`;
}

async function loadOrganizations(
  sql: SQL,
  userId: string
): Promise<OrganizationSummary[]> {
  const rows = await sql<OrganizationRow[]>`
    select o.id, o.name, m.role
    from organization_memberships m
    join organizations o on o.id = m.organization_id
    where m.user_id = ${userId}
    order by m.created_at asc
  `;
  return rows.map((row) => ({ id: row.id, name: row.name, role: row.role }));
}

async function insertOrganization(
  sql: SQL,
  user: { id: string; displayName: string; email: string },
  name: string
): Promise<OrganizationSummary> {
  const [organization] = await sql<{ id: string; name: string }[]>`
    insert into organizations (name) values (${name}) returning id, name
  `;
  if (!organization) throw new Error("Organization insert did not return a record");
  await sql`
    insert into organization_memberships (
      organization_id,
      user_id,
      role,
      display_name,
      email
    ) values (
      ${organization.id}::uuid,
      ${user.id},
      'owner',
      ${user.displayName},
      ${user.email}
    )
  `;
  return { ...organization, role: "owner" };
}

async function syncMembershipIdentity(
  sql: SQL,
  user: { id: string; displayName: string; email: string }
) {
  await sql`
    update organization_memberships
    set display_name = ${user.displayName},
        email = ${user.email},
        updated_at = now()
    where user_id = ${user.id}
      and (display_name <> ${user.displayName} or email is distinct from ${user.email})
  `;
}

async function loadMembers(
  sql: SQL,
  organizationId: string
): Promise<OrganizationMember[]> {
  const rows = await sql<OrganizationMemberRow[]>`
    select user_id, display_name, email, role
    from organization_memberships
    where organization_id = ${organizationId}::uuid
    order by
      case role when 'owner' then 0 when 'admin' then 1 else 2 end,
      lower(display_name),
      created_at
  `;
  return rows.map(toMember);
}

function toMember(row: OrganizationMemberRow): OrganizationMember {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    email: row.email,
    role: row.role
  };
}

async function resolveActiveOrganizationId(
  sql: SQL,
  userId: string,
  organizations: OrganizationSummary[]
): Promise<string> {
  const [preference] = await sql<{ active_organization_id: string }[]>`
    select active_organization_id
    from organization_preferences
    where user_id = ${userId}
  `;
  const active = organizations.find(
    (organization) => organization.id === preference?.active_organization_id
  );
  const activeOrganizationId = active?.id ?? organizations[0]!.id;
  if (!active) await setActiveOrganization(sql, userId, activeOrganizationId);
  return activeOrganizationId;
}

async function setActiveOrganization(
  sql: SQL,
  userId: string,
  organizationId: string
) {
  await sql`
    insert into organization_preferences (user_id, active_organization_id)
    values (${userId}, ${organizationId}::uuid)
    on conflict (user_id) do update
    set active_organization_id = excluded.active_organization_id,
        updated_at = now()
  `;
}
