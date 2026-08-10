import type { AuthUser } from "../../services/api/src/auth/types";
import type {
  AcceptedInvitation,
  InvitationRejection,
  OrganizationContext,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationRepository,
  OrganizationRole,
  OrganizationSummary
} from "../../services/api/src/organizations/types";

type StoredOrganization = Pick<OrganizationSummary, "id" | "name">;

type StoredInvitation = OrganizationInvitation & { tokenHash: string };

export class MemoryOrganizationRepository implements OrganizationRepository {
  readonly organizations = new Map<string, StoredOrganization>();
  readonly memberships = new Map<string, Map<string, OrganizationMember>>();
  readonly activeOrganizations = new Map<string, string>();
  readonly invitations = new Map<string, StoredInvitation>();

  async ensureForUser(user: AuthUser): Promise<OrganizationContext> {
    let organizations = this.forUser(user.id);
    if (organizations.length === 0) {
      const organization = this.insert(user, user.displayName);
      organizations = [organization];
    } else {
      this.syncIdentity(user);
    }
    const preferred = this.activeOrganizations.get(user.id);
    const activeOrganizationId = organizations.some(({ id }) => id === preferred)
      ? preferred!
      : organizations[0]!.id;
    this.activeOrganizations.set(user.id, activeOrganizationId);
    return { activeOrganizationId, organizations: this.forUser(user.id) };
  }

  async createForUser(
    user: AuthUser,
    name: string
  ): Promise<OrganizationContext> {
    const organization = this.insert(user, name);
    this.activeOrganizations.set(user.id, organization.id);
    return {
      activeOrganizationId: organization.id,
      organizations: this.forUser(user.id)
    };
  }

  async switchForUser(
    userId: string,
    organizationId: string
  ): Promise<OrganizationContext | null> {
    const organizations = this.forUser(userId);
    if (!organizations.some(({ id }) => id === organizationId)) return null;
    this.activeOrganizations.set(userId, organizationId);
    return { activeOrganizationId: organizationId, organizations };
  }

  async updateNameForUser(
    userId: string,
    organizationId: string,
    name: string
  ): Promise<boolean> {
    const role = this.memberships.get(organizationId)?.get(userId)?.role;
    const organization = this.organizations.get(organizationId);
    if (!organization || (role !== "owner" && role !== "admin")) return false;
    organization.name = name;
    return true;
  }

  async listMembersForUser(
    userId: string,
    organizationId: string
  ): Promise<OrganizationMember[] | null> {
    const memberships = this.memberships.get(organizationId);
    if (!memberships?.has(userId)) return null;
    return [...memberships.values()].sort(compareMembers);
  }

  async updateMemberRoleForUser(
    actorUserId: string,
    organizationId: string,
    memberUserId: string,
    role: Exclude<OrganizationRole, "owner">
  ): Promise<OrganizationMember | null> {
    const memberships = this.memberships.get(organizationId);
    const actor = memberships?.get(actorUserId);
    const member = memberships?.get(memberUserId);
    if (
      !member ||
      member.role === "owner" ||
      (actor?.role !== "owner" && actor?.role !== "admin")
    ) {
      return null;
    }
    member.role = role;
    return { ...member };
  }

  async getRoleForUser(
    userId: string,
    organizationId: string
  ): Promise<OrganizationRole | null> {
    return this.memberships.get(organizationId)?.get(userId)?.role ?? null;
  }

  async createInvitation(
    actorUserId: string,
    organizationId: string,
    input: {
      email: string;
      role: Exclude<OrganizationRole, "owner">;
      tokenHash: string;
      expiresAt: Date;
    }
  ): Promise<OrganizationInvitation | null> {
    if (!this.isAdministrator(actorUserId, organizationId)) return null;
    for (const stored of this.invitations.values()) {
      if (
        stored.organizationId === organizationId &&
        stored.email === input.email &&
        stored.status === "pending"
      ) {
        if (stored.expiresAt.getTime() <= Date.now()) {
          stored.status = "expired";
        } else {
          throw Object.assign(new Error("duplicate pending invitation"), {
            code: "23505"
          });
        }
      }
    }
    const invitation: StoredInvitation = {
      id: crypto.randomUUID(),
      organizationId,
      email: input.email,
      role: input.role,
      status: "pending",
      invitedByUserId: actorUserId,
      expiresAt: input.expiresAt,
      createdAt: new Date(),
      tokenHash: input.tokenHash
    };
    this.invitations.set(invitation.id, invitation);
    return toInvitation(invitation);
  }

  async listInvitations(
    userId: string,
    organizationId: string
  ): Promise<OrganizationInvitation[] | null> {
    if (!this.memberships.get(organizationId)?.has(userId)) return null;
    return [...this.invitations.values()]
      .filter(
        (stored) =>
          stored.organizationId === organizationId && stored.status === "pending"
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(toInvitation);
  }

  async revokeInvitation(
    actorUserId: string,
    organizationId: string,
    invitationId: string
  ): Promise<boolean> {
    const stored = this.invitations.get(invitationId);
    if (
      !stored ||
      stored.organizationId !== organizationId ||
      stored.status !== "pending" ||
      !this.isAdministrator(actorUserId, organizationId)
    ) {
      return false;
    }
    stored.status = "revoked";
    return true;
  }

  async resendInvitation(
    actorUserId: string,
    organizationId: string,
    invitationId: string,
    replacement: { tokenHash: string; expiresAt: Date }
  ): Promise<OrganizationInvitation | null> {
    const stored = this.invitations.get(invitationId);
    if (
      !stored ||
      stored.organizationId !== organizationId ||
      stored.status !== "pending" ||
      !this.isAdministrator(actorUserId, organizationId)
    ) {
      return null;
    }
    stored.tokenHash = replacement.tokenHash;
    stored.expiresAt = replacement.expiresAt;
    return toInvitation(stored);
  }

  async acceptInvitation(
    user: AuthUser,
    tokenHash: string
  ): Promise<AcceptedInvitation | InvitationRejection> {
    const stored = [...this.invitations.values()].find(
      (candidate) =>
        candidate.tokenHash === tokenHash &&
        candidate.status === "pending" &&
        candidate.expiresAt.getTime() > Date.now()
    );
    if (!stored) return "invitation_not_found";
    if (stored.email !== user.email.toLowerCase()) {
      return "invitation_email_mismatch";
    }
    stored.status = "accepted";
    const memberships = this.memberships.get(stored.organizationId) ?? new Map();
    if (memberships.has(user.id)) return "invitation_already_member";
    memberships.set(user.id, toMember(user, stored.role));
    this.memberships.set(stored.organizationId, memberships);
    this.activeOrganizations.set(user.id, stored.organizationId);
    return { organizationId: stored.organizationId, role: stored.role };
  }

  private isAdministrator(userId: string, organizationId: string): boolean {
    const role = this.memberships.get(organizationId)?.get(userId)?.role;
    return role === "owner" || role === "admin";
  }

  addMember(
    organizationId: string,
    user: AuthUser,
    role: Exclude<OrganizationRole, "owner">
  ): OrganizationMember {
    if (!this.organizations.has(organizationId)) {
      throw new Error("Organization does not exist");
    }
    const member = toMember(user, role);
    const memberships = this.memberships.get(organizationId) ?? new Map();
    memberships.set(user.id, member);
    this.memberships.set(organizationId, memberships);
    return member;
  }

  private insert(user: AuthUser, name: string): OrganizationSummary {
    const organization = { id: crypto.randomUUID(), name };
    this.organizations.set(organization.id, organization);
    this.memberships.set(
      organization.id,
      new Map([[user.id, toMember(user, "owner")]])
    );
    return { ...organization, role: "owner" };
  }

  private syncIdentity(user: AuthUser) {
    for (const memberships of this.memberships.values()) {
      const member = memberships.get(user.id);
      if (!member) continue;
      member.displayName = user.displayName;
      member.email = user.email;
    }
  }

  private forUser(userId: string): OrganizationSummary[] {
    const result: OrganizationSummary[] = [];
    for (const [organizationId, memberships] of this.memberships) {
      const member = memberships.get(userId);
      const organization = this.organizations.get(organizationId);
      if (member && organization) {
        result.push({ ...organization, role: member.role });
      }
    }
    return result;
  }
}

function toInvitation(stored: StoredInvitation): OrganizationInvitation {
  const { tokenHash: _tokenHash, ...invitation } = stored;
  return invitation;
}

function toMember(user: AuthUser, role: OrganizationRole): OrganizationMember {
  return {
    userId: user.id,
    displayName: user.displayName,
    email: user.email,
    role
  };
}

function compareMembers(a: OrganizationMember, b: OrganizationMember): number {
  const order = { owner: 0, admin: 1, member: 2 } satisfies Record<
    OrganizationRole,
    number
  >;
  return order[a.role] - order[b.role] || a.displayName.localeCompare(b.displayName);
}
