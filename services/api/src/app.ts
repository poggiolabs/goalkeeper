import {
  AuthError,
  isEmailAuthBackend,
  type AuthBackend,
  type AuthTransition
} from "./auth/types";
import { ApiTokenError, type ApiTokenService } from "./api-tokens/service";
import { apiTokenScopeRegistry } from "./api-tokens/types";
import { apiRoutes } from "./routes";

export type ApiDependencies = {
  auth: AuthBackend;
  apiTokens: ApiTokenService;
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
        ? sensitiveJson(session, 200, webOrigin)
        : sensitiveJson({ error: "unauthorized" }, 401, webOrigin);
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
          returnTo: new URL("/", webOrigin).toString()
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
        return sensitiveJson({ error: "unauthorized" }, 401, webOrigin);
      }

      return sensitiveJson(
        await dependencies.apiTokens.list(session.user.id),
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
        return sensitiveJson({ error: "unauthorized" }, 401, webOrigin);
      }

      try {
        const body = await request.json();
        return sensitiveJson(
          await dependencies.apiTokens.create(session.user.id, body),
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
        return sensitiveJson({ error: "unauthorized" }, 401, webOrigin);
      }

      try {
        return sensitiveJson(
          await dependencies.apiTokens.revoke(session.user.id, revokedTokenId),
          200,
          webOrigin
        );
      } catch (error) {
        return apiTokenErrorResponse(error, webOrigin);
      }
    }

    return json({ error: "not_found" }, 404, webOrigin);
  };
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
  fallbackPath = "/account"
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
    "GET, POST, DELETE, OPTIONS"
  );
  response.headers.set(
    "access-control-allow-headers",
    "authorization, content-type"
  );
  response.headers.append("vary", "Origin");
  return response;
}
