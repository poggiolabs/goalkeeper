import {
  type AuthBackend,
  type AuthSession,
  type AuthTransitionInput,
  type AuthUser
} from "./types";

export const trustedProxyAssertionHeader = "x-goalkeeper-auth-assertion";
export const trustedProxySignatureHeader = "x-goalkeeper-auth-signature";

const assertionVersion = 1;
const defaultMaximumAgeSeconds = 30;
const maximumFutureSkewSeconds = 5;

export type TrustedProxyAssertion = {
  v: 1;
  iss: string;
  aud: string;
  iat: number;
  method: string;
  path: string;
  sessionId: string;
  user: AuthUser & { emailVerified?: boolean };
};

export function createTrustedProxyAuthBackend(options: {
  secret: string;
  issuer: string;
  audience: string;
  loginUrl: string;
  logoutUrl: string;
  maximumAgeSeconds?: number;
  now?: () => Date;
}): AuthBackend {
  if (new TextEncoder().encode(options.secret).byteLength < 32) {
    throw new Error("AUTH_PROXY_SECRET must contain at least 32 bytes");
  }
  const issuer = requiredCoordinate(options.issuer, "AUTH_PROXY_ISSUER");
  const audience = requiredCoordinate(options.audience, "AUTH_PROXY_AUDIENCE");
  const loginUrl = transitionUrl(options.loginUrl, "AUTH_PROXY_LOGIN_URL");
  const logoutUrl = transitionUrl(options.logoutUrl, "AUTH_PROXY_LOGOUT_URL");
  const maximumAgeSeconds =
    options.maximumAgeSeconds ?? defaultMaximumAgeSeconds;
  if (!Number.isInteger(maximumAgeSeconds) || maximumAgeSeconds < 1) {
    throw new Error("Trusted proxy assertion maximum age must be a positive integer");
  }
  const now = options.now ?? (() => new Date());
  const verificationKey = importVerificationKey(options.secret);

  return {
    method: "redirect",

    async getSession(request) {
      const encoded = request.headers.get(trustedProxyAssertionHeader);
      const signature = request.headers.get(trustedProxySignatureHeader);
      if (!encoded && !signature) return null;
      if (!encoded || !signature) return null;

      const assertion = decodeAssertion(encoded);
      if (!assertion) return null;
      if (
        !(await verifySignature(await verificationKey, encoded, signature)) ||
        assertion.iss !== issuer ||
        assertion.aud !== audience ||
        assertion.method !== request.method ||
        assertion.path !== requestPath(request)
      ) {
        return null;
      }
      const ageSeconds = Math.floor(now().getTime() / 1000) - assertion.iat;
      if (
        ageSeconds < -maximumFutureSkewSeconds ||
        ageSeconds > maximumAgeSeconds
      ) {
        return null;
      }
      return { id: assertion.sessionId, user: assertion.user };
    },

    async beginLogin(input: AuthTransitionInput) {
      const redirectTo = new URL(loginUrl);
      redirectTo.searchParams.set("returnTo", input.returnTo);
      return { redirectTo: redirectTo.toString() };
    },

    async completeLogin(input: AuthTransitionInput) {
      return { redirectTo: input.returnTo };
    },

    async logout() {
      return { redirectTo: logoutUrl.toString() };
    }
  };
}

function requiredCoordinate(value: string, name: string) {
  const normalized = value.trim();
  if (!normalized || /[\r\n]/.test(normalized)) {
    throw new Error(`${name} must be a non-empty single line`);
  }
  if (normalized.length > 255) {
    throw new Error(`${name} must be at most 255 characters`);
  }
  return normalized;
}

function transitionUrl(value: string, name: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must be an absolute HTTP(S) URL`);
  }
  return url;
}

function requestPath(request: Request) {
  const url = new URL(request.url);
  return `${url.pathname}${url.search}`;
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

function decodeAssertion(encoded: string): TrustedProxyAssertion | null {
  const bytes = decodeBase64Url(encoded);
  if (!bytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (!isRecord(value) || !isRecord(value.user)) return null;
  const assertion = value as Record<string, unknown> & {
    user: Record<string, unknown>;
  };
  if (
    assertion.v !== assertionVersion ||
    !isCoordinate(assertion.iss) ||
    !isCoordinate(assertion.aud) ||
    !Number.isSafeInteger(assertion.iat) ||
    typeof assertion.method !== "string" ||
    !/^[A-Z]+$/.test(assertion.method) ||
    typeof assertion.path !== "string" ||
    !assertion.path.startsWith("/") ||
    !isIdentifier(assertion.sessionId) ||
    !isIdentifier(assertion.user.id) ||
    typeof assertion.user.displayName !== "string" ||
    assertion.user.displayName.length < 1 ||
    assertion.user.displayName.length > 100 ||
    typeof assertion.user.email !== "string" ||
    assertion.user.email !== assertion.user.email.toLowerCase() ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(assertion.user.email) ||
    // Authorization is keyed to the address — organization invitations are
    // claimed by it — so a proxy that admits it has not verified ownership
    // must be refused. Absent stays acceptable for v1 proxies that predate
    // the field; see the capability note in the trusted-proxy docs.
    ("emailVerified" in assertion.user && assertion.user.emailVerified !== true)
  ) {
    return null;
  }
  return assertion as unknown as TrustedProxyAssertion;
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
