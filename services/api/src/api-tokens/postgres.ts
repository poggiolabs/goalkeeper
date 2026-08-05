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
    async listActive(ownerUserId, now) {
      const rows = await sql<ApiTokenRow[]>`
        select *
        from api_tokens
        where owner_user_id = ${ownerUserId}
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
          name,
          token_prefix,
          token_hash,
          scopes,
          expires_at,
          created_at
        ) values (
          ${record.ownerUserId},
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
          and revoked_at is null
          and expires_at > ${now}
        limit 1
      `;
      return row ? toRecord(row) : null;
    },

    async revoke(ownerUserId, tokenId, revokedAt) {
      const [row] = await sql<ApiTokenRow[]>`
        update api_tokens
        set revoked_at = coalesce(revoked_at, ${revokedAt})
        where id = ${tokenId}::uuid
          and owner_user_id = ${ownerUserId}
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
  });
}

function toRecord(row: ApiTokenRow): ApiTokenRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
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

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
