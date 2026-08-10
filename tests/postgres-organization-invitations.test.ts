import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { migrateApiDatabase } from "../services/api/src/api-tokens/postgres";
import { hashToken } from "../services/api/src/api-tokens/service";
import { isEmailAddress } from "../services/api/src/email-address";
import type { EmailMessage } from "../services/api/src/notifications/email-delivery";
import { createPostgresOrganizationRepository } from "../services/api/src/organizations/postgres";
import {
  createOrganizationService,
  OrganizationError
} from "../services/api/src/organizations/service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

class RecordingEmailDelivery {
  readonly sent: EmailMessage[] = [];
  shouldFail = false;

  async send(message: EmailMessage): Promise<void> {
    if (this.shouldFail) throw new Error("smtp unavailable");
    this.sent.push(message);
  }
}

function user(name: string, email: string) {
  return { id: `test:${crypto.randomUUID()}`, displayName: name, email };
}

function tokenOf(acceptUrl: string): string {
  return acceptUrl.slice(acceptUrl.lastIndexOf("/") + 1);
}

describe.skipIf(!testDatabaseUrl)("PostgreSQL organization invitations", () => {
  const schema = `invitation_test_${crypto.randomUUID().replaceAll("-", "")}`;
  let admin: SQL;
  let database: SQL;
  let repository: ReturnType<typeof createPostgresOrganizationRepository>;
  let organizations: ReturnType<typeof createOrganizationService>;
  let mailer: RecordingEmailDelivery;

  beforeAll(async () => {
    admin = new SQL(testDatabaseUrl!);
    await admin.unsafe(`create schema ${schema}`);

    const scopedUrl = new URL(testDatabaseUrl!);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    database = new SQL(scopedUrl.toString());
    await migrateApiDatabase(database);
    repository = createPostgresOrganizationRepository(database);
    mailer = new RecordingEmailDelivery();
    organizations = createOrganizationService(repository, {
      webOrigin: "https://goalkeep.test",
      emailDelivery: mailer
    });
  });

  afterAll(async () => {
    await database?.close();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.close();
  });

  test("an invited user joins the inviting organization, not a personal one", async () => {
    const owner = user("Ada Lovelace", "ada@example.com");
    const invitee = user("Alan Turing", "alan@example.com");
    const { activeOrganizationId } = await organizations.ensureForUser(owner);

    const issued = await organizations.createInvitationForUser(owner, {
      email: "alan@example.com",
      role: "member"
    });
    expect(issued.emailSent).toBe(true);
    expect(mailer.sent.at(-1)?.to).toBe("alan@example.com");

    const accepted = await organizations.acceptInvitationForUser(invitee, {
      token: tokenOf(issued.acceptUrl)
    });

    expect(accepted.organizationId).toBe(activeOrganizationId);
    expect(accepted.role).toBe("member");
    // The invitee must land in the inviting organization, not the personal
    // organization ensureForUser would otherwise have created.
    expect(accepted.activeOrganizationId).toBe(activeOrganizationId);
    expect(accepted.organizations).toHaveLength(1);
  });

  test("acceptance requires the token; a session alone grants nothing", async () => {
    const owner = user("Ada Lovelace", "owner2@example.com");
    const invitee = user("Grace Hopper", "grace2@example.com");
    await organizations.ensureForUser(owner);
    await organizations.createInvitationForUser(owner, {
      email: "grace2@example.com",
      role: "member"
    });

    // Simply establishing a session must not consume the pending invitation.
    const context = await organizations.ensureForUser(invitee);
    expect(context.organizations).toHaveLength(1);
    expect(context.organizations[0]!.name).toBe("Grace Hopper");
    expect(context.organizations[0]!.role).toBe("owner");
  });

  test("rejects a token presented by a different email address", async () => {
    const owner = user("Ada Lovelace", "owner3@example.com");
    const stranger = user("Mallory", "mallory@example.com");
    await organizations.ensureForUser(owner);
    const issued = await organizations.createInvitationForUser(owner, {
      email: "intended@example.com",
      role: "admin"
    });

    await expect(
      organizations.acceptInvitationForUser(stranger, {
        token: tokenOf(issued.acceptUrl)
      })
    ).rejects.toThrow(OrganizationError);

    // The invitation must survive the mismatched attempt unspent.
    const [row] = await database<{ status: string }[]>`
      select status from organization_invitations
      where email = 'intended@example.com'
    `;
    expect(row?.status).toBe("pending");
  });

  test("expired, revoked, and already-consumed tokens grant nothing", async () => {
    const owner = user("Ada Lovelace", "owner4@example.com");
    const { activeOrganizationId } = await organizations.ensureForUser(owner);

    // expires_at > created_at is enforced, so an already-lapsed invitation has
    // to be written with both timestamps in the past rather than backdated.
    const expiredToken = "expired-token-value";
    await database`
      insert into organization_invitations (
        organization_id, email, role, token_hash, invited_by_user_id,
        created_at, expires_at
      ) values (
        ${activeOrganizationId}::uuid, 'expired@example.com', 'member',
        ${await hashToken(expiredToken)}, ${owner.id},
        now() - interval '8 days', now() - interval '1 day'
      )
    `;
    await expect(
      organizations.acceptInvitationForUser(
        user("Expired", "expired@example.com"),
        { token: expiredToken }
      )
    ).rejects.toThrow(OrganizationError);

    const revoked = await organizations.createInvitationForUser(owner, {
      email: "revoked@example.com",
      role: "member"
    });
    await organizations.revokeInvitationForUser(owner, revoked.invitation.id);
    await expect(
      organizations.acceptInvitationForUser(
        user("Revoked", "revoked@example.com"),
        { token: tokenOf(revoked.acceptUrl) }
      )
    ).rejects.toThrow(OrganizationError);

    const reused = await organizations.createInvitationForUser(owner, {
      email: "reused@example.com",
      role: "member"
    });
    const reusedToken = tokenOf(reused.acceptUrl);
    await organizations.acceptInvitationForUser(
      user("Reused", "reused@example.com"),
      { token: reusedToken }
    );
    await expect(
      organizations.acceptInvitationForUser(
        user("Reused Again", "reused@example.com"),
        { token: reusedToken }
      )
    ).rejects.toThrow(OrganizationError);
  });

  test("concurrent accept and revoke produce exactly one winner", async () => {
    const owner = user("Ada Lovelace", "owner5@example.com");
    await organizations.ensureForUser(owner);
    const issued = await organizations.createInvitationForUser(owner, {
      email: "racer@example.com",
      role: "member"
    });
    const racer = user("Racer", "racer@example.com");

    const [accept, revoke] = await Promise.allSettled([
      organizations.acceptInvitationForUser(racer, {
        token: tokenOf(issued.acceptUrl)
      }),
      organizations.revokeInvitationForUser(owner, issued.invitation.id)
    ]);

    const accepted = accept.status === "fulfilled";
    const revokedOk = revoke.status === "fulfilled";
    expect(accepted).not.toBe(revokedOk);

    const [row] = await database<{ status: string }[]>`
      select status from organization_invitations
      where email = 'racer@example.com'
    `;
    expect(row?.status).toBe(accepted ? "accepted" : "revoked");
  });

  test("two identities sharing one email cannot both consume an invitation", async () => {
    const owner = user("Ada Lovelace", "owner6@example.com");
    await organizations.ensureForUser(owner);
    const issued = await organizations.createInvitationForUser(owner, {
      email: "shared@example.com",
      role: "member"
    });
    const token = tokenOf(issued.acceptUrl);

    const results = await Promise.allSettled([
      organizations.acceptInvitationForUser(
        user("Identity A", "shared@example.com"),
        { token }
      ),
      organizations.acceptInvitationForUser(
        user("Identity B", "shared@example.com"),
        { token }
      )
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    expect(succeeded).toHaveLength(1);
  });

  test("an expired invitation does not block reinvitation", async () => {
    const owner = user("Ada Lovelace", "owner7@example.com");
    await organizations.ensureForUser(owner);
    await organizations.createInvitationForUser(owner, {
      email: "again@example.com",
      role: "member"
    });
    await database`
      update organization_invitations
      set created_at = now() - interval '8 days',
          expires_at = now() - interval '1 day'
      where email = 'again@example.com' and status = 'pending'
    `;

    // The pending unique index cannot exclude expired rows, so creation must
    // transition the stale row before inserting.
    const reissued = await organizations.createInvitationForUser(owner, {
      email: "again@example.com",
      role: "admin"
    });
    expect(reissued.invitation.role).toBe("admin");

    const rows = await database<{ status: string }[]>`
      select status from organization_invitations
      where email = 'again@example.com' order by created_at
    `;
    expect(rows.map((row) => row.status)).toEqual(["expired", "pending"]);
  });

  test("a duplicate pending invitation is a conflict, not a 500", async () => {
    const owner = user("Ada Lovelace", "owner8@example.com");
    await organizations.ensureForUser(owner);
    await organizations.createInvitationForUser(owner, {
      email: "dupe@example.com",
      role: "member"
    });

    await expect(
      organizations.createInvitationForUser(owner, {
        email: "dupe@example.com",
        role: "member"
      })
    ).rejects.toMatchObject({ code: "invitation_already_pending", status: 409 });
  });

  test("only owners and admins may invite, revoke, or resend", async () => {
    const owner = user("Ada Lovelace", "owner9@example.com");
    const plain = user("Plain Member", "plain@example.com");
    const { activeOrganizationId } = await organizations.ensureForUser(owner);
    const issued = await organizations.createInvitationForUser(owner, {
      email: "plain@example.com",
      role: "member"
    });
    await organizations.acceptInvitationForUser(plain, {
      token: tokenOf(issued.acceptUrl)
    });

    await expect(
      organizations.createInvitationForUser(plain, {
        email: "nope@example.com",
        role: "member"
      })
    ).rejects.toThrow(OrganizationError);

    const pending = await organizations.createInvitationForUser(owner, {
      email: "pending@example.com",
      role: "member"
    });
    await expect(
      organizations.revokeInvitationForUser(plain, pending.invitation.id)
    ).rejects.toThrow(OrganizationError);
    await expect(
      organizations.resendInvitationForUser(plain, pending.invitation.id)
    ).rejects.toThrow(OrganizationError);

    // A plain member may still read the list, matching listMembersForUser.
    const visible = await organizations.listInvitationsForUser(plain);
    expect(visible.invitations.some((i) => i.email === "pending@example.com")).toBe(true);
    expect(activeOrganizationId).toBeTruthy();
  });

  test("resend rotates the token and invalidates the previous link", async () => {
    const owner = user("Ada Lovelace", "owner10@example.com");
    await organizations.ensureForUser(owner);
    const first = await organizations.createInvitationForUser(owner, {
      email: "rotate@example.com",
      role: "member"
    });
    const second = await organizations.resendInvitationForUser(
      owner,
      first.invitation.id
    );
    expect(tokenOf(second.acceptUrl)).not.toBe(tokenOf(first.acceptUrl));

    await expect(
      organizations.acceptInvitationForUser(
        user("Rotate", "rotate@example.com"),
        { token: tokenOf(first.acceptUrl) }
      )
    ).rejects.toThrow(OrganizationError);

    const accepted = await organizations.acceptInvitationForUser(
      user("Rotate", "rotate@example.com"),
      { token: tokenOf(second.acceptUrl) }
    );
    expect(accepted.role).toBe("member");
  });

  test("a mailer outage still commits the invitation and returns a link", async () => {
    const owner = user("Ada Lovelace", "owner11@example.com");
    await organizations.ensureForUser(owner);
    mailer.shouldFail = true;
    try {
      const issued = await organizations.createInvitationForUser(owner, {
        email: "offline@example.com",
        role: "member"
      });
      expect(issued.emailSent).toBe(false);
      expect(issued.acceptUrl).toContain("https://goalkeep.test/invitations/");

      const accepted = await organizations.acceptInvitationForUser(
        user("Offline", "offline@example.com"),
        { token: tokenOf(issued.acceptUrl) }
      );
      expect(accepted.role).toBe("member");
    } finally {
      mailer.shouldFail = false;
    }
  });

  test("the invitation lifetime is configurable per deployment", async () => {
    const owner = user("Ada Lovelace", "owner13@example.com");
    const shortLived = createOrganizationService(repository, {
      webOrigin: "https://goalkeep.test",
      emailDelivery: mailer,
      invitationLifetimeMs: 60_000
    });
    await shortLived.ensureForUser(owner);
    const issued = await shortLived.createInvitationForUser(owner, {
      email: "shortlived@example.com",
      role: "member"
    });

    const lifetime =
      new Date(issued.invitation.expiresAt).getTime() -
      new Date(issued.invitation.createdAt).getTime();
    expect(lifetime).toBeLessThan(5 * 60_000);

    expect(() =>
      createOrganizationService(repository, { invitationLifetimeMs: 0 })
    ).toThrow("invitationLifetimeMs must be a positive integer");
  });

  test("the check constraint agrees with the shared email pattern", async () => {
    // The constraint is a deliberate second copy of emailAddressPattern, so
    // the two can drift. This is what catches it if they do.
    const owner = user("Ada Lovelace", "owner14@example.com");
    const { activeOrganizationId } = await organizations.ensureForUser(owner);
    const candidates = [
      "ada@example.com",
      "ada+invites@mail.example.co.uk",
      "a@b.c",
      "ada",
      "ada@example",
      "@example.com",
      "ada @example.com"
    ];

    for (const [index, candidate] of candidates.entries()) {
      const accepted = await database`
        insert into organization_invitations (
          organization_id, email, role, token_hash, invited_by_user_id, expires_at
        ) values (
          ${activeOrganizationId}::uuid, ${candidate}, 'member',
          ${`${index}`.padStart(64, "0")}, ${owner.id}, now() + interval '7 days'
        )
        returning id
      `
        .then(() => true)
        .catch(() => false);

      expect({ candidate, accepted }).toEqual({
        candidate,
        accepted: isEmailAddress(candidate)
      });
    }
  });

  test("the plaintext token is never stored or listed", async () => {
    const owner = user("Ada Lovelace", "owner12@example.com");
    await organizations.ensureForUser(owner);
    const issued = await organizations.createInvitationForUser(owner, {
      email: "secret@example.com",
      role: "member"
    });
    const token = tokenOf(issued.acceptUrl);

    const [row] = await database<{ token_hash: string }[]>`
      select token_hash from organization_invitations
      where email = 'secret@example.com'
    `;
    expect(row?.token_hash).toBe(await hashToken(token));
    expect(row?.token_hash).not.toBe(token);

    const listed = await organizations.listInvitationsForUser(owner);
    const entry = listed.invitations.find((i) => i.email === "secret@example.com");
    expect(JSON.stringify(entry)).not.toContain(token);
  });
});
