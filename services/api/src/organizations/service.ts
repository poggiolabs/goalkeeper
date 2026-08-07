import { hashToken } from "../api-tokens/service";
import type { AuthUser } from "../auth/types";
import type { EmailDelivery } from "../notifications/email-delivery";
import type {
  OrganizationInvitation,
  OrganizationRepository,
  OrganizationRole
} from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Matches WorkOS's invitationExpiry so the two systems agree on lifetime. */
const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;

export class OrganizationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "OrganizationError";
  }
}

export type OrganizationService = ReturnType<typeof createOrganizationService>;

export type OrganizationServiceOptions = {
  webOrigin?: string;
  emailDelivery?: EmailDelivery | null;
  now?: () => Date;
  randomBytes?: (length: number) => Uint8Array;
};

export function createOrganizationService(
  repository: OrganizationRepository,
  options: OrganizationServiceOptions = {}
) {
  const now = options.now ?? (() => new Date());
  const randomBytes =
    options.randomBytes ?? ((length: number) => crypto.getRandomValues(new Uint8Array(length)));
  const emailDelivery = options.emailDelivery ?? null;
  const webOrigin = options.webOrigin ?? "";

  function acceptUrl(token: string) {
    return webOrigin ? `${webOrigin}/invitations/${token}` : `/invitations/${token}`;
  }

  async function deliver(invitation: OrganizationInvitation, token: string) {
    if (!emailDelivery) return false;
    try {
      await emailDelivery.send({
        to: invitation.email,
        subject: "You have been invited to a Goalkeeper organization",
        text:
          `You have been invited to join a Goalkeeper organization as ${invitation.role}.\n\n` +
          `Accept the invitation:\n${acceptUrl(token)}\n\n` +
          `This link expires on ${invitation.expiresAt.toISOString()}.`
      });
      return true;
    } catch {
      // The invitation is already committed. Surfacing the link is a
      // sufficient fallback, so a mailer outage must not fail the request.
      return false;
    }
  }

  async function issue(
    invitation: OrganizationInvitation,
    token: string
  ) {
    return {
      invitation: toInvitationResponse(invitation),
      acceptUrl: acceptUrl(token),
      emailSent: await deliver(invitation, token)
    };
  }

  return {
    ensureForUser(user: AuthUser) {
      return repository.ensureForUser(user);
    },

    createForUser(user: AuthUser, request: unknown) {
      return repository.createForUser(user, normalizeName(request));
    },

    async switchForUser(user: AuthUser, request: unknown) {
      const organizationId = normalizeOrganizationId(request);
      const context = await repository.switchForUser(user.id, organizationId);
      if (!context) {
        throw new OrganizationError(
          "membership_not_found",
          "No membership was found for this organization",
          403
        );
      }
      return context;
    },

    async updateActiveForUser(user: AuthUser, request: unknown) {
      const context = await repository.ensureForUser(user);
      const updated = await repository.updateNameForUser(
        user.id,
        context.activeOrganizationId,
        normalizeName(request)
      );
      if (!updated) {
        throw new OrganizationError(
          "organization_admin_required",
          "Organization administrator access is required",
          403
        );
      }
      return repository.ensureForUser(user);
    },

    async listActiveMembersForUser(user: AuthUser) {
      const context = await repository.ensureForUser(user);
      const members = await repository.listMembersForUser(
        user.id,
        context.activeOrganizationId
      );
      if (!members) {
        throw new OrganizationError(
          "membership_not_found",
          "No membership was found for this organization",
          403
        );
      }
      return { members };
    },

    async updateActiveMemberRoleForUser(
      user: AuthUser,
      memberUserId: string,
      request: unknown
    ) {
      const context = await repository.ensureForUser(user);
      const member = await repository.updateMemberRoleForUser(
        user.id,
        context.activeOrganizationId,
        normalizeUserId(memberUserId),
        normalizeManagedRole(request)
      );
      if (!member) {
        throw new OrganizationError(
          "member_role_update_forbidden",
          "Organization administrator access is required and owner roles cannot be changed",
          403
        );
      }
      return { member };
    },

    roleForUser(userId: string, organizationId: string) {
      return repository.getRoleForUser(userId, organizationId);
    },

    async createInvitationForUser(user: AuthUser, request: unknown) {
      const { email, role } = normalizeInvitationRequest(request);
      if (email === user.email.toLowerCase()) {
        throw new OrganizationError(
          "invitation_self",
          "You are already a member of this organization"
        );
      }
      const context = await repository.ensureForUser(user);
      const token = toBase64Url(randomBytes(32));
      let invitation;
      try {
        invitation = await repository.createInvitation(
          user.id,
          context.activeOrganizationId,
          {
            email,
            role,
            tokenHash: await hashToken(token),
            expiresAt: new Date(now().getTime() + invitationLifetimeMs)
          }
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new OrganizationError(
            "invitation_already_pending",
            "An invitation for this address is already pending",
            409
          );
        }
        throw error;
      }
      if (!invitation) {
        throw new OrganizationError(
          "organization_admin_required",
          "Organization administrator access is required",
          403
        );
      }
      return issue(invitation, token);
    },

    async listInvitationsForUser(user: AuthUser) {
      const context = await repository.ensureForUser(user);
      const invitations = await repository.listInvitations(
        user.id,
        context.activeOrganizationId
      );
      if (!invitations) {
        throw new OrganizationError(
          "membership_not_found",
          "No membership was found for this organization",
          403
        );
      }
      return { invitations: invitations.map(toInvitationResponse) };
    },

    async revokeInvitationForUser(user: AuthUser, invitationId: string) {
      const context = await repository.ensureForUser(user);
      const revoked = await repository.revokeInvitation(
        user.id,
        context.activeOrganizationId,
        normalizeInvitationId(invitationId)
      );
      if (!revoked) {
        throw new OrganizationError(
          "invitation_revoke_forbidden",
          "Organization administrator access is required and the invitation must be pending",
          403
        );
      }
    },

    async resendInvitationForUser(user: AuthUser, invitationId: string) {
      const context = await repository.ensureForUser(user);
      const token = toBase64Url(randomBytes(32));
      const invitation = await repository.resendInvitation(
        user.id,
        context.activeOrganizationId,
        normalizeInvitationId(invitationId),
        {
          tokenHash: await hashToken(token),
          expiresAt: new Date(now().getTime() + invitationLifetimeMs)
        }
      );
      if (!invitation) {
        throw new OrganizationError(
          "invitation_resend_forbidden",
          "Organization administrator access is required and the invitation must be pending",
          403
        );
      }
      return issue(invitation, token);
    },

    async acceptInvitationForUser(user: AuthUser, request: unknown) {
      const token = normalizeInvitationToken(request);
      const result = await repository.acceptInvitation(user, await hashToken(token));
      if (result === "invitation_not_found") {
        throw new OrganizationError(
          "invitation_not_found",
          "This invitation is no longer valid",
          404
        );
      }
      if (result === "invitation_email_mismatch") {
        throw new OrganizationError(
          "invitation_email_mismatch",
          "This invitation was issued to a different email address",
          403
        );
      }
      if (result === "invitation_already_member") {
        throw new OrganizationError(
          "invitation_already_member",
          "You are already a member of this organization",
          409
        );
      }
      return {
        organizationId: result.organizationId,
        role: result.role,
        ...(await repository.ensureForUser(user))
      };
    }
  };
}

function toInvitationResponse(invitation: OrganizationInvitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    invitedByUserId: invitation.invitedByUserId,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString()
  };
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  // Bun's SQL driver reports the SQLSTATE on `errno` and puts its own
  // identifier on `code`; other drivers use `code` for the SQLSTATE.
  const { code, errno } = error as { code?: unknown; errno?: unknown };
  return code === "23505" || errno === "23505";
}

function normalizeInvitationRequest(request: unknown): {
  email: string;
  role: Exclude<OrganizationRole, "owner">;
} {
  const candidate = request as { email?: unknown } | null;
  const email =
    typeof candidate?.email === "string" ? candidate.email.trim().toLowerCase() : "";
  if (!email || email.length > 320 || !emailPattern.test(email)) {
    throw new OrganizationError(
      "invalid_invitation_email",
      "A valid email address is required"
    );
  }
  return { email, role: normalizeManagedRole(request) };
}

function normalizeInvitationId(invitationId: string): string {
  const normalized = invitationId.trim();
  if (!uuidPattern.test(normalized)) {
    throw new OrganizationError(
      "invalid_invitation_id",
      "A valid invitation ID is required"
    );
  }
  return normalized;
}

function normalizeInvitationToken(request: unknown): string {
  const candidate = request as { token?: unknown } | null;
  const token = typeof candidate?.token === "string" ? candidate.token.trim() : "";
  if (!token || token.length > 200 || !/^[A-Za-z0-9_-]+$/.test(token)) {
    throw new OrganizationError(
      "invalid_invitation_token",
      "A valid invitation token is required"
    );
  }
  return token;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function normalizeName(request: unknown): string {
  const candidate = request as { name?: unknown } | null;
  const name = typeof candidate?.name === "string" ? candidate.name.trim() : "";
  if (!name || name.length > 100) {
    throw new OrganizationError(
      "invalid_organization_name",
      "Organization name must contain 1-100 characters"
    );
  }
  return name;
}

function normalizeOrganizationId(request: unknown): string {
  const candidate = request as { organizationId?: unknown } | null;
  const organizationId =
    typeof candidate?.organizationId === "string"
      ? candidate.organizationId.trim()
      : "";
  if (!uuidPattern.test(organizationId)) {
    throw new OrganizationError(
      "invalid_organization_id",
      "A valid organization ID is required"
    );
  }
  return organizationId;
}

function normalizeUserId(userId: string): string {
  const normalized = userId.trim();
  if (!normalized || normalized.length > 200) {
    throw new OrganizationError(
      "invalid_member_user_id",
      "A valid member user ID is required"
    );
  }
  return normalized;
}

function normalizeManagedRole(
  request: unknown
): Exclude<OrganizationRole, "owner"> {
  const candidate = request as { role?: unknown } | null;
  if (candidate?.role !== "admin" && candidate?.role !== "member") {
    throw new OrganizationError(
      "invalid_organization_role",
      "Role must be admin or member"
    );
  }
  return candidate.role;
}
