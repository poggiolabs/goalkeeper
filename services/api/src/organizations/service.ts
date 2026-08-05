import type { AuthUser } from "../auth/types";
import type { OrganizationRepository, OrganizationRole } from "./types";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

export function createOrganizationService(repository: OrganizationRepository) {
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
    }
  };
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
