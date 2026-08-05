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
}
