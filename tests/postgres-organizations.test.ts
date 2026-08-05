import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import {
  createPostgresApiTokenRepository,
  migrateApiDatabase
} from "../services/api/src/api-tokens/postgres";
import { createApiTokenService } from "../services/api/src/api-tokens/service";
import { createPostgresOrganizationRepository } from "../services/api/src/organizations/postgres";
import { createOrganizationService } from "../services/api/src/organizations/service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("PostgreSQL organizations", () => {
  const schema = `organization_test_${crypto.randomUUID().replaceAll("-", "")}`;
  let admin: SQL;
  let database: SQL;
  let organizations: ReturnType<typeof createOrganizationService>;
  let apiTokens: ReturnType<typeof createApiTokenService>;

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
    apiTokens = createApiTokenService(
      createPostgresApiTokenRepository(database)
    );
  });

  afterAll(async () => {
    await database?.close();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.close();
  });

  test("bootstraps once under concurrency and persists switching", async () => {
    const user = {
      id: crypto.randomUUID(),
      displayName: "Grace Hopper",
      email: "grace@example.com"
    };

    const [first, concurrent] = await Promise.all([
      organizations.ensureForUser(user),
      organizations.ensureForUser(user)
    ]);
    expect(concurrent).toEqual(first);
    expect(first.organizations).toEqual([
      {
        id: first.activeOrganizationId,
        name: "Grace Hopper",
        role: "owner"
      }
    ]);

    const [{ count }] = await database<{ count: string }[]>`
      select count(*)::text as count
      from organization_memberships
      where user_id = ${user.id}
    `;
    expect(count).toBe("1");

    const created = await organizations.createForUser(user, {
      name: "Compiler Team"
    });
    expect(created.activeOrganizationId).not.toBe(first.activeOrganizationId);
    expect(created.organizations).toHaveLength(2);

    const switched = await organizations.switchForUser(user, {
      organizationId: first.activeOrganizationId
    });
    expect(switched.activeOrganizationId).toBe(first.activeOrganizationId);

    const reloaded = await organizations.ensureForUser(user);
    expect(reloaded.activeOrganizationId).toBe(first.activeOrganizationId);
  });

  test("isolates API tokens to the active organization", async () => {
    const user = {
      id: crypto.randomUUID(),
      displayName: "Token Owner",
      email: "tokens@example.com"
    };
    const first = await organizations.ensureForUser(user);
    const second = await organizations.createForUser(user, {
      name: "Second Organization"
    });

    const created = await apiTokens.create(user.id, second.activeOrganizationId, {
      name: "Second organization token",
      scopes: ["goals:read", "labels:read", "labels:write"]
    });
    expect(
      (await apiTokens.list(user.id, first.activeOrganizationId)).tokens
    ).toEqual([]);
    expect(
      (await apiTokens.list(user.id, second.activeOrganizationId)).tokens[0]?.id
    ).toBe(created.token.id);
    expect(await apiTokens.resolve(created.secret)).toMatchObject({
      userId: user.id,
      organizationId: second.activeOrganizationId,
      scopes: ["goals:read", "labels:read", "labels:write"]
    });
  });

  test("persists N:M memberships and enforces administrator role boundaries", async () => {
    const owner = {
      id: crypto.randomUUID(),
      displayName: "Organization Owner",
      email: "owner@example.com"
    };
    const admin = {
      id: crypto.randomUUID(),
      displayName: "Organization Admin",
      email: "admin@example.com"
    };
    const member = {
      id: crypto.randomUUID(),
      displayName: "Organization Member",
      email: "member@example.com"
    };
    const context = await organizations.ensureForUser(owner);

    await database`
      insert into organization_memberships (
        organization_id,
        user_id,
        role,
        display_name,
        email
      ) values
        (${context.activeOrganizationId}::uuid, ${admin.id}, 'admin', ${admin.displayName}, ${admin.email}),
        (${context.activeOrganizationId}::uuid, ${member.id}, 'member', ${member.displayName}, ${member.email})
    `;

    const renamed = await organizations.updateActiveForUser(admin, {
      name: "Administered Organization"
    });
    expect(renamed.organizations[0]?.name).toBe("Administered Organization");

    await expect(
      organizations.updateActiveForUser(member, { name: "Denied" })
    ).rejects.toMatchObject({ code: "organization_admin_required" });

    const listed = await organizations.listActiveMembersForUser(owner);
    expect(listed.members).toEqual([
      {
        userId: owner.id,
        displayName: owner.displayName,
        email: owner.email,
        role: "owner"
      },
      {
        userId: admin.id,
        displayName: admin.displayName,
        email: admin.email,
        role: "admin"
      },
      {
        userId: member.id,
        displayName: member.displayName,
        email: member.email,
        role: "member"
      }
    ]);

    const promoted = await organizations.updateActiveMemberRoleForUser(
      admin,
      member.id,
      { role: "admin" }
    );
    expect(promoted.member).toMatchObject({ userId: member.id, role: "admin" });

    await expect(
      organizations.updateActiveMemberRoleForUser(admin, owner.id, {
        role: "member"
      })
    ).rejects.toMatchObject({ code: "member_role_update_forbidden" });
  });

  test("migration backfills existing tokens without waiting for sign-in", async () => {
    const legacySchema = `organization_legacy_${crypto.randomUUID().replaceAll("-", "")}`;
    await admin.unsafe(`create schema ${legacySchema}`);
    const scopedUrl = new URL(testDatabaseUrl!);
    scopedUrl.searchParams.set("options", `-csearch_path=${legacySchema}`);
    const legacyDatabase = new SQL(scopedUrl.toString());

    try {
      const userId = crypto.randomUUID();
      const tokenId = crypto.randomUUID();
      await legacyDatabase`
        create table api_schema_migrations (
          id text primary key,
          applied_at timestamptz not null default now()
        )
      `;
      await legacyDatabase`
        insert into api_schema_migrations (id)
        values ('001_api_tokens'), ('002_email_auth'), ('003_goal_token_scopes')
      `;
      await legacyDatabase`
        create table auth_users (
          id uuid primary key,
          display_name text not null,
          email text not null
        )
      `;
      await legacyDatabase`
        create table api_tokens (
          id uuid primary key,
          owner_user_id text not null,
          name text not null,
          token_prefix text not null unique,
          token_hash text not null unique,
          scopes text[] not null,
          expires_at timestamptz not null,
          last_used_at timestamptz,
          revoked_at timestamptz,
          created_at timestamptz not null default now()
        )
      `;
      await legacyDatabase`
        insert into auth_users (id, display_name, email)
        values (${userId}::uuid, 'Legacy Owner', 'legacy@example.com')
      `;
      await legacyDatabase`
        insert into api_tokens (
          id,
          owner_user_id,
          name,
          token_prefix,
          token_hash,
          scopes,
          expires_at
        ) values (
          ${tokenId}::uuid,
          ${userId},
          'Legacy token',
          ${`gk_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`},
          ${"a".repeat(64)},
          array['goals:read:own']::text[],
          now() + interval '30 days'
        )
      `;

      await migrateApiDatabase(legacyDatabase);

      const [token] = await legacyDatabase<{
        organization_id: string;
        name: string;
        scopes: string[];
      }[]>`
        select t.organization_id, t.scopes, o.name
        from api_tokens t
        join organizations o on o.id = t.organization_id
        where t.id = ${tokenId}::uuid
      `;
      expect(token).toMatchObject({
        organization_id: expect.any(String),
        name: "Legacy Owner",
        scopes: ["goals:read"]
      });
      const [column] = await legacyDatabase<{ is_nullable: string }[]>`
        select is_nullable
        from information_schema.columns
        where table_schema = ${legacySchema}
          and table_name = 'api_tokens'
          and column_name = 'organization_id'
      `;
      expect(column?.is_nullable).toBe("NO");
    } finally {
      await legacyDatabase.close();
      await admin.unsafe(`drop schema if exists ${legacySchema} cascade`);
    }
  });
});
