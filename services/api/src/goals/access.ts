import type { OrganizationRole } from "../organizations/types";
import { GoalError, type GoalAccess } from "./service";
import type {
  GoalActor,
  GoalAuthentication,
  GoalClientInfo
} from "./types";

export type ScopedGoalPrincipal = {
  userId: string;
  organizationId: string;
  scopes: readonly string[];
  actor: GoalActor;
  authentication: GoalAuthentication;
  clientInfo: GoalClientInfo | null;
};

export async function resolveScopedGoalAccess(input: {
  principal: ScopedGoalPrincipal;
  scopeNamespace: "goals" | "labels";
  operation: "read" | "write";
  roleForUser: (
    userId: string,
    organizationId: string
  ) => OrganizationRole | null | Promise<OrganizationRole | null>;
}): Promise<GoalAccess> {
  const { principal, operation } = input;
  const role = await input.roleForUser(
    principal.userId,
    principal.organizationId
  );
  if (!role) {
    throw new GoalError(
      "permission_denied",
      "The authenticated user is no longer an organization member",
      403
    );
  }

  const ownScope = `${input.scopeNamespace}:${operation}`;
  const allScope = input.scopeNamespace === "goals" ? `${ownScope}:all` : null;
  if (
    !principal.scopes.includes(ownScope) &&
    !(allScope && principal.scopes.includes(allScope))
  ) {
    throw new GoalError(
      "insufficient_scope",
      `This operation requires ${[ownScope, allScope].filter(Boolean).join(" or ")}`,
      403
    );
  }

  const canUseAll =
    allScope !== null &&
    principal.scopes.includes(allScope) &&
    (operation === "read" || role === "owner" || role === "admin");

  return {
    userId: principal.userId,
    organizationId: principal.organizationId,
    readAll: operation === "read" && canUseAll,
    writeAll: operation === "write" && canUseAll,
    actor: principal.actor,
    authentication: principal.authentication,
    clientInfo: principal.clientInfo
  };
}
