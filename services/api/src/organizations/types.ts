import type { AuthUser } from "../auth/types";

export type OrganizationRole = "owner" | "admin" | "member";

export type OrganizationSummary = {
  id: string;
  name: string;
  role: OrganizationRole;
};

export type OrganizationContext = {
  activeOrganizationId: string;
  organizations: OrganizationSummary[];
};

export type OrganizationMember = {
  userId: string;
  displayName: string;
  email: string | null;
  role: OrganizationRole;
};

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export type OrganizationInvitation = {
  id: string;
  organizationId: string;
  email: string;
  role: Exclude<OrganizationRole, "owner">;
  status: InvitationStatus;
  invitedByUserId: string;
  expiresAt: Date;
  createdAt: Date;
};

/**
 * An invitation plus the single-use plaintext token. Returned only by
 * creation and resend; the token is stored hashed and cannot be recovered.
 */
export type IssuedOrganizationInvitation = {
  invitation: OrganizationInvitation;
  token: string;
};

export type AcceptedInvitation = {
  organizationId: string;
  role: Exclude<OrganizationRole, "owner">;
};

export type InvitationRejection =
  | "invitation_not_found"
  | "invitation_email_mismatch"
  | "invitation_already_member";

export interface OrganizationRepository {
  ensureForUser(user: AuthUser): Promise<OrganizationContext>;
  createForUser(user: AuthUser, name: string): Promise<OrganizationContext>;
  switchForUser(
    userId: string,
    organizationId: string
  ): Promise<OrganizationContext | null>;
  updateNameForUser(
    userId: string,
    organizationId: string,
    name: string
  ): Promise<boolean>;
  listMembersForUser(
    userId: string,
    organizationId: string
  ): Promise<OrganizationMember[] | null>;
  updateMemberRoleForUser(
    actorUserId: string,
    organizationId: string,
    memberUserId: string,
    role: Exclude<OrganizationRole, "owner">
  ): Promise<OrganizationMember | null>;
  getRoleForUser(
    userId: string,
    organizationId: string
  ): Promise<OrganizationRole | null>;
  /** Returns null when the actor is not an owner or admin. */
  createInvitation(
    actorUserId: string,
    organizationId: string,
    input: { email: string; role: Exclude<OrganizationRole, "owner">; tokenHash: string; expiresAt: Date }
  ): Promise<OrganizationInvitation | null>;
  /** Returns null when the actor holds no membership. */
  listInvitations(
    userId: string,
    organizationId: string
  ): Promise<OrganizationInvitation[] | null>;
  revokeInvitation(
    actorUserId: string,
    organizationId: string,
    invitationId: string
  ): Promise<boolean>;
  resendInvitation(
    actorUserId: string,
    organizationId: string,
    invitationId: string,
    replacement: { tokenHash: string; expiresAt: Date }
  ): Promise<OrganizationInvitation | null>;
  /**
   * Atomically consumes a pending, unexpired invitation and creates the
   * membership. The conditional update is the concurrency primitive: the
   * per-user advisory lock used elsewhere does not serialize accept against
   * revoke, expiry, or a second identity sharing one email address.
   */
  acceptInvitation(
    user: AuthUser,
    tokenHash: string
  ): Promise<AcceptedInvitation | InvitationRejection>;
}
