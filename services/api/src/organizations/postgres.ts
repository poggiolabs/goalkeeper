import { SQL } from "bun";
import type {
  AcceptedInvitation,
  InvitationRejection,
  InvitationStatus,
  OrganizationInvitation,
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

type OrganizationInvitationRow = {
  id: string;
  organization_id: string;
  email: string;
  role: Exclude<OrganizationRole, "owner">;
  status: InvitationStatus;
  invited_by_user_id: string;
  expires_at: Date | string;
  created_at: Date | string;
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
    },

    async createInvitation(actorUserId, organizationId, input) {
      return sql.begin(async (transaction) => {
        if (!(await isAdministrator(transaction, actorUserId, organizationId))) {
          return null;
        }
        // Close a lapsed invitation first: the pending unique index cannot
        // exclude expired rows, so a stale one would block reinvitation.
        await transaction`
          update organization_invitations
          set status = 'expired', updated_at = now()
          where organization_id = ${organizationId}::uuid
            and email = ${input.email}
            and status = 'pending'
            and expires_at <= now()
        `;
        const [row] = await transaction<OrganizationInvitationRow[]>`
          insert into organization_invitations (
            organization_id,
            email,
            role,
            token_hash,
            invited_by_user_id,
            expires_at
          ) values (
            ${organizationId}::uuid,
            ${input.email},
            ${input.role},
            ${input.tokenHash},
            ${actorUserId},
            ${input.expiresAt}
          )
          returning
            id, organization_id, email, role, status,
            invited_by_user_id, expires_at, created_at
        `;
        if (!row) throw new Error("Invitation insert did not return a record");
        return toInvitation(row);
      });
    },

    async listInvitations(userId, organizationId) {
      if (!(await isMember(sql, userId, organizationId))) return null;
      const rows = await sql<OrganizationInvitationRow[]>`
        select
          id, organization_id, email, role, status,
          invited_by_user_id, expires_at, created_at
        from organization_invitations
        where organization_id = ${organizationId}::uuid
          and status = 'pending'
        order by created_at desc
      `;
      return rows.map(toInvitation);
    },

    async revokeInvitation(actorUserId, organizationId, invitationId) {
      const rows = await sql<{ id: string }[]>`
        update organization_invitations target
        set status = 'revoked', revoked_at = now(), updated_at = now()
        where target.id = ${invitationId}::uuid
          and target.organization_id = ${organizationId}::uuid
          and target.status = 'pending'
          and exists (
            select 1
            from organization_memberships actor
            where actor.organization_id = target.organization_id
              and actor.user_id = ${actorUserId}
              and actor.role in ('owner', 'admin')
          )
        returning target.id
      `;
      return rows.length === 1;
    },

    async resendInvitation(actorUserId, organizationId, invitationId, replacement) {
      const rows = await sql<OrganizationInvitationRow[]>`
        update organization_invitations target
        set token_hash = ${replacement.tokenHash},
            expires_at = ${replacement.expiresAt},
            updated_at = now()
        where target.id = ${invitationId}::uuid
          and target.organization_id = ${organizationId}::uuid
          and target.status = 'pending'
          and exists (
            select 1
            from organization_memberships actor
            where actor.organization_id = target.organization_id
              and actor.user_id = ${actorUserId}
              and actor.role in ('owner', 'admin')
          )
        returning
          target.id, target.organization_id, target.email, target.role,
          target.status, target.invited_by_user_id, target.expires_at,
          target.created_at
      `;
      return rows[0] ? toInvitation(rows[0]) : null;
    },

    async acceptInvitation(user, tokenHash) {
      return sql.begin(async (transaction) => {
        const [invitation] = await transaction<
          Array<{ organization_id: string; email: string; role: Exclude<OrganizationRole, "owner"> }>
        >`
          update organization_invitations
          set status = 'accepted',
              accepted_at = now(),
              accepted_by_user_id = ${user.id},
              updated_at = now()
          where token_hash = ${tokenHash}
            and status = 'pending'
            and expires_at > now()
          returning organization_id, email, role
        `;
        if (!invitation) return "invitation_not_found" satisfies InvitationRejection;

        // The invitation names an address, not an identity. Only the verified
        // holder of that address may consume it.
        if (invitation.email !== user.email.toLowerCase()) {
          throw new InvitationEmailMismatch();
        }

        const inserted = await transaction<{ organization_id: string }[]>`
          insert into organization_memberships (
            organization_id, user_id, role, display_name, email
          ) values (
            ${invitation.organization_id}::uuid,
            ${user.id},
            ${invitation.role},
            ${user.displayName},
            ${user.email}
          )
          on conflict (organization_id, user_id) do nothing
          returning organization_id
        `;
        if (inserted.length === 0) {
          // Already a member by another path; the invitation is still spent.
          return "invitation_already_member" satisfies InvitationRejection;
        }
        await setActiveOrganization(transaction, user.id, invitation.organization_id);
        return {
          organizationId: invitation.organization_id,
          role: invitation.role
        } satisfies AcceptedInvitation;
      }).catch((error: unknown) => {
        if (error instanceof InvitationEmailMismatch) {
          return "invitation_email_mismatch" satisfies InvitationRejection;
        }
        throw error;
      });
    }
  };
}

/** Rolls the accept transaction back so a mismatched token stays unspent. */
class InvitationEmailMismatch extends Error {
  constructor() {
    super("Invitation email does not match the authenticated session");
    this.name = "InvitationEmailMismatch";
  }
}

async function isMember(sql: SQL, userId: string, organizationId: string) {
  const [row] = await sql<{ allowed: boolean }[]>`
    select exists (
      select 1 from organization_memberships
      where organization_id = ${organizationId}::uuid
        and user_id = ${userId}
    ) as allowed
  `;
  return row?.allowed === true;
}

async function isAdministrator(sql: SQL, userId: string, organizationId: string) {
  const [row] = await sql<{ allowed: boolean }[]>`
    select exists (
      select 1 from organization_memberships
      where organization_id = ${organizationId}::uuid
        and user_id = ${userId}
        and role in ('owner', 'admin')
    ) as allowed
  `;
  return row?.allowed === true;
}

function toInvitation(row: OrganizationInvitationRow): OrganizationInvitation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    role: row.role,
    status: row.status,
    invitedByUserId: row.invited_by_user_id,
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at)
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
