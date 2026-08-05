import { afterEach, describe, expect, test } from "bun:test";
import { loginWithEmail } from "../apps/web/src/auth-client";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("web authentication client", () => {
  test("preserves invalid-credential messages from email login", async () => {
    globalThis.fetch = async () =>
      Response.json(
        {
          error: "invalid_credentials",
          message: "Invalid email or password"
        },
        { status: 401 }
      );

    await expect(
      loginWithEmail("http://localhost:3001", {
        email: "user@example.com",
        password: "incorrect password",
        returnTo: "http://localhost:3000/account"
      })
    ).rejects.toThrow("Invalid email or password");
  });
});
