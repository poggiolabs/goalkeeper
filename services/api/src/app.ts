import { Hono, type Context } from "hono";
import {
  AuthError,
  isEmailAuthBackend,
  type AuthBackend,
  type AuthTransition
} from "./auth/types";
import {
  ApiTokenError,
  type ApiTokenService
} from "./api-tokens/service";
import { apiTokenScopeRegistry } from "./api-tokens/types";
import {
  GoalError,
  type GoalAccess,
  type GoalService
} from "./goals/service";
import { resolveScopedGoalAccess } from "./goals/access";
import {
  OrganizationError,
  type OrganizationService
} from "./organizations/service";
import { apiRoutes } from "./routes";

export type ApiDependencies = {
  auth: AuthBackend;
  apiTokens: ApiTokenService;
  goals: GoalService;
  organizations: OrganizationService;
  webOrigin: string;
  reportError?: (error: Error) => void;
};

export function createApiApp(dependencies: ApiDependencies) {
  const app = new Hono();
  const webOrigin = new URL(dependencies.webOrigin).origin;

  app.use("*", async (context, next) => {
    if (context.req.method === "OPTIONS") {
      return responseWithCors(new Response(null, { status: 204 }), webOrigin);
    }

    await next();
    responseWithCors(context.res, webOrigin);
  });

  app.onError((error, context) => {
    const noReferrer =
      context.req.path === apiRoutes.authVerifyEmail.path ||
      context.req.path === apiRoutes.authCallback.path;
    const response = apiErrorResponse(error, webOrigin, noReferrer);
    if (response) return response;

    (dependencies.reportError ?? defaultErrorReporter)(error);
    return sensitiveJson({ error: "internal_error" }, 500, webOrigin);
  });

  app.notFound(() => json({ error: "not_found" }, 404, webOrigin));

  app.get(honoPath(apiRoutes.health.path), () =>
    json({ service: "api", status: "ok" }, 200, webOrigin)
  );

  app.get(honoPath(apiRoutes.authSession.path), async (context) => {
    const request = context.req.raw;
    const session = await dependencies.auth.getSession(request);
    return session
      ? sensitiveJson(
          {
            user: session.user,
            ...(await dependencies.organizations.ensureForUser(session.user))
          },
          200,
          webOrigin
        )
      : unauthorizedResponse(dependencies.auth, request, webOrigin);
  });

  app.get(honoPath(apiRoutes.authConfig.path), () =>
    json({ method: dependencies.auth.method }, 200, webOrigin)
  );

  app.get(honoPath(apiRoutes.authLogin.path), async (context) => {
    const request = context.req.raw;
    const transition = await dependencies.auth.beginLogin({
      request,
      returnTo: safeReturnTo(
        new URL(request.url).searchParams.get("returnTo"),
        webOrigin
      )
    });
    return sensitiveRedirect(transition, webOrigin);
  });

  app.post(honoPath(apiRoutes.authEmailLogin.path), async (context) => {
    const request = context.req.raw;
    if (!hasAllowedOrigin(request, webOrigin)) {
      return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
    }
    if (!isEmailAuthBackend(dependencies.auth)) {
      return sensitiveJson({ error: "not_found" }, 404, webOrigin);
    }

    const body = (await request.json()) as {
      email?: unknown;
      password?: unknown;
      returnTo?: unknown;
    };
    const transition = await dependencies.auth.login({
      email: typeof body.email === "string" ? body.email : "",
      password: typeof body.password === "string" ? body.password : "",
      returnTo: safeReturnTo(
        typeof body.returnTo === "string" ? body.returnTo : null,
        webOrigin
      )
    });
    return sensitiveJson(
      { redirectTo: transition.redirectTo },
      200,
      webOrigin,
      transition.headers
    );
  });

  app.post(honoPath(apiRoutes.authRegister.path), async (context) => {
    const request = context.req.raw;
    if (!hasAllowedOrigin(request, webOrigin)) {
      return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
    }
    if (!isEmailAuthBackend(dependencies.auth)) {
      return sensitiveJson({ error: "not_found" }, 404, webOrigin);
    }

    const body = (await request.json()) as {
      email?: unknown;
      password?: unknown;
      displayName?: unknown;
    };
    return sensitiveJson(
      await dependencies.auth.register({
        email: typeof body.email === "string" ? body.email : "",
        password: typeof body.password === "string" ? body.password : "",
        displayName: typeof body.displayName === "string" ? body.displayName : ""
      }),
      202,
      webOrigin
    );
  });

  app.post(honoPath(apiRoutes.authVerifyEmail.path), async (context) => {
    const request = context.req.raw;
    if (!hasAllowedOrigin(request, webOrigin)) {
      return sensitiveJson(
        { error: "forbidden" },
        403,
        webOrigin,
        undefined,
        true
      );
    }
    if (!isEmailAuthBackend(dependencies.auth)) {
      return sensitiveJson(
        { error: "not_found" },
        404,
        webOrigin,
        undefined,
        true
      );
    }

    const body = (await request.json()) as { token?: unknown };
    const transition = await dependencies.auth.verifyEmail({
      token: typeof body.token === "string" ? body.token : "",
      returnTo: new URL("/sign-in", webOrigin).toString()
    });
    return sensitiveJson(
      { redirectTo: transition.redirectTo },
      200,
      webOrigin,
      transition.headers,
      true
    );
  });

  app.get(honoPath(apiRoutes.authCallback.path), async (context) => {
    const request = context.req.raw;
    const transition = await dependencies.auth.completeLogin({
      request,
      returnTo: safeReturnTo(
        new URL(request.url).searchParams.get("returnTo"),
        webOrigin
      )
    });
    return sensitiveRedirect(transition, webOrigin, true);
  });

  app.post(honoPath(apiRoutes.authLogout.path), async (context) => {
    const request = context.req.raw;
    if (!hasAllowedOrigin(request, webOrigin)) {
      return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
    }

    const transition = await dependencies.auth.logout(request);
    return sensitiveJson(
      { redirectTo: transition.redirectTo },
      200,
      webOrigin,
      transition.headers
    );
  });

  app.get(honoPath(apiRoutes.organizationsList.path), async (context) => {
    const request = context.req.raw;
    const session = await dependencies.auth.getSession(request);
    if (!session) {
      return unauthorizedResponse(dependencies.auth, request, webOrigin);
    }
    return sensitiveJson(
      await dependencies.organizations.ensureForUser(session.user),
      200,
      webOrigin
    );
  });

  app.post(honoPath(apiRoutes.organizationsCreate.path), async (context) => {
    const request = context.req.raw;
    const guard = await requireSessionMutation(request, dependencies, webOrigin);
    if (guard instanceof Response) return guard;

    return sensitiveJson(
      await dependencies.organizations.createForUser(
        guard.user,
        await request.json()
      ),
      201,
      webOrigin
    );
  });

  app.post(honoPath(apiRoutes.organizationsSwitch.path), async (context) => {
    const request = context.req.raw;
    const guard = await requireSessionMutation(request, dependencies, webOrigin);
    if (guard instanceof Response) return guard;

    return sensitiveJson(
      await dependencies.organizations.switchForUser(
        guard.user,
        await request.json()
      ),
      200,
      webOrigin
    );
  });

  app.patch(honoPath(apiRoutes.organizationUpdate.path), async (context) => {
    const request = context.req.raw;
    const guard = await requireSessionMutation(request, dependencies, webOrigin);
    if (guard instanceof Response) return guard;

    return sensitiveJson(
      await dependencies.organizations.updateActiveForUser(
        guard.user,
        await request.json()
      ),
      200,
      webOrigin
    );
  });

  app.get(honoPath(apiRoutes.organizationMembersList.path), async (context) => {
    const request = context.req.raw;
    const session = await dependencies.auth.getSession(request);
    if (!session) {
      return unauthorizedResponse(dependencies.auth, request, webOrigin);
    }
    return sensitiveJson(
      await dependencies.organizations.listActiveMembersForUser(session.user),
      200,
      webOrigin
    );
  });

  app.patch(
    honoPath(apiRoutes.organizationMemberUpdate.path),
    async (context) => {
      const request = context.req.raw;
      const guard = await requireSessionMutation(request, dependencies, webOrigin);
      if (guard instanceof Response) return guard;

      return sensitiveJson(
        await dependencies.organizations.updateActiveMemberRoleForUser(
          guard.user,
          requiredParam(context, "userId"),
          await request.json()
        ),
        200,
        webOrigin
      );
    }
  );

  app.get(
    honoPath(apiRoutes.organizationInvitationsList.path),
    async (context) => {
      const request = context.req.raw;
      const session = await dependencies.auth.getSession(request);
      if (!session) {
        return unauthorizedResponse(dependencies.auth, request, webOrigin);
      }

      return sensitiveJson(
        await dependencies.organizations.listInvitationsForUser(session.user),
        200,
        webOrigin
      );
    }
  );

  app.post(
    honoPath(apiRoutes.organizationInvitationsCreate.path),
    async (context) => {
      const request = context.req.raw;
      const guard = await requireSessionMutation(request, dependencies, webOrigin);
      if (guard instanceof Response) return guard;

      return sensitiveJson(
        await dependencies.organizations.createInvitationForUser(
          guard.user,
          await request.json()
        ),
        201,
        webOrigin
      );
    }
  );

  app.post(
    honoPath(apiRoutes.organizationInvitationResend.path),
    async (context) => {
      const request = context.req.raw;
      const guard = await requireSessionMutation(request, dependencies, webOrigin);
      if (guard instanceof Response) return guard;

      return sensitiveJson(
        await dependencies.organizations.resendInvitationForUser(
          guard.user,
          requiredParam(context, "invitationId")
        ),
        200,
        webOrigin
      );
    }
  );

  app.delete(
    honoPath(apiRoutes.organizationInvitationRevoke.path),
    async (context) => {
      const request = context.req.raw;
      const guard = await requireSessionMutation(request, dependencies, webOrigin);
      if (guard instanceof Response) return guard;

      await dependencies.organizations.revokeInvitationForUser(
        guard.user,
        requiredParam(context, "invitationId")
      );
      return sensitiveEmpty(204, webOrigin);
    }
  );

  app.post(
    honoPath(apiRoutes.organizationInvitationAccept.path),
    async (context) => {
      const request = context.req.raw;
      const guard = await requireSessionMutation(request, dependencies, webOrigin);
      if (guard instanceof Response) return guard;

      return sensitiveJson(
        await dependencies.organizations.acceptInvitationForUser(
          guard.user,
          await request.json()
        ),
        200,
        webOrigin
      );
    }
  );

  app.get(honoPath(apiRoutes.apiTokenScopes.path), () =>
    json(
      {
        scopes: apiTokenScopeRegistry.map(
          ({ id, label, description, default: isDefault }) => ({
            id,
            label,
            description,
            default: isDefault
          })
        )
      },
      200,
      webOrigin
    )
  );

  app.get(honoPath(apiRoutes.apiTokensList.path), async (context) => {
    const request = context.req.raw;
    const session = await dependencies.auth.getSession(request);
    if (!session) {
      return unauthorizedResponse(dependencies.auth, request, webOrigin);
    }

    const organizationContext =
      await dependencies.organizations.ensureForUser(session.user);
    return sensitiveJson(
      await dependencies.apiTokens.list(
        session.user.id,
        organizationContext.activeOrganizationId
      ),
      200,
      webOrigin
    );
  });

  app.post(honoPath(apiRoutes.apiTokensCreate.path), async (context) => {
    const request = context.req.raw;
    const guard = await requireSessionMutation(request, dependencies, webOrigin);
    if (guard instanceof Response) return guard;

    const organizationContext =
      await dependencies.organizations.ensureForUser(guard.user);
    return sensitiveJson(
      await dependencies.apiTokens.create(
        guard.user.id,
        organizationContext.activeOrganizationId,
        await request.json()
      ),
      201,
      webOrigin
    );
  });

  app.delete(honoPath(apiRoutes.apiTokenRevoke.path), async (context) => {
    const request = context.req.raw;
    const guard = await requireSessionMutation(request, dependencies, webOrigin);
    if (guard instanceof Response) return guard;

    const organizationContext =
      await dependencies.organizations.ensureForUser(guard.user);
    return sensitiveJson(
      await dependencies.apiTokens.revoke(
        guard.user.id,
        organizationContext.activeOrganizationId,
        requiredParam(context, "tokenId")
      ),
      200,
      webOrigin
    );
  });

  app.get(honoPath(apiRoutes.goalsList.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "goals",
      "read"
    );
    if (resolved instanceof Response) return resolved;

    return sensitiveJson(
      await dependencies.goals.listGoals(
        resolved.access,
        new URL(request.url).searchParams
      ),
      200,
      webOrigin
    );
  });

  app.post(honoPath(apiRoutes.goalsCreate.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "goals",
      "write"
    );
    if (resolved instanceof Response) return resolved;
    const forbidden = sessionMutationForbidden(resolved, request, webOrigin);
    if (forbidden) return forbidden;

    return sensitiveJson(
      await dependencies.goals.createGoal(resolved.access, await request.json()),
      201,
      webOrigin
    );
  });

  app.get(honoPath(apiRoutes.goalLabelsList.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "labels",
      "read"
    );
    if (resolved instanceof Response) return resolved;

    return sensitiveJson(
      await dependencies.goals.listLabels(resolved.access),
      200,
      webOrigin
    );
  });

  app.post(honoPath(apiRoutes.goalLabelsCreate.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "labels",
      "write"
    );
    if (resolved instanceof Response) return resolved;
    const forbidden = sessionMutationForbidden(resolved, request, webOrigin);
    if (forbidden) return forbidden;

    return sensitiveJson(
      await dependencies.goals.createLabel(resolved.access, await request.json()),
      201,
      webOrigin
    );
  });

  app.get(honoPath(apiRoutes.goalUpdatesList.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "goals",
      "read"
    );
    if (resolved instanceof Response) return resolved;

    return sensitiveJson(
      await dependencies.goals.listUpdates(
        resolved.access,
        requiredParam(context, "goalId")
      ),
      200,
      webOrigin
    );
  });

  app.post(honoPath(apiRoutes.goalUpdatesCreate.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "goals",
      "write"
    );
    if (resolved instanceof Response) return resolved;
    const forbidden = sessionMutationForbidden(resolved, request, webOrigin);
    if (forbidden) return forbidden;

    return sensitiveJson(
      await dependencies.goals.reportUpdate(
        resolved.access,
        requiredParam(context, "goalId"),
        await request.json()
      ),
      201,
      webOrigin
    );
  });

  app.get(honoPath(apiRoutes.goalGet.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "goals",
      "read"
    );
    if (resolved instanceof Response) return resolved;

    return sensitiveJson(
      await dependencies.goals.getGoal(
        resolved.access,
        requiredParam(context, "goalId")
      ),
      200,
      webOrigin
    );
  });

  app.patch(honoPath(apiRoutes.goalUpdate.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "goals",
      "write"
    );
    if (resolved instanceof Response) return resolved;
    const forbidden = sessionMutationForbidden(resolved, request, webOrigin);
    if (forbidden) return forbidden;

    return sensitiveJson(
      await dependencies.goals.updateGoal(
        resolved.access,
        requiredParam(context, "goalId"),
        await request.json()
      ),
      200,
      webOrigin
    );
  });

  app.delete(honoPath(apiRoutes.goalDelete.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "goals",
      "write"
    );
    if (resolved instanceof Response) return resolved;
    const forbidden = sessionMutationForbidden(resolved, request, webOrigin);
    if (forbidden) return forbidden;

    await dependencies.goals.deleteGoal(
      resolved.access,
      requiredParam(context, "goalId")
    );
    return sensitiveEmpty(204, webOrigin);
  });

  app.get(honoPath(apiRoutes.goalLabelGet.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "labels",
      "read"
    );
    if (resolved instanceof Response) return resolved;

    return sensitiveJson(
      await dependencies.goals.getLabel(
        resolved.access,
        requiredParam(context, "labelId")
      ),
      200,
      webOrigin
    );
  });

  app.patch(honoPath(apiRoutes.goalLabelUpdate.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "labels",
      "write"
    );
    if (resolved instanceof Response) return resolved;
    const forbidden = sessionMutationForbidden(resolved, request, webOrigin);
    if (forbidden) return forbidden;

    return sensitiveJson(
      await dependencies.goals.updateLabel(
        resolved.access,
        requiredParam(context, "labelId"),
        await request.json()
      ),
      200,
      webOrigin
    );
  });

  app.delete(honoPath(apiRoutes.goalLabelDelete.path), async (context) => {
    const request = context.req.raw;
    const resolved = await requireGoalAccess(
      request,
      dependencies,
      webOrigin,
      "labels",
      "write"
    );
    if (resolved instanceof Response) return resolved;
    const forbidden = sessionMutationForbidden(resolved, request, webOrigin);
    if (forbidden) return forbidden;

    await dependencies.goals.deleteLabel(
      resolved.access,
      requiredParam(context, "labelId")
    );
    return sensitiveEmpty(204, webOrigin);
  });

  // Hono maps HEAD to GET automatically. Keep the explicit method contract used
  // by apiRoutes instead of silently adding undocumented operations.
  const fetch = app.fetch;
  app.fetch = (request, ...options) =>
    request.method === "HEAD"
      ? json({ error: "not_found" }, 404, webOrigin)
      : fetch(request, ...options);

  return app;
}

export function createApiHandler(dependencies: ApiDependencies) {
  const app = createApiApp(dependencies);
  return (request: Request) => Promise.resolve(app.fetch(request));
}

async function requireSessionMutation(
  request: Request,
  dependencies: ApiDependencies,
  webOrigin: string
) {
  if (!hasAllowedOrigin(request, webOrigin)) {
    return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
  }
  const session = await dependencies.auth.getSession(request);
  return session ?? unauthorizedResponse(dependencies.auth, request, webOrigin);
}

async function requireGoalAccess(
  request: Request,
  dependencies: ApiDependencies,
  webOrigin: string,
  scopeNamespace: "goals" | "labels",
  operation: "read" | "write"
) {
  return (
    (await resolveGoalAccess(
      request,
      dependencies,
      scopeNamespace,
      operation
    )) ?? unauthorizedResponse(dependencies.auth, request, webOrigin)
  );
}

async function resolveGoalAccess(
  request: Request,
  dependencies: ApiDependencies,
  scopeNamespace: "goals" | "labels",
  operation: "read" | "write"
): Promise<{ access: GoalAccess; session: boolean } | null> {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const principal = await dependencies.apiTokens.resolveRequest(request);
    if (!principal) {
      throw new ApiTokenError("invalid_api_token", "Invalid API token", 401);
    }
    return {
      access: await resolveScopedGoalAccess({
        principal: {
          userId: principal.userId,
          organizationId: principal.organizationId,
          scopes: principal.scopes,
          actor: { kind: "client", id: principal.tokenId, runId: null },
          authentication: { kind: "api_token", subjectId: principal.tokenId },
          clientInfo: null
        },
        scopeNamespace,
        operation,
        roleForUser: (userId, organizationId) =>
          dependencies.organizations.roleForUser(userId, organizationId)
      }),
      session: false
    };
  }

  const session = await dependencies.auth.getSession(request);
  if (!session) return null;
  const context = await dependencies.organizations.ensureForUser(session.user);
  const active = context.organizations.find(
    (organization) => organization.id === context.activeOrganizationId
  );
  if (!active) return null;
  return {
    access: {
      userId: session.user.id,
      organizationId: active.id,
      readAll: true,
      writeAll: active.role === "owner" || active.role === "admin",
      actor: { kind: "user", id: session.user.id, runId: null },
      authentication: { kind: "session", subjectId: session.id },
      clientInfo: null
    },
    session: true
  };
}

function sessionMutationForbidden(
  resolved: { session: boolean },
  request: Request,
  webOrigin: string
) {
  return resolved.session && !hasAllowedOrigin(request, webOrigin)
    ? sensitiveJson({ error: "forbidden" }, 403, webOrigin)
    : null;
}

function apiErrorResponse(
  error: Error,
  webOrigin: string,
  noReferrer = false
): Response | null {
  if (
    error instanceof AuthError ||
    error instanceof ApiTokenError ||
    error instanceof GoalError ||
    error instanceof OrganizationError
  ) {
    return sensitiveJson(
      { error: error.code, message: error.message },
      error.status,
      webOrigin,
      undefined,
      noReferrer
    );
  }
  if (error instanceof SyntaxError) {
    return sensitiveJson(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      400,
      webOrigin,
      undefined,
      noReferrer
    );
  }
  return null;
}

function unauthorizedResponse(
  auth: AuthBackend,
  request: Request,
  webOrigin: string
): Response {
  return sensitiveJson(
    { error: "unauthorized" },
    401,
    webOrigin,
    auth.invalidSessionHeaders?.(request)
  );
}

export function safeReturnTo(
  requestedReturnTo: string | null,
  webOrigin: string,
  fallbackPath = "/home"
): string {
  const origin = new URL(webOrigin).origin;
  const fallback = new URL(fallbackPath, origin);

  if (!requestedReturnTo) {
    return fallback.toString();
  }

  try {
    const candidate = new URL(requestedReturnTo, origin);
    return candidate.origin === origin ? candidate.toString() : fallback.toString();
  } catch {
    return fallback.toString();
  }
}

function hasAllowedOrigin(request: Request, webOrigin: string): boolean {
  return request.headers.get("origin") === webOrigin;
}

function honoPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

function requiredParam(context: Context, name: string): string {
  const value = context.req.param(name);
  if (value === undefined) {
    throw new Error(`Hono did not resolve the ${name} route parameter`);
  }
  return value;
}

function defaultErrorReporter(error: Error) {
  console.error("Unhandled REST API error", error);
}

function redirect(transition: AuthTransition, webOrigin: string): Response {
  const headers = new Headers(transition.headers);
  headers.set("location", transition.redirectTo);
  return responseWithCors(new Response(null, { status: 302, headers }), webOrigin);
}

function sensitiveRedirect(
  transition: AuthTransition,
  webOrigin: string,
  noReferrer = false
): Response {
  return redirect(
    {
      ...transition,
      headers: sensitiveHeaders(transition.headers, noReferrer)
    },
    webOrigin
  );
}

function json(
  body: unknown,
  status: number,
  webOrigin: string,
  extraHeaders?: HeadersInit
): Response {
  return responseWithCors(
    Response.json(body, { status, headers: extraHeaders }),
    webOrigin
  );
}

function sensitiveJson(
  body: unknown,
  status: number,
  webOrigin: string,
  extraHeaders?: HeadersInit,
  noReferrer = false
): Response {
  return json(
    body,
    status,
    webOrigin,
    sensitiveHeaders(extraHeaders, noReferrer)
  );
}

function sensitiveEmpty(status: number, webOrigin: string): Response {
  return responseWithCors(
    new Response(null, { status, headers: sensitiveHeaders() }),
    webOrigin
  );
}

function sensitiveHeaders(
  extraHeaders?: HeadersInit,
  noReferrer = false
): Headers {
  const headers = new Headers(extraHeaders);
  headers.set("cache-control", "no-store");
  if (noReferrer) headers.set("referrer-policy", "no-referrer");
  return headers;
}

function responseWithCors(response: Response, webOrigin: string): Response {
  response.headers.set("access-control-allow-origin", webOrigin);
  response.headers.set("access-control-allow-credentials", "true");
  response.headers.set(
    "access-control-allow-methods",
    "GET, POST, PATCH, DELETE, OPTIONS"
  );
  response.headers.set(
    "access-control-allow-headers",
    "authorization, content-type"
  );
  const vary = response.headers.get("vary");
  if (!vary?.split(",").some((value) => value.trim() === "Origin")) {
    response.headers.append("vary", "Origin");
  }
  return response;
}
