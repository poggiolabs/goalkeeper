import {
  apiTokenScopeRegistry,
  apiTokenScopes,
  type ApiToken,
  type ApiTokenCapability,
  type ApiTokenPrincipal,
  type ApiTokenRepository,
  type ApiTokenScope
} from "./types";

const tokenPattern = /^gk_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/;
const tokenIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const defaultExpiryDays = 90;
const maximumExpiryDays = 365;
const lastUsedWriteIntervalMs = 5 * 60_000;

export class ApiTokenError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "ApiTokenError";
  }
}

export type ApiTokenService = ReturnType<typeof createApiTokenService>;

export function createApiTokenService(
  repository: ApiTokenRepository,
  options: {
    now?: () => Date;
    randomBytes?: (length: number) => Uint8Array;
  } = {}
) {
  const now = options.now ?? (() => new Date());
  const randomBytes = options.randomBytes ?? secureRandomBytes;

  async function resolve(secret: string): Promise<ApiTokenPrincipal | null> {
    if (!tokenPattern.test(secret)) return null;

    const usedAt = now();
    const record = await repository.findActiveByHash(
      await hashToken(secret),
      usedAt
    );
    if (!record) return null;

    if (
      !record.lastUsedAt ||
      record.lastUsedAt.getTime() < usedAt.getTime() - lastUsedWriteIntervalMs
    ) {
      await repository.touchLastUsed(
        record.id,
        usedAt,
        new Date(usedAt.getTime() - lastUsedWriteIntervalMs)
      );
    }

    return {
      kind: "apiToken",
      tokenId: record.id,
      userId: record.ownerUserId,
      organizationId: record.organizationId,
      sessionId: null,
      scopes: record.scopes
    };
  }

  return {
    async list(
      ownerUserId: string,
      organizationId: string
    ): Promise<{ tokens: ApiToken[] }> {
      const records = await repository.listActive(ownerUserId, organizationId, now());
      return { tokens: records.map(toApiToken) };
    },

    async create(
      ownerUserId: string,
      organizationId: string,
      request: unknown
    ): Promise<{ token: ApiToken; secret: string }> {
      const input = normalizeCreateRequest(request);
      const createdAt = now();
      const expiresAt = new Date(
        createdAt.getTime() + input.expiresInDays * 86_400_000
      );
      const publicId = toHex(randomBytes(8));
      const prefix = `gk_${publicId}`;
      const secret = `${prefix}_${toBase64Url(randomBytes(32))}`;

      const record = await repository.insert({
        ownerUserId,
        organizationId,
        name: input.name,
        prefix,
        tokenHash: await hashToken(secret),
        scopes: input.scopes,
        expiresAt,
        createdAt
      });

      return { token: toApiToken(record), secret };
    },

    async revoke(
      ownerUserId: string,
      organizationId: string,
      tokenId: string
    ): Promise<{ token: ApiToken }> {
      if (!tokenIdPattern.test(tokenId)) {
        throw new ApiTokenError("api_token_not_found", "API token not found", 404);
      }

      const record = await repository.revoke(
        ownerUserId,
        organizationId,
        tokenId,
        now()
      );
      if (!record) {
        throw new ApiTokenError("api_token_not_found", "API token not found", 404);
      }
      return { token: toApiToken(record) };
    },

    resolve,

    async resolveRequest(request: Request): Promise<ApiTokenPrincipal | null> {
      const authorization = request.headers.get("authorization");
      const match = authorization?.match(/^Bearer ([^\s]+)$/i);
      return match?.[1] ? resolve(match[1]) : null;
    }
  };
}

export async function authorizeApiToken(
  principal: ApiTokenPrincipal,
  action: string,
  ownerAllows: (
    userId: string,
    organizationId: string,
    action: string
  ) => boolean | Promise<boolean>
) {
  const acceptedScopes = apiTokenScopeRegistry
    .filter((scope) =>
      (scope.capabilities as readonly string[]).includes(action)
    )
    .map((scope) => scope.id);
  if (acceptedScopes.length === 0) {
    throw new ApiTokenError(
      "api_token_not_allowed",
      "API tokens cannot access this operation",
      403
    );
  }
  if (!acceptedScopes.some((scope) => principal.scopes.includes(scope))) {
    throw new ApiTokenError(
      "insufficient_scope",
      `API token requires one of these scopes: ${acceptedScopes.join(", ")}`,
      403
    );
  }
  if (!(await ownerAllows(principal.userId, principal.organizationId, action))) {
    throw new ApiTokenError(
      "permission_denied",
      "The token owner cannot access this operation",
      403
    );
  }

  return {
    allowed: true as const,
    action: action as ApiTokenCapability,
    acceptedScopes
  };
}

export async function hashToken(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret)
  );
  return toHex(new Uint8Array(digest));
}

function normalizeCreateRequest(request: unknown): {
  name: string;
  scopes: ApiTokenScope[];
  expiresInDays: number;
} {
  if (!request || typeof request !== "object") {
    throw new ApiTokenError("invalid_api_token", "Invalid API token request");
  }

  const candidate = request as {
    name?: unknown;
    scopes?: unknown;
    expiresInDays?: unknown;
  };
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name || name.length > 100) {
    throw new ApiTokenError(
      "invalid_api_token_name",
      "API token name must contain 1-100 characters"
    );
  }

  if (!Array.isArray(candidate.scopes) || candidate.scopes.length === 0) {
    throw new ApiTokenError(
      "invalid_api_token_scopes",
      "At least one API token scope is required"
    );
  }
  const allowedScopes = new Set<string>(apiTokenScopes);
  const scopes = [...new Set(candidate.scopes)];
  if (
    scopes.some(
      (scope): boolean => typeof scope !== "string" || !allowedScopes.has(scope)
    )
  ) {
    throw new ApiTokenError(
      "invalid_api_token_scopes",
      "API token scopes contain an unsupported value"
    );
  }

  const expiresInDays = candidate.expiresInDays ?? defaultExpiryDays;
  if (
    !Number.isInteger(expiresInDays) ||
    (expiresInDays as number) < 1 ||
    (expiresInDays as number) > maximumExpiryDays
  ) {
    throw new ApiTokenError(
      "invalid_api_token_expiry",
      `API token expiry must be between 1 and ${maximumExpiryDays} days`
    );
  }

  return {
    name,
    scopes: scopes as ApiTokenScope[],
    expiresInDays: expiresInDays as number
  };
}

function toApiToken(record: {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): ApiToken {
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    scopes: record.scopes,
    expiresAt: record.expiresAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    revokedAt: record.revokedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString()
  };
}

function secureRandomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
