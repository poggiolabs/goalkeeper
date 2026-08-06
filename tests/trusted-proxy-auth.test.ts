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
    issuer: "goalkeeper-cloud",
    audience: "goalkeeper-production",
    loginUrl: "https://gkeeper.ai/_auth/login",
    logoutUrl: "https://gkeeper.ai/_auth/logout",
    now: () => now
  });
}

function assertion(overrides: Partial<TrustedProxyAssertion> = {}) {
  return {
    v: 1,
    iss: "goalkeeper-cloud",
    aud: "goalkeeper-production",
    iat: Math.floor(now.getTime() / 1000),
    method: "GET",
    path: "/v1/auth/session?fresh=1",
    sessionId: "workos:session_01",
    user: {
      id: "workos:user_01",
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
  test("accepts a fresh request-bound signed identity", async () => {
    expect(await backend().getSession(await signedRequest())).toEqual({
      id: "workos:session_01",
      user: {
        id: "workos:user_01",
        displayName: "Ada Lovelace",
        email: "ada@example.com"
      }
    });
  });

  test("rejects tampering, replay on another path, and stale assertions", async () => {
    const tampered = await signedRequest();
    tampered.headers.set(trustedProxyAssertionHeader, base64Url(JSON.stringify(
      assertion({ sessionId: "workos:attacker" })
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
