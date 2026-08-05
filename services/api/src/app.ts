import {
  AuthError,
  isEmailAuthBackend,
  type AuthBackend,
  type AuthTransition
} from "./auth/types";
import {
  ApiTokenError,
  authorizeApiToken,
  type ApiTokenService
} from "./api-tokens/service";
import { apiTokenScopeRegistry } from "./api-tokens/types";
import {
  GoalError,
  type GoalAccess,
  type GoalService
} from "./goals/service";
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
};

export function createApiHandler(dependencies: ApiDependencies) {
  const webOrigin = new URL(dependencies.webOrigin).origin;

  return async function handleApiRequest(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return responseWithCors(new Response(null, { status: 204 }), webOrigin);
    }

    const url = new URL(request.url);

    if (matches(request, apiRoutes.health)) {
      return json({ service: "api", status: "ok" }, 200, webOrigin);
    }

    if (matches(request, apiRoutes.authSession)) {
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
    }

    if (matches(request, apiRoutes.authConfig)) {
      return json({ method: dependencies.auth.method }, 200, webOrigin);
    }

    if (matches(request, apiRoutes.authLogin)) {
      const transition = await dependencies.auth.beginLogin({
        request,
        returnTo: safeReturnTo(url.searchParams.get("returnTo"), webOrigin)
      });
      return sensitiveRedirect(transition, webOrigin);
    }

    if (matches(request, apiRoutes.authEmailLogin)) {
      if (!hasAllowedOrigin(request, webOrigin)) {
        return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
      }
      if (!isEmailAuthBackend(dependencies.auth)) {
        return sensitiveJson({ error: "not_found" }, 404, webOrigin);
      }
      try {
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
      } catch (error) {
        return authErrorResponse(error, webOrigin);
      }
    }

    if (matches(request, apiRoutes.authRegister)) {
      if (!hasAllowedOrigin(request, webOrigin)) {
        return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
      }
      if (!isEmailAuthBackend(dependencies.auth)) {
        return sensitiveJson({ error: "not_found" }, 404, webOrigin);
      }
      try {
        const body = (await request.json()) as {
          email?: unknown;
          password?: unknown;
          displayName?: unknown;
        };
        return sensitiveJson(
          await dependencies.auth.register({
            email: typeof body.email === "string" ? body.email : "",
            password: typeof body.password === "string" ? body.password : "",
            displayName:
              typeof body.displayName === "string" ? body.displayName : ""
          }),
          202,
          webOrigin
        );
      } catch (error) {
        return authErrorResponse(error, webOrigin);
      }
    }

    if (matches(request, apiRoutes.authVerifyEmail)) {
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
      try {
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
      } catch (error) {
        return authErrorResponse(error, webOrigin, true);
      }
    }

    if (matches(request, apiRoutes.authCallback)) {
      try {
        const transition = await dependencies.auth.completeLogin({
          request,
          returnTo: safeReturnTo(url.searchParams.get("returnTo"), webOrigin)
        });
        return sensitiveRedirect(transition, webOrigin, true);
      } catch (error) {
        return authErrorResponse(error, webOrigin, true);
      }
    }

    if (matches(request, apiRoutes.authLogout)) {
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
    }

    if (matches(request, apiRoutes.organizationsList)) {
      const session = await dependencies.auth.getSession(request);
      if (!session) {
        return unauthorizedResponse(dependencies.auth, request, webOrigin);
      }
      return sensitiveJson(
        await dependencies.organizations.ensureForUser(session.user),
        200,
        webOrigin
      );
    }

    if (matches(request, apiRoutes.organizationsCreate)) {
      if (!hasAllowedOrigin(request, webOrigin)) {
        return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
      }
      const session = await dependencies.auth.getSession(request);
      if (!session) {
        return unauthorizedResponse(dependencies.auth, request, webOrigin);
      }
      try {
        return sensitiveJson(
          await dependencies.organizations.createForUser(
            session.user,
            await request.json()
          ),
          201,
          webOrigin
        );
      } catch (error) {
        return organizationErrorResponse(error, webOrigin);
      }
    }

    if (matches(request, apiRoutes.organizationsSwitch)) {
      if (!hasAllowedOrigin(request, webOrigin)) {
        return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
      }
      const session = await dependencies.auth.getSession(request);
      if (!session) {
        return unauthorizedResponse(dependencies.auth, request, webOrigin);
      }
      try {
        return sensitiveJson(
          await dependencies.organizations.switchForUser(
            session.user,
            await request.json()
          ),
          200,
          webOrigin
        );
      } catch (error) {
        return organizationErrorResponse(error, webOrigin);
      }
    }

    if (matches(request, apiRoutes.organizationUpdate)) {
      if (!hasAllowedOrigin(request, webOrigin)) {
        return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
      }
      const session = await dependencies.auth.getSession(request);
      if (!session) {
        return unauthorizedResponse(dependencies.auth, request, webOrigin);
      }
      try {
        return sensitiveJson(
          await dependencies.organizations.updateActiveForUser(
            session.user,
            await request.json()
          ),
          200,
          webOrigin
        );
      } catch (error) {
        return organizationErrorResponse(error, webOrigin);
      }
    }

    if (matches(request, apiRoutes.organizationMembersList)) {
      const session = await dependencies.auth.getSession(request);
      if (!session) {
        return unauthorizedResponse(dependencies.auth, request, webOrigin);
      }
      try {
        return sensitiveJson(
          await dependencies.organizations.listActiveMembersForUser(session.user),
          200,
          webOrigin
        );
      } catch (error) {
        return organizationErrorResponse(error, webOrigin);
      }
    }

    const memberUserId = matchOrganizationMemberUpdate(request);
    if (memberUserId) {
      if (!hasAllowedOrigin(request, webOrigin)) {
        return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
      }
      const session = await dependencies.auth.getSession(request);
      if (!session) {
        return unauthorizedResponse(dependencies.auth, request, webOrigin);
      }
      try {
        return sensitiveJson(
          await dependencies.organizations.updateActiveMemberRoleForUser(
            session.user,
            memberUserId,
            await request.json()
          ),
          200,
          webOrigin
        );
      } catch (error) {
        return organizationErrorResponse(error, webOrigin);
      }
    }

    if (matches(request, apiRoutes.apiTokenScopes)) {
      return json(
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
      );
    }

    if (matches(request, apiRoutes.apiTokensList)) {
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
    }

    if (matches(request, apiRoutes.apiTokensCreate)) {
      if (!hasAllowedOrigin(request, webOrigin)) {
        return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
      }
      const session = await dependencies.auth.getSession(request);
      if (!session) {
        return unauthorizedResponse(dependencies.auth, request, webOrigin);
      }

      try {
        const organizationContext =
          await dependencies.organizations.ensureForUser(session.user);
        const body = await request.json();
        return sensitiveJson(
          await dependencies.apiTokens.create(
            session.user.id,
            organizationContext.activeOrganizationId,
            body
          ),
          201,
          webOrigin
        );
      } catch (error) {
        return apiTokenErrorResponse(error, webOrigin);
      }
    }

    const revokedTokenId = matchApiTokenRevoke(request);
    if (revokedTokenId) {
      if (!hasAllowedOrigin(request, webOrigin)) {
        return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
      }
      const session = await dependencies.auth.getSession(request);
      if (!session) {
        return unauthorizedResponse(dependencies.auth, request, webOrigin);
      }

      try {
        const organizationContext =
          await dependencies.organizations.ensureForUser(session.user);
        return sensitiveJson(
          await dependencies.apiTokens.revoke(
            session.user.id,
            organizationContext.activeOrganizationId,
            revokedTokenId
          ),
          200,
          webOrigin
        );
      } catch (error) {
        return apiTokenErrorResponse(error, webOrigin);
      }
    }

    if (matches(request, apiRoutes.goalsList)) {
      try {
        const resolved = await resolveGoalAccess(request, dependencies, "read");
        if (!resolved) {
          return unauthorizedResponse(dependencies.auth, request, webOrigin);
        }
        return sensitiveJson(
          await dependencies.goals.listGoals(resolved.access, url.searchParams),
          200,
          webOrigin
        );
      } catch (error) {
        return goalRouteErrorResponse(error, webOrigin);
      }
    }

    if (matches(request, apiRoutes.goalsCreate)) {
      try {
        const resolved = await resolveGoalAccess(request, dependencies, "write");
        if (!resolved) {
          return unauthorizedResponse(dependencies.auth, request, webOrigin);
        }
        if (resolved.session && !hasAllowedOrigin(request, webOrigin)) {
          return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
        }
        return sensitiveJson(
          await dependencies.goals.createGoal(resolved.access, await request.json()),
          201,
          webOrigin
        );
      } catch (error) {
        return goalRouteErrorResponse(error, webOrigin);
      }
    }

    if (matches(request, apiRoutes.goalLabelsList)) {
      try {
        const resolved = await resolveGoalAccess(request, dependencies, "read");
        if (!resolved) {
          return unauthorizedResponse(dependencies.auth, request, webOrigin);
        }
        return sensitiveJson(
          await dependencies.goals.listLabels(resolved.access),
          200,
          webOrigin
        );
      } catch (error) {
        return goalRouteErrorResponse(error, webOrigin);
      }
    }

    if (matches(request, apiRoutes.goalLabelsCreate)) {
      try {
        const resolved = await resolveGoalAccess(request, dependencies, "write");
        if (!resolved) {
          return unauthorizedResponse(dependencies.auth, request, webOrigin);
        }
        if (resolved.session && !hasAllowedOrigin(request, webOrigin)) {
          return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
        }
        return sensitiveJson(
          await dependencies.goals.createLabel(resolved.access, await request.json()),
          201,
          webOrigin
        );
      } catch (error) {
        return goalRouteErrorResponse(error, webOrigin);
      }
    }

    const goalUpdatesMatch = matchGoalUpdatesRoute(request);
    if (goalUpdatesMatch) {
      const operation = request.method === "GET" ? "read" : "write";
      try {
        const resolved = await resolveGoalAccess(
          request,
          dependencies,
          operation
        );
        if (!resolved) {
          return unauthorizedResponse(dependencies.auth, request, webOrigin);
        }
        if (
          operation === "write" &&
          resolved.session &&
          !hasAllowedOrigin(request, webOrigin)
        ) {
          return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
        }
        if (request.method === "GET") {
          return sensitiveJson(
            await dependencies.goals.listUpdates(
              resolved.access,
              goalUpdatesMatch
            ),
            200,
            webOrigin
          );
        }
        return sensitiveJson(
          await dependencies.goals.reportUpdate(
            resolved.access,
            goalUpdatesMatch,
            await request.json()
          ),
          201,
          webOrigin
        );
      } catch (error) {
        return goalRouteErrorResponse(error, webOrigin);
      }
    }

    const goalMatch = matchResourceRoute(request, "/v1/goals/", ["GET", "PATCH"]);
    if (goalMatch) {
      const operation = request.method === "GET" ? "read" : "write";
      try {
        const resolved = await resolveGoalAccess(
          request,
          dependencies,
          operation
        );
        if (!resolved) {
          return unauthorizedResponse(dependencies.auth, request, webOrigin);
        }
        if (
          operation === "write" &&
          resolved.session &&
          !hasAllowedOrigin(request, webOrigin)
        ) {
          return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
        }
        if (request.method === "GET") {
          return sensitiveJson(
            await dependencies.goals.getGoal(resolved.access, goalMatch),
            200,
            webOrigin
          );
        }
        if (request.method === "PATCH") {
          return sensitiveJson(
            await dependencies.goals.updateGoal(
              resolved.access,
              goalMatch,
              await request.json()
            ),
            200,
            webOrigin
          );
        }
        return json({ error: "method_not_allowed" }, 405, webOrigin);
      } catch (error) {
        return goalRouteErrorResponse(error, webOrigin);
      }
    }

    const labelMatch = matchResourceRoute(request, "/v1/goal-labels/");
    if (labelMatch) {
      const operation = request.method === "GET" ? "read" : "write";
      try {
        const resolved = await resolveGoalAccess(
          request,
          dependencies,
          operation
        );
        if (!resolved) {
          return unauthorizedResponse(dependencies.auth, request, webOrigin);
        }
        if (
          operation === "write" &&
          resolved.session &&
          !hasAllowedOrigin(request, webOrigin)
        ) {
          return sensitiveJson({ error: "forbidden" }, 403, webOrigin);
        }
        if (request.method === "GET") {
          return sensitiveJson(
            await dependencies.goals.getLabel(resolved.access, labelMatch),
            200,
            webOrigin
          );
        }
        if (request.method === "PATCH") {
          return sensitiveJson(
            await dependencies.goals.updateLabel(
              resolved.access,
              labelMatch,
              await request.json()
            ),
            200,
            webOrigin
          );
        }
        await dependencies.goals.deleteLabel(resolved.access, labelMatch);
        return sensitiveEmpty(204, webOrigin);
      } catch (error) {
        return goalRouteErrorResponse(error, webOrigin);
      }
    }

    return json({ error: "not_found" }, 404, webOrigin);
  };
}

async function resolveGoalAccess(
  request: Request,
  dependencies: ApiDependencies,
  operation: "read" | "write"
): Promise<{ access: GoalAccess; session: boolean } | null> {
  const authorization = request.headers.get("authorization");
  if (authorization) {
    const principal = await dependencies.apiTokens.resolveRequest(request);
    if (!principal) {
      throw new ApiTokenError("invalid_api_token", "Invalid API token", 401);
    }
    const role = await dependencies.organizations.roleForUser(
      principal.userId,
      principal.organizationId
    );
    const allScope = `goals:${operation}:all` as const;
    const canUseAll =
      principal.scopes.includes(allScope) &&
      (operation === "read" || role === "owner" || role === "admin");
    const action = canUseAll
      ? `goals.${operation}.all`
      : `goals.${operation}.own`;
    await authorizeApiToken(principal, action, () => {
      return role !== null;
    });
    return {
      access: {
        userId: principal.userId,
        organizationId: principal.organizationId,
        readAll: action === "goals.read.all",
        writeAll: action === "goals.write.all",
        actor: { kind: "client", id: principal.tokenId, runId: null },
        authentication: { kind: "api_token", subjectId: principal.tokenId },
        clientInfo: null
      },
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

function goalRouteErrorResponse(error: unknown, webOrigin: string): Response {
  if (error instanceof GoalError || error instanceof ApiTokenError) {
    return sensitiveJson(
      { error: error.code, message: error.message },
      error.status,
      webOrigin
    );
  }
  if (error instanceof SyntaxError) {
    return sensitiveJson(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      400,
      webOrigin
    );
  }
  throw error;
}

function organizationErrorResponse(
  error: unknown,
  webOrigin: string
): Response {
  if (error instanceof OrganizationError) {
    return sensitiveJson(
      { error: error.code, message: error.message },
      error.status,
      webOrigin
    );
  }
  if (error instanceof SyntaxError) {
    return sensitiveJson(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      400,
      webOrigin
    );
  }
  throw error;
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

function apiTokenErrorResponse(error: unknown, webOrigin: string): Response {
  if (error instanceof ApiTokenError) {
    return sensitiveJson(
      { error: error.code, message: error.message },
      error.status,
      webOrigin
    );
  }
  if (error instanceof SyntaxError) {
    return sensitiveJson(
      { error: "invalid_json", message: "Request body must be valid JSON" },
      400,
      webOrigin
    );
  }
  throw error;
}

function authErrorResponse(
  error: unknown,
  webOrigin: string,
  noReferrer = false
): Response {
  if (error instanceof AuthError) {
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
  throw error;
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
  const requestOrigin = request.headers.get("origin");
  return requestOrigin === webOrigin;
}

function matches(
  request: Request,
  route: { method: string; path: string }
): boolean {
  return (
    request.method === route.method && new URL(request.url).pathname === route.path
  );
}

function matchApiTokenRevoke(request: Request): string | null {
  if (request.method !== apiRoutes.apiTokenRevoke.method) return null;
  const match = new URL(request.url).pathname.match(/^\/v1\/api-tokens\/([^/]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function matchOrganizationMemberUpdate(request: Request): string | null {
  if (request.method !== apiRoutes.organizationMemberUpdate.method) return null;
  const match = new URL(request.url).pathname.match(
    /^\/v1\/organizations\/current\/members\/([^/]+)$/
  );
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function matchResourceRoute(
  request: Request,
  prefix: string,
  methods: readonly string[] = ["GET", "PATCH", "DELETE"]
): string | null {
  if (!methods.includes(request.method)) {
    return null;
  }
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith(prefix)) return null;
  const encoded = pathname.slice(prefix.length);
  if (!encoded || encoded.includes("/")) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

function matchGoalUpdatesRoute(request: Request): string | null {
  if (request.method !== "GET" && request.method !== "POST") return null;
  const match = new URL(request.url).pathname.match(
    /^\/v1\/goals\/([^/]+)\/updates$/
  );
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
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
  response.headers.append("vary", "Origin");
  return response;
}
