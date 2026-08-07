import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthMetadata,
  type OAuthTokenVerifier
} from "@modelcontextprotocol/server";
import type { ApiTokenService } from "../../api/src/api-tokens/service";
import type {
  GoalActor,
  GoalAuthentication
} from "../../api/src/goals/types";

export type McpOAuthIdentity = {
  userId: string;
  organizationId: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource: string;
  /** A provider-verified agent binding. Client-supplied metadata is insufficient. */
  actor?: { kind: "agent"; id: string; runId?: string | null };
};

export interface McpOAuthProvider {
  /**
   * Validated authorization-server metadata. Registration may use CIMD, DCR,
   * or a client that was registered out of band.
   */
  readonly metadata: OAuthMetadata & {
    issuer: string;
    registration_endpoint?: string;
  };
  /** Minimal scopes advertised for initial connector functionality. */
  readonly scopesSupported?: readonly string[];
  /** Scopes requested by the first unauthenticated MCP challenge. */
  readonly initialScopes?: readonly string[];
  /**
   * Validate signature or introspection state, issuer, expiry, and the exact
   * RFC 8707 resource audience before returning an identity.
   */
  verifyAccessToken(
    token: string,
    input: { resource: URL }
  ): Promise<McpOAuthIdentity | null>;
}

export type GoalkeeperMcpPrincipal = {
  kind: "apiToken" | "oauth";
  userId: string;
  organizationId: string;
  actor: GoalActor;
  authentication: GoalAuthentication;
};

export function createMcpTokenVerifier(input: {
  apiTokens: ApiTokenService;
  resource: URL;
  oauthProvider?: McpOAuthProvider;
}): OAuthTokenVerifier {
  const canonicalResource = validateMcpResourceUrl(
    input.resource,
    "MCP resource URL"
  );

  return {
    async verifyAccessToken(token): Promise<AuthInfo> {
      const apiToken = await input.apiTokens.resolve(token);
      if (apiToken) {
        return {
          token,
          clientId: `goalkeeper-api-token:${apiToken.tokenId}`,
          scopes: apiToken.scopes,
          expiresAt: Math.floor(new Date(apiToken.expiresAt).getTime() / 1000),
          resource: canonicalResource,
          extra: {
            goalkeeperPrincipal: {
              kind: "apiToken",
              userId: apiToken.userId,
              organizationId: apiToken.organizationId,
              actor: { kind: "client", id: apiToken.tokenId, runId: null },
              authentication: {
                kind: "api_token",
                subjectId: apiToken.tokenId
              }
            } satisfies GoalkeeperMcpPrincipal
          }
        };
      }

      const identity = await input.oauthProvider?.verifyAccessToken(token, {
        resource: canonicalResource
      });
      if (!identity || !matchesResource(identity.resource, canonicalResource)) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token");
      }
      if (!Number.isFinite(identity.expiresAt) || identity.expiresAt <= 0) {
        throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid access token expiry");
      }
      return {
        token,
        clientId: identity.clientId,
        scopes: [...new Set(identity.scopes)],
        expiresAt: identity.expiresAt,
        resource: canonicalResource,
        extra: {
          goalkeeperPrincipal: {
            kind: "oauth",
            userId: identity.userId,
            organizationId: identity.organizationId,
            actor: identity.actor
              ? {
                  kind: "agent",
                  id: identity.actor.id,
                  runId: identity.actor.runId ?? null
                }
              : { kind: "client", id: identity.clientId, runId: null },
            authentication: { kind: "oauth", subjectId: identity.clientId }
          } satisfies GoalkeeperMcpPrincipal
        }
      };
    }
  };
}

export function principalFromAuthInfo(authInfo: AuthInfo): GoalkeeperMcpPrincipal {
  const candidate = authInfo.extra?.goalkeeperPrincipal;
  if (!candidate || typeof candidate !== "object") {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Missing Goalkeeper principal");
  }
  const principal = candidate as Partial<GoalkeeperMcpPrincipal>;
  if (
    (principal.kind !== "apiToken" && principal.kind !== "oauth") ||
    typeof principal.userId !== "string" ||
    !principal.userId ||
    typeof principal.organizationId !== "string" ||
    !principal.organizationId ||
    !isGoalActor(principal.actor) ||
    !isGoalAuthentication(principal.authentication) ||
    !matchesPrincipalKind(principal)
  ) {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid Goalkeeper principal");
  }
  return principal as GoalkeeperMcpPrincipal;
}

function isGoalActor(value: unknown): value is GoalActor {
  if (!value || typeof value !== "object") return false;
  const actor = value as Partial<GoalActor>;
  if (
    typeof actor.id !== "string" ||
    !actor.id.trim() ||
    actor.id.length > 200
  ) {
    return false;
  }
  if (actor.kind === "agent") {
    return (
      actor.runId === null ||
      (typeof actor.runId === "string" &&
        actor.runId.length <= 200 &&
        actor.runId.trim().length > 0)
    );
  }
  return (
    (actor.kind === "user" || actor.kind === "client") && actor.runId === null
  );
}

function matchesPrincipalKind(
  principal: Partial<GoalkeeperMcpPrincipal>
): boolean {
  if (principal.kind === "apiToken") {
    return (
      principal.actor?.kind === "client" &&
      principal.authentication?.kind === "api_token"
    );
  }
  return (
    principal.kind === "oauth" &&
    (principal.actor?.kind === "client" || principal.actor?.kind === "agent") &&
    principal.authentication?.kind === "oauth"
  );
}

function isGoalAuthentication(value: unknown): value is GoalAuthentication {
  if (!value || typeof value !== "object") return false;
  const authentication = value as Partial<GoalAuthentication>;
  return (
    (authentication.kind === "session" ||
      authentication.kind === "api_token" ||
      authentication.kind === "oauth") &&
    typeof authentication.subjectId === "string" &&
    authentication.subjectId.length > 0
  );
}

export function assertOAuthProviderConfiguration(
  provider: McpOAuthProvider,
  dangerouslyAllowInsecureIssuerUrl: boolean
) {
  assertSecureOAuthUrl(
    provider.metadata.issuer,
    "issuer",
    dangerouslyAllowInsecureIssuerUrl
  );
  assertSecureOAuthUrl(
    provider.metadata.authorization_endpoint,
    "authorization endpoint",
    dangerouslyAllowInsecureIssuerUrl
  );
  assertSecureOAuthUrl(
    provider.metadata.token_endpoint,
    "token endpoint",
    dangerouslyAllowInsecureIssuerUrl
  );
  if (provider.metadata.registration_endpoint) {
    assertSecureOAuthUrl(
      provider.metadata.registration_endpoint,
      "dynamic registration endpoint",
      dangerouslyAllowInsecureIssuerUrl
    );
  }
}

function assertSecureOAuthUrl(
  value: string,
  label: string,
  dangerouslyAllowInsecureIssuerUrl: boolean
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`MCP OAuth ${label} must be a valid URL`);
  }
  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  if (
    url.protocol !== "https:" &&
    !(
      dangerouslyAllowInsecureIssuerUrl &&
      url.protocol === "http:" &&
      isLoopback
    )
  ) {
    throw new Error(`MCP OAuth ${label} must use HTTPS`);
  }
}

export function validateMcpResourceUrl(
  value: string | URL,
  label = "PUBLIC_MCP_URL"
): URL {
  let resource: URL;
  try {
    resource = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid absolute URL`);
  }

  if (resource.hash) {
    throw new Error(`${label} must not contain a fragment`);
  }
  if (resource.username || resource.password) {
    throw new Error(`${label} must not contain credentials`);
  }

  const isLoopback =
    resource.hostname === "localhost" ||
    resource.hostname === "127.0.0.1" ||
    resource.hostname === "[::1]" ||
    resource.hostname === "::1";
  if (
    resource.protocol !== "https:" &&
    !(resource.protocol === "http:" && isLoopback)
  ) {
    throw new Error(`${label} must use HTTPS outside loopback development`);
  }

  return resource;
}

function matchesResource(candidate: string, expected: URL): boolean {
  try {
    return (
      validateMcpResourceUrl(candidate, "OAuth resource").href === expected.href
    );
  } catch {
    return false;
  }
}
