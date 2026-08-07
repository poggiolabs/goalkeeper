import type { OrganizationService } from "../../api/src/organizations/service";
import type { McpOAuthProvider } from "./auth";

const assertionVersion = 1;
const defaultMaximumAgeSeconds = 30;
const maximumFutureSkewSeconds = 5;

export type TrustedMcpOAuthAssertion = {
  v: 1;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  resource: string;
  clientId: string;
  scopes: string[];
  userId: string;
  organizationId: string;
};

/**
 * Accepts short-lived identity assertions from a trusted deployment ingress.
 * The ingress remains responsible for validating the external OAuth token;
 * this provider verifies only the private ingress-to-service credential.
 */
export function createTrustedProxyMcpOAuthProvider(options: {
  secret: string;
  issuer: string;
  audience: string;
  metadata: McpOAuthProvider["metadata"];
  scopesSupported?: readonly string[];
  initialScopes?: readonly string[];
  organizations: OrganizationService;
  maximumAgeSeconds?: number;
  now?: () => Date;
}): McpOAuthProvider {
  if (new TextEncoder().encode(options.secret).byteLength < 32) {
    throw new Error("MCP_OAUTH_PROXY_SECRET must contain at least 32 bytes");
  }
  const issuer = requiredCoordinate(options.issuer, "MCP_OAUTH_PROXY_ISSUER");
  const audience = requiredCoordinate(
    options.audience,
    "MCP_OAUTH_PROXY_AUDIENCE"
  );
  const maximumAgeSeconds =
    options.maximumAgeSeconds ?? defaultMaximumAgeSeconds;
  if (
    !Number.isInteger(maximumAgeSeconds) ||
    maximumAgeSeconds < 1 ||
    maximumAgeSeconds > defaultMaximumAgeSeconds
  ) {
    throw new Error(
      "MCP OAuth proxy maximum age must be an integer from 1 to 30"
    );
  }
  const now = options.now ?? (() => new Date());
  const verificationKey = importVerificationKey(options.secret);

  return {
    metadata: options.metadata,
    scopesSupported: options.scopesSupported,
    initialScopes: options.initialScopes,

    async verifyAccessToken(token, input) {
      const separator = token.indexOf(".");
      if (separator <= 0 || separator !== token.lastIndexOf(".")) return null;
      const encoded = token.slice(0, separator);
      const signature = token.slice(separator + 1);
      const assertion = decodeAssertion(encoded);
      if (!assertion) return null;
      if (
        !(await verifySignature(await verificationKey, encoded, signature)) ||
        assertion.iss !== issuer ||
        assertion.aud !== audience ||
        assertion.resource !== input.resource.href
      ) {
        return null;
      }

      const nowSeconds = Math.floor(now().getTime() / 1000);
      const ageSeconds = nowSeconds - assertion.iat;
      if (
        ageSeconds < -maximumFutureSkewSeconds ||
        ageSeconds > maximumAgeSeconds ||
        assertion.exp <= assertion.iat ||
        assertion.exp - assertion.iat > maximumAgeSeconds ||
        assertion.exp <= nowSeconds
      ) {
        return null;
      }

      const role = await options.organizations.roleForUser(
        assertion.userId,
        assertion.organizationId
      );
      if (!role) return null;
      return {
        userId: assertion.userId,
        organizationId: assertion.organizationId,
        clientId: assertion.clientId,
        scopes: assertion.scopes,
        expiresAt: assertion.exp,
        resource: assertion.resource
      };
    }
  };
}

function requiredCoordinate(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 255 || /[\r\n]/.test(normalized)) {
    throw new Error(`${name} must be a non-empty single line of at most 255 characters`);
  }
  return normalized;
}

async function importVerificationKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

async function verifySignature(
  key: CryptoKey,
  encoded: string,
  signature: string
) {
  const bytes = decodeBase64Url(signature);
  if (!bytes || bytes.byteLength !== 32) return false;
  const signatureBytes = new Uint8Array(bytes.byteLength);
  signatureBytes.set(bytes);
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes.buffer,
    new TextEncoder().encode(encoded)
  );
}

function decodeAssertion(encoded: string): TrustedMcpOAuthAssertion | null {
  const bytes = decodeBase64Url(encoded);
  if (!bytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const assertion = value as Record<string, unknown>;
  if (
    assertion.v !== assertionVersion ||
    !isCoordinate(assertion.iss) ||
    !isCoordinate(assertion.aud) ||
    !Number.isSafeInteger(assertion.iat) ||
    !Number.isSafeInteger(assertion.exp) ||
    !isAbsoluteResource(assertion.resource) ||
    !isIdentifier(assertion.clientId) ||
    !Array.isArray(assertion.scopes) ||
    assertion.scopes.length > 100 ||
    assertion.scopes.some((scope) => !isIdentifier(scope)) ||
    !isIdentifier(assertion.userId) ||
    !isOrganizationId(assertion.organizationId)
  ) {
    return null;
  }
  return assertion as unknown as TrustedMcpOAuthAssertion;
}

function isAbsoluteResource(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCoordinate(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 255;
}

function isIdentifier(value: unknown): value is string {
  return isCoordinate(value) && !/[\s\r\n]/.test(value);
}

function isOrganizationId(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value);
}

function decodeBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    return Uint8Array.from(
      atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
        Math.ceil(value.length / 4) * 4,
        "="
      )),
      (character) => character.charCodeAt(0)
    );
  } catch {
    return null;
  }
}
