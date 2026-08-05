import { SQL } from "bun";
import type {
  ApiTokenRecord,
  ApiTokenRepository,
  ApiTokenScope,
  NewApiTokenRecord
} from "./types";

type ApiTokenRow = {
  id: string;
  owner_user_id: string;
  organization_id: string | null;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes: string[];
  expires_at: Date | string;
  last_used_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
};

export function createPostgresApiTokenRepository(
  sql: SQL
): ApiTokenRepository {
  return {
    async listActive(ownerUserId, organizationId, now) {
      const rows = await sql<ApiTokenRow[]>`
        select *
        from api_tokens
        where owner_user_id = ${ownerUserId}
          and organization_id = ${organizationId}::uuid
          and revoked_at is null
          and expires_at > ${now}
        order by created_at desc
      `;
      return rows.map(toRecord);
    },

    async insert(record: NewApiTokenRecord) {
      const [row] = await sql<ApiTokenRow[]>`
        insert into api_tokens (
          owner_user_id,
          organization_id,
          name,
          token_prefix,
          token_hash,
          scopes,
          expires_at,
          created_at
        ) values (
          ${record.ownerUserId},
          ${record.organizationId}::uuid,
          ${record.name},
          ${record.prefix},
          ${record.tokenHash},
          ${sql.array(record.scopes, "TEXT")},
          ${record.expiresAt},
          ${record.createdAt}
        )
        returning *
      `;
      if (!row) throw new Error("API token insert did not return a record");
      return toRecord(row);
    },

    async findActiveByHash(tokenHash, now) {
      const [row] = await sql<ApiTokenRow[]>`
        select *
        from api_tokens
        where token_hash = ${tokenHash}
          and organization_id is not null
          and revoked_at is null
          and expires_at > ${now}
        limit 1
      `;
      return row ? toRecord(row) : null;
    },

    async revoke(ownerUserId, organizationId, tokenId, revokedAt) {
      const [row] = await sql<ApiTokenRow[]>`
        update api_tokens
        set revoked_at = coalesce(revoked_at, ${revokedAt})
        where id = ${tokenId}::uuid
          and owner_user_id = ${ownerUserId}
          and organization_id = ${organizationId}::uuid
        returning *
      `;
      return row ? toRecord(row) : null;
    },

    async touchLastUsed(tokenId, usedAt, staleBefore) {
      await sql`
        update api_tokens
        set last_used_at = ${usedAt}
        where id = ${tokenId}::uuid
          and revoked_at is null
          and (last_used_at is null or last_used_at < ${staleBefore})
      `;
    }
  };
}

export async function migrateApiDatabase(sql: SQL): Promise<void> {
  await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext('goalkeeper_api_migrations'))`;
    await transaction`
      create table if not exists api_schema_migrations (
        id text primary key,
        applied_at timestamptz not null default now()
      )
    `;

    const applied = await transaction<{ id: string }[]>`
      select id from api_schema_migrations where id = '001_api_tokens'
    `;
    if (applied.length === 0) {
      await transaction`
        create table api_tokens (
        id uuid primary key default gen_random_uuid(),
        owner_user_id text not null,
        name text not null,
        token_prefix text not null unique,
        token_hash text not null unique,
        scopes text[] not null,
        expires_at timestamptz not null,
        last_used_at timestamptz,
        revoked_at timestamptz,
        created_at timestamptz not null default now(),
        constraint api_tokens_name_length_check
          check (char_length(name) between 1 and 100),
        constraint api_tokens_prefix_format_check
          check (token_prefix ~ '^gk_[0-9a-f]{16}$'),
        constraint api_tokens_hash_format_check
          check (token_hash ~ '^[0-9a-f]{64}$'),
        constraint api_tokens_scopes_nonempty_check
          check (cardinality(scopes) > 0),
        constraint api_tokens_scopes_supported_check
          check (scopes <@ array[
            'goals:read:own',
            'goals:write:own',
            'goals:read:all',
            'goals:write:all'
          ]::text[]),
        constraint api_tokens_expiry_check
          check (expires_at > created_at)
        )
      `;
      await transaction`
        create index api_tokens_owner_created_idx
        on api_tokens(owner_user_id, created_at desc)
      `;
      await transaction`
        insert into api_schema_migrations (id) values ('001_api_tokens')
      `;
    }

    const emailAuthApplied = await transaction<{ id: string }[]>`
      select id from api_schema_migrations where id = '002_email_auth'
    `;
    if (emailAuthApplied.length === 0) {
      await transaction`
        create table auth_users (
          id uuid primary key default gen_random_uuid(),
          email text not null unique,
          display_name text not null,
          email_verified boolean not null default false,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint auth_users_email_normalized_check check (email = lower(email)),
          constraint auth_users_display_name_length_check
            check (char_length(display_name) between 1 and 100)
        )
      `;
      await transaction`
        create table auth_password_credentials (
          user_id uuid primary key references auth_users(id) on delete cascade,
          password_hash text not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await transaction`
        create table auth_sessions (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null references auth_users(id) on delete cascade,
          token_hash text not null unique,
          expires_at timestamptz not null,
          last_used_at timestamptz not null default now(),
          revoked_at timestamptz,
          created_at timestamptz not null default now(),
          constraint auth_sessions_hash_format_check
            check (token_hash ~ '^[0-9a-f]{64}$'),
          constraint auth_sessions_expiry_check check (expires_at > created_at)
        )
      `;
      await transaction`
        create index auth_sessions_user_created_idx
        on auth_sessions(user_id, created_at desc)
      `;
      await transaction`
        create table auth_verification_tokens (
          id uuid primary key default gen_random_uuid(),
          user_id uuid not null references auth_users(id) on delete cascade,
          token_hash text not null unique,
          expires_at timestamptz not null,
          used_at timestamptz,
          created_at timestamptz not null default now(),
          constraint auth_verification_tokens_hash_format_check
            check (token_hash ~ '^[0-9a-f]{64}$'),
          constraint auth_verification_tokens_expiry_check
            check (expires_at > created_at)
        )
      `;
      await transaction`
        create index auth_verification_tokens_user_created_idx
        on auth_verification_tokens(user_id, created_at desc)
      `;
      await transaction`
        insert into api_schema_migrations (id) values ('002_email_auth')
      `;
    }

    const goalTokenScopesApplied = await transaction<{ id: string }[]>`
      select id from api_schema_migrations where id = '003_goal_token_scopes'
    `;
    if (goalTokenScopesApplied.length === 0) {
      await transaction`
        alter table api_tokens
        drop constraint api_tokens_scopes_supported_check
      `;
      await transaction`
        delete from api_tokens
        where not (
          scopes && array['goals:read', 'goals:write']::text[]
        )
      `;
      await transaction`
        update api_tokens
        set scopes = array_remove(array[
          case
            when 'goals:read' = any(scopes) then 'goals:read:own'
          end,
          case
            when 'goals:write' = any(scopes) then 'goals:write:own'
          end
        ], null)
      `;
      await transaction`
        alter table api_tokens
        add constraint api_tokens_scopes_supported_check
        check (scopes <@ array[
          'goals:read:own',
          'goals:write:own',
          'goals:read:all',
          'goals:write:all'
        ]::text[])
      `;
      await transaction`
        insert into api_schema_migrations (id)
        values ('003_goal_token_scopes')
      `;
    }

    const organizationsApplied = await transaction<{ id: string }[]>`
      select id from api_schema_migrations where id = '004_organizations'
    `;
    if (organizationsApplied.length === 0) {
      await transaction`
        create table organizations (
          id uuid primary key default gen_random_uuid(),
          name text not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint organizations_name_length_check
            check (char_length(name) between 1 and 100)
        )
      `;
      await transaction`
        create table organization_memberships (
          id uuid primary key default gen_random_uuid(),
          organization_id uuid not null references organizations(id) on delete cascade,
          user_id text not null,
          role text not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          constraint organization_memberships_role_check check (role in ('owner')),
          unique (organization_id, user_id)
        )
      `;
      await transaction`
        create index organization_memberships_user_created_idx
        on organization_memberships(user_id, created_at asc)
      `;
      await transaction`
        create table organization_preferences (
          user_id text primary key,
          active_organization_id uuid not null references organizations(id) on delete cascade,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )
      `;
      await transaction`
        alter table api_tokens
        add column organization_id uuid references organizations(id) on delete cascade
      `;
      const legacyTokenOwners = await transaction<
        Array<{ owner_user_id: string; display_name: string | null }>
      >`
        select distinct t.owner_user_id, u.display_name
        from api_tokens t
        left join auth_users u on u.id::text = t.owner_user_id
      `;
      for (const owner of legacyTokenOwners) {
        const [organization] = await transaction<{ id: string }[]>`
          insert into organizations (name)
          values (${owner.display_name ?? "Personal organization"})
          returning id
        `;
        if (!organization) {
          throw new Error("Organization backfill did not return a record");
        }
        await transaction`
          insert into organization_memberships (organization_id, user_id, role)
          values (${organization.id}::uuid, ${owner.owner_user_id}, 'owner')
        `;
        await transaction`
          insert into organization_preferences (user_id, active_organization_id)
          values (${owner.owner_user_id}, ${organization.id}::uuid)
        `;
        await transaction`
          update api_tokens
          set organization_id = ${organization.id}::uuid
          where owner_user_id = ${owner.owner_user_id}
        `;
      }
      await transaction`
        alter table api_tokens alter column organization_id set not null
      `;
      await transaction`
        create index api_tokens_organization_owner_created_idx
        on api_tokens(organization_id, owner_user_id, created_at desc)
      `;
      await transaction`
        insert into api_schema_migrations (id) values ('004_organizations')
      `;
    }

    const membershipRolesApplied = await transaction<{ id: string }[]>`
      select id from api_schema_migrations where id = '005_membership_roles'
    `;
    if (membershipRolesApplied.length === 0) {
      await transaction`
        alter table organization_memberships
        add column display_name text,
        add column email text
      `;
      await transaction`
        update organization_memberships m
        set display_name = coalesce(u.display_name, m.user_id),
            email = u.email
        from auth_users u
        where u.id::text = m.user_id
      `;
      await transaction`
        update organization_memberships
        set display_name = user_id
        where display_name is null
      `;
      await transaction`
        alter table organization_memberships
        alter column display_name set not null,
        drop constraint organization_memberships_role_check,
        add constraint organization_memberships_role_check
          check (role in ('owner', 'admin', 'member'))
      `;
      await transaction`
        create index organization_memberships_organization_role_idx
        on organization_memberships(organization_id, role, created_at asc)
      `;
      await transaction`
        insert into api_schema_migrations (id)
        values ('005_membership_roles')
      `;
    }

    const namespaceScopesApplied = await transaction<{ id: string }[]>`
      select id from api_schema_migrations where id = '006_namespace_scopes'
    `;
    if (namespaceScopesApplied.length === 0) {
      await transaction`
        alter table api_tokens
        drop constraint if exists api_tokens_scopes_supported_check
      `;
      await transaction`
        update api_tokens
        set scopes = array_replace(
          array_replace(scopes, 'goals:read:own', 'goals:read'),
          'goals:write:own',
          'goals:write'
        )
        where scopes && array['goals:read:own', 'goals:write:own']::text[]
      `;
      await transaction`
        alter table api_tokens
        add constraint api_tokens_scopes_supported_check
        check (scopes <@ array[
          'goals:read',
          'goals:write',
          'goals:read:all',
          'goals:write:all'
        ]::text[])
      `;
      await transaction`
        insert into api_schema_migrations (id)
        values ('006_namespace_scopes')
      `;
    }

    const goalsApplied = await transaction<{ id: string }[]>`
      select id from api_schema_migrations where id = '007_goals_and_labels'
    `;
    if (goalsApplied.length === 0) {
      await transaction`
        create table goal_labels (
          id uuid primary key default gen_random_uuid(),
          organization_id uuid not null references organizations(id) on delete cascade,
          name text not null,
          color text,
          description text,
          created_at timestamptz not null default now(),
          created_by text not null,
          updated_at timestamptz not null default now(),
          updated_by text not null,
          constraint goal_labels_name_length_check
            check (char_length(name) between 1 and 64),
          constraint goal_labels_color_length_check
            check (color is null or char_length(color) between 1 and 32),
          constraint goal_labels_description_length_check
            check (description is null or char_length(description) between 1 and 500),
          unique (organization_id, id)
        )
      `;
      await transaction`
        create unique index goal_labels_organization_name_idx
        on goal_labels (organization_id, lower(name))
      `;
      await transaction`
        create table goals (
          id uuid primary key default gen_random_uuid(),
          organization_id uuid not null references organizations(id) on delete cascade,
          title text not null,
          prompt text not null,
          status text not null default 'active',
          owner_user_id text not null,
          measurement_method text,
          created_at timestamptz not null default now(),
          created_by text not null,
          updated_at timestamptz not null default now(),
          updated_by text not null,
          constraint goals_title_length_check
            check (char_length(title) between 1 and 200),
          constraint goals_prompt_length_check
            check (char_length(prompt) between 1 and 50000),
          constraint goals_status_check
            check (status in ('active', 'completed', 'paused', 'archived')),
          constraint goals_measurement_method_length_check
            check (
              measurement_method is null
              or char_length(measurement_method) between 1 and 10000
            ),
          unique (organization_id, id),
          constraint goals_owner_membership_fk
            foreign key (organization_id, owner_user_id)
            references organization_memberships (organization_id, user_id)
        )
      `;
      await transaction`
        create index goals_organization_updated_idx
        on goals (organization_id, updated_at desc)
      `;
      await transaction`
        create index goals_organization_owner_updated_idx
        on goals (organization_id, owner_user_id, updated_at desc)
      `;
      await transaction`
        create table goal_label_assignments (
          goal_id uuid not null references goals(id) on delete cascade,
          label_id uuid not null references goal_labels(id) on delete restrict,
          created_at timestamptz not null default now(),
          primary key (goal_id, label_id)
        )
      `;
      await transaction`
        create index goal_label_assignments_label_idx
        on goal_label_assignments (label_id, goal_id)
      `;
      await transaction`
        insert into api_schema_migrations (id)
        values ('007_goals_and_labels')
      `;
    }
  });
}

function toRecord(row: ApiTokenRow): ApiTokenRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    organizationId: requiredOrganizationId(row),
    name: row.name,
    prefix: row.token_prefix,
    tokenHash: row.token_hash,
    scopes: row.scopes as ApiTokenScope[],
    expiresAt: toDate(row.expires_at),
    lastUsedAt: row.last_used_at ? toDate(row.last_used_at) : null,
    revokedAt: row.revoked_at ? toDate(row.revoked_at) : null,
    createdAt: toDate(row.created_at)
  };
}

function requiredOrganizationId(row: ApiTokenRow): string {
  if (!row.organization_id) {
    throw new Error(`API token ${row.id} is missing its organization`);
  }
  return row.organization_id;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
