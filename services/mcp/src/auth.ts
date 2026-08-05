import {
  OAuthError,
  OAuthErrorCode,
  type AuthInfo,
  type OAuthMetadata,
  type OAuthTokenVerifier
} from "@modelcontextprotocol/server";
import type { ApiTokenService } from "../../api/src/api-tokens/service";

export type McpOAuthIdentity = {
  userId: string;
  organizationId: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
  resource: string;
};

export interface McpOAuthProvider {
  /**
   * Validated authorization-server metadata. A registration endpoint is
   * required because Goalkeeper advertises DCR support through the provider.
   */
  readonly metadata: OAuthMetadata & {
    issuer: string;
    registration_endpoint: string;
  };
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
};

export function createMcpTokenVerifier(input: {
  apiTokens: ApiTokenService;
  resource: URL;
  oauthProvider?: McpOAuthProvider;
}): OAuthTokenVerifier {
  const canonicalResource = canonicalResourceUrl(input.resource);

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
              organizationId: apiToken.organizationId
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
            organizationId: identity.organizationId
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
    !principal.organizationId
  ) {
    throw new OAuthError(OAuthErrorCode.InvalidToken, "Invalid Goalkeeper principal");
  }
  return principal as GoalkeeperMcpPrincipal;
}

export function assertOAuthProviderConfiguration(
  provider: McpOAuthProvider,
  dangerouslyAllowInsecureIssuerUrl: boolean
) {
  const registrationEndpoint = new URL(provider.metadata.registration_endpoint);
  if (
    registrationEndpoint.protocol !== "https:" &&
    !(
      dangerouslyAllowInsecureIssuerUrl &&
      (registrationEndpoint.hostname === "localhost" ||
        registrationEndpoint.hostname === "127.0.0.1")
    )
  ) {
    throw new Error("MCP OAuth dynamic registration endpoint must use HTTPS");
  }
}

function canonicalResourceUrl(resource: URL): URL {
  const canonical = new URL(resource);
  canonical.hash = "";
  return canonical;
}

function matchesResource(candidate: string, expected: URL): boolean {
  try {
    return canonicalResourceUrl(new URL(candidate)).href === expected.href;
  } catch {
    return false;
  }
}
