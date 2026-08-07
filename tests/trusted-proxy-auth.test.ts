import { describe, expect, test } from "bun:test";
import {
  createTrustedProxyAuthBackend,
  trustedProxyAssertionHeader,
  trustedProxySignatureHeader,
  type TrustedProxyAssertion
} from "../services/api/src/auth/trusted-proxy";

const secret = "proxy-test-secret-that-is-at-least-thirty-two-bytes";
const now = new Date("2026-08-05T20:00:00Z");

function backend() {
  return createTrustedProxyAuthBackend({
    secret,
    issuer: "deployment-ingress",
    audience: "goalkeeper-production",
    loginUrl: "https://gkeeper.ai/_auth/login",
    logoutUrl: "https://gkeeper.ai/_auth/logout",
    now: () => now
  });
}

function assertion(overrides: Partial<TrustedProxyAssertion> = {}) {
  return {
    v: 1,
    iss: "deployment-ingress",
    aud: "goalkeeper-production",
    iat: Math.floor(now.getTime() / 1000),
    method: "GET",
    path: "/v1/auth/session?fresh=1",
    sessionId: "external:session_01",
    user: {
      id: "external:user_01",
      displayName: "Ada Lovelace",
      email: "ada@example.com"
    },
    ...overrides
  } satisfies TrustedProxyAssertion;
}

async function signedRequest(value = assertion()) {
  const encoded = base64Url(JSON.stringify(value));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = base64Url(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(encoded)
  ));
  return new Request("https://gkeeper.ai/v1/auth/session?fresh=1", {
    headers: {
      [trustedProxyAssertionHeader]: encoded,
      [trustedProxySignatureHeader]: signature
    }
  });
}

describe("trusted proxy auth backend", () => {
  test("rejects proxy coordinates that assertions cannot represent", () => {
    for (const coordinate of ["issuer", "audience"] as const) {
      expect(() => createTrustedProxyAuthBackend({
        secret,
        issuer: "deployment-ingress",
        audience: "goalkeeper-production",
        loginUrl: "https://gkeeper.ai/_auth/login",
        logoutUrl: "https://gkeeper.ai/_auth/logout",
        [coordinate]: "x".repeat(256)
      })).toThrow(
        `${coordinate === "issuer" ? "AUTH_PROXY_ISSUER" : "AUTH_PROXY_AUDIENCE"} must be at most 255 characters`
      );
    }
  });

  test("accepts a fresh request-bound signed identity", async () => {
    expect(await backend().getSession(await signedRequest())).toEqual({
      id: "external:session_01",
      user: {
        id: "external:user_01",
        displayName: "Ada Lovelace",
        email: "ada@example.com"
      }
    });
  });

  test("rejects tampering, replay on another path, and stale assertions", async () => {
    const tampered = await signedRequest();
    tampered.headers.set(trustedProxyAssertionHeader, base64Url(JSON.stringify(
      assertion({ sessionId: "external:attacker" })
    )));
    expect(await backend().getSession(tampered)).toBeNull();

    const replay = await signedRequest();
    expect(await backend().getSession(new Request(
      "https://gkeeper.ai/v1/organizations",
      replay
    ))).toBeNull();

    expect(await backend().getSession(await signedRequest(assertion({
      iat: Math.floor(now.getTime() / 1000) - 31
    })))).toBeNull();
  });

  test("returns no session for absent or partial assertions", async () => {
    expect(await backend().getSession(new Request("https://gkeeper.ai/v1")))
      .toBeNull();
    expect(await backend().getSession(new Request("https://gkeeper.ai/v1", {
      headers: { [trustedProxyAssertionHeader]: "abc" }
    }))).toBeNull();
  });

  test("refuses an assertion whose proxy admits the email is unverified", async () => {
    // Invitations are claimed by email address, so an unverified address is
    // an account-takeover vector. Absent remains acceptable for proxies that
    // predate the field.
    expect(
      await backend().getSession(
        await signedRequest(
          assertion({
            user: {
              id: "external:user_01",
              displayName: "Ada Lovelace",
              email: "ada@example.com",
              emailVerified: false
            }
          })
        )
      )
    ).toBeNull();

    const verified = await backend().getSession(
      await signedRequest(
        assertion({
          user: {
            id: "external:user_01",
            displayName: "Ada Lovelace",
            email: "ada@example.com",
            emailVerified: true
          }
        })
      )
    );
    expect(verified?.user.email).toBe("ada@example.com");
  });

  test("delegates login and logout to the managed auth surface", async () => {
    const login = await backend().beginLogin({
      request: new Request("https://gkeeper.ai/v1/auth/login"),
      returnTo: "https://gkeeper.ai/home"
    });
    expect(login.redirectTo).toBe(
      "https://gkeeper.ai/_auth/login?returnTo=https%3A%2F%2Fgkeeper.ai%2Fhome"
    );
    expect((await backend().logout(new Request("https://gkeeper.ai"))).redirectTo)
      .toBe("https://gkeeper.ai/_auth/logout");
  });
});

function base64Url(value: string | ArrayBuffer) {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
