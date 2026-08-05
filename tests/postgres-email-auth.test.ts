import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { migrateApiDatabase } from "../services/api/src/api-tokens/postgres";
import type {
  EmailDelivery,
  EmailMessage
} from "../services/api/src/auth/email-delivery";
import {
  createPostgresEmailAuthBackend,
  verifyEmailByOperator
} from "../services/api/src/auth/email";
import { AuthError } from "../services/api/src/auth/types";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("PostgreSQL email authentication", () => {
  const schema = `auth_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const delivery = new CapturingEmailDelivery();
  let admin: SQL;
  let database: SQL;
  let auth: ReturnType<typeof createPostgresEmailAuthBackend>;

  beforeAll(async () => {
    admin = new SQL(testDatabaseUrl!);
    await admin.unsafe(`create schema ${schema}`);

    const scopedUrl = new URL(testDatabaseUrl!);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema}`);
    database = new SQL(scopedUrl.toString());
    await migrateApiDatabase(database);
    auth = createPostgresEmailAuthBackend({
      sql: database,
      webOrigin: "http://localhost:3000",
      apiOrigin: "http://localhost:3001",
      emailDelivery: delivery
    });
  });

  afterAll(async () => {
    await database?.close();
    await admin?.unsafe(`drop schema if exists ${schema} cascade`);
    await admin?.close();
  });

  test("persists hashed credentials and enforces verification and revocation", async () => {
    const email = `auth-${crypto.randomUUID()}@example.com`;
    const password = "correct horse battery staple";
    await auth.register({
      email: email.toUpperCase(),
      password,
      displayName: "Database User"
    });

    const [stored] = await database<{
      password_hash: string;
      token_hash: string;
    }[]>`
      select c.password_hash, t.token_hash
      from auth_users u
      join auth_password_credentials c on c.user_id = u.id
      join auth_verification_tokens t on t.user_id = u.id
      where u.email = ${email}
    `;
    expect(stored?.password_hash.startsWith("$argon2id$")).toBe(true);
    expect(stored?.password_hash).not.toContain(password);

    const verificationToken = delivery.latestVerificationToken();
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.token_hash).not.toBe(verificationToken);

    const unverifiedError = await loginError(auth, email, password);
    const unknownError = await loginError(
      auth,
      `missing-${crypto.randomUUID()}@example.com`,
      password
    );
    expect(unverifiedError).toEqual(unknownError);

    const verification = await auth.verifyEmail({
      token: verificationToken,
      returnTo: "http://localhost:3000/"
    });
    expect(verification.redirectTo).toBe("http://localhost:3000/?verified=1");
    await expect(
      auth.verifyEmail({
        token: verificationToken,
        returnTo: "http://localhost:3000/"
      })
    ).rejects.toMatchObject({ code: "invalid_or_expired_token" });

    const login = await auth.login({
      email,
      password,
      returnTo: "http://localhost:3000/account"
    });
    const cookie = new Headers(login.headers).get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");

    const request = new Request("http://localhost:3001/v1/auth/session", {
      headers: { cookie }
    });
    await expect(auth.getSession(request)).resolves.toEqual({
      user: {
        id: expect.any(String),
        email,
        displayName: "Database User"
      }
    });

    await auth.logout(request);
    await expect(auth.getSession(request)).resolves.toBeNull();
  });

  test("rejects expired links and supports explicit operator verification", async () => {
    const email = `expired-${crypto.randomUUID()}@example.com`;
    const password = "correct horse battery staple";
    await auth.register({ email, password, displayName: "Expired User" });
    const verificationToken = delivery.latestVerificationToken();
    await database`
      update auth_verification_tokens
      set
        created_at = now() - interval '2 days',
        expires_at = now() - interval '1 second'
      where token_hash is not null and used_at is null
    `;

    await expect(
      auth.verifyEmail({
        token: verificationToken,
        returnTo: "http://localhost:3000/"
      })
    ).rejects.toMatchObject({ code: "invalid_or_expired_token" });

    await expect(verifyEmailByOperator(database, email)).resolves.toEqual({
      email,
      emailVerified: true
    });
    await expect(
      auth.login({
        email,
        password,
        returnTo: "http://localhost:3000/account"
      })
    ).resolves.toMatchObject({
      redirectTo: "http://localhost:3000/account"
    });
  });
});

class CapturingEmailDelivery implements EmailDelivery {
  readonly messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }

  latestVerificationToken(): string {
    const message = this.messages.at(-1);
    const url = message?.text.match(/https?:\/\/\S+/)?.[0];
    const verificationUrl = url ? new URL(url) : null;
    const token = verificationUrl
      ? new URLSearchParams(verificationUrl.hash.slice(1)).get("token")
      : null;
    if (!token) throw new Error("Verification email did not contain a token");
    if (
      verificationUrl?.origin !== "http://localhost:3000" ||
      verificationUrl.pathname !== "/verify-email" ||
      verificationUrl.search !== ""
    ) {
      throw new Error("Verification email did not contain a safe web link");
    }
    return token;
  }
}

async function loginError(
  auth: ReturnType<typeof createPostgresEmailAuthBackend>,
  email: string,
  password: string
): Promise<{ code: string; message: string; status: number }> {
  try {
    await auth.login({
      email,
      password,
      returnTo: "http://localhost:3000/account"
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { code: error.code, message: error.message, status: error.status };
    }
    throw error;
  }
  throw new Error("Expected login to fail");
}
