import type { SQL } from "bun";
import { hashToken } from "../api-tokens/service";
import type { EmailDelivery } from "./email-delivery";
import {
  AuthError,
  type AuthSession,
  type AuthTransitionInput,
  type EmailAuthBackend,
  type EmailLogin,
  type EmailRegistration
} from "./types";

const cookieName = "goalkeeper_session";
const sessionTtlMs = 30 * 86_400_000;
const verificationTtlMs = 24 * 60 * 60_000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UserRow = {
  id: string;
  email: string;
  display_name: string;
  email_verified: boolean;
  password_hash: string;
};

export function createPostgresEmailAuthBackend(options: {
  sql: SQL;
  webOrigin: string;
  apiOrigin: string;
  emailDelivery: EmailDelivery;
}): EmailAuthBackend {
  const secureCookie = new URL(options.apiOrigin).protocol === "https:";
  const dummyPasswordHash = Bun.password.hash(randomSecret(), passwordOptions);

  return {
    method: "email",

    async getSession(request) {
      const secret = cookieValue(request.headers.get("cookie"), cookieName);
      if (!secret) return null;
      const tokenHash = await hashToken(secret);
      const [row] = await options.sql<UserRow[]>`
        select
          u.id,
          u.email,
          u.display_name,
          u.email_verified,
          c.password_hash
        from auth_sessions s
        join auth_users u on u.id = s.user_id
        join auth_password_credentials c on c.user_id = u.id
        where s.token_hash = ${tokenHash}
          and s.revoked_at is null
          and s.expires_at > now()
          and u.email_verified = true
        limit 1
      `;
      if (!row) return null;

      await options.sql`
        update auth_sessions
        set last_used_at = now()
        where token_hash = ${tokenHash}
          and last_used_at < now() - interval '5 minutes'
      `;
      return toSession(row);
    },

    async beginLogin(input: AuthTransitionInput) {
      return { redirectTo: input.returnTo };
    },

    async completeLogin(input: AuthTransitionInput) {
      return { redirectTo: input.returnTo };
    },

    async register(request: EmailRegistration) {
      const body = normalizeRegistration(request);
      const passwordHash = await Bun.password.hash(body.password, passwordOptions);
      const verificationSecret = randomSecret();
      const verificationHash = await hashToken(verificationSecret);
      const now = new Date();

      const result = await options.sql.begin(async (transaction) => {
        await transaction`
          select pg_advisory_xact_lock(hashtext(${body.email}))
        `;
        const [existing] = await transaction<UserRow[]>`
          select
            u.id,
            u.email,
            u.display_name,
            u.email_verified,
            c.password_hash
          from auth_users u
          left join auth_password_credentials c on c.user_id = u.id
          where u.email = ${body.email}
          for update of u
        `;

        if (existing?.email_verified) {
          return { kind: "existing" as const, email: existing.email };
        }

        let userId: string;
        if (existing) {
          userId = existing.id;
          await transaction`
            update auth_users
            set display_name = ${body.displayName}, updated_at = ${now}
            where id = ${userId}::uuid
          `;
          await transaction`
            insert into auth_password_credentials (user_id, password_hash, created_at, updated_at)
            values (${userId}::uuid, ${passwordHash}, ${now}, ${now})
            on conflict (user_id) do update
            set password_hash = excluded.password_hash, updated_at = excluded.updated_at
          `;
          await transaction`
            update auth_sessions set revoked_at = ${now}
            where user_id = ${userId}::uuid and revoked_at is null
          `;
        } else {
          const [created] = await transaction<{ id: string }[]>`
            insert into auth_users (email, display_name, email_verified, created_at, updated_at)
            values (${body.email}, ${body.displayName}, false, ${now}, ${now})
            returning id
          `;
          if (!created) throw new Error("User insert did not return a record");
          userId = created.id;
          await transaction`
            insert into auth_password_credentials (user_id, password_hash, created_at, updated_at)
            values (${userId}::uuid, ${passwordHash}, ${now}, ${now})
          `;
        }

        await transaction`
          update auth_verification_tokens set used_at = ${now}
          where user_id = ${userId}::uuid and used_at is null
        `;
        await transaction`
          insert into auth_verification_tokens (
            user_id, token_hash, expires_at, created_at
          ) values (
            ${userId}::uuid,
            ${verificationHash},
            ${new Date(now.getTime() + verificationTtlMs)},
            ${now}
          )
        `;
        return { kind: "verify" as const, email: body.email };
      });

      if (result.kind === "verify") {
        const verificationUrl = new URL("/v1/auth/verify-email", options.apiOrigin);
        verificationUrl.searchParams.set("token", verificationSecret);
        await options.emailDelivery.send({
          to: result.email,
          subject: "Verify your Goalkeeper email",
          text: `Verify your email address: ${verificationUrl}`
        });
      } else {
        await options.emailDelivery.send({
          to: result.email,
          subject: "Your Goalkeeper account",
          text: `An account already exists for this email. Sign in at ${options.webOrigin}`
        });
      }

      return {
        emailVerificationRequired: true as const,
        email: body.email
      };
    },

    async login(request: EmailLogin) {
      const body = normalizeLogin(request);
      const [user] = await options.sql<UserRow[]>`
        select
          u.id,
          u.email,
          u.display_name,
          u.email_verified,
          c.password_hash
        from auth_users u
        join auth_password_credentials c on c.user_id = u.id
        where u.email = ${body.email}
        limit 1
      `;
      const passwordMatches = await Bun.password.verify(
        body.password,
        user?.password_hash ?? (await dummyPasswordHash)
      );
      if (!user || !passwordMatches || !user.email_verified) {
        throw new AuthError(
          "invalid_credentials",
          "Invalid email or password. If you recently signed up, verify your email or register again to resend the link.",
          401
        );
      }

      const secret = randomSecret();
      const now = new Date();
      await options.sql`
        insert into auth_sessions (
          user_id, token_hash, expires_at, last_used_at, created_at
        ) values (
          ${user.id}::uuid,
          ${await hashToken(secret)},
          ${new Date(now.getTime() + sessionTtlMs)},
          ${now},
          ${now}
        )
      `;
      return {
        redirectTo: request.returnTo,
        headers: {
          "set-cookie": sessionCookie(secret, secureCookie, sessionTtlMs)
        }
      };
    },

    async verifyEmail(input) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(input.token)) {
        throw invalidVerificationToken();
      }
      const tokenHash = await hashToken(input.token);
      const now = new Date();
      await options.sql.begin(async (transaction) => {
        const [row] = await transaction<{
          id: string;
          user_id: string;
          expires_at: Date | string;
          used_at: Date | string | null;
        }[]>`
          select id, user_id, expires_at, used_at
          from auth_verification_tokens
          where token_hash = ${tokenHash}
          for update
        `;
        if (!row || row.used_at || new Date(row.expires_at) <= now) {
          throw invalidVerificationToken();
        }
        await transaction`
          update auth_verification_tokens set used_at = ${now}
          where user_id = ${row.user_id}::uuid and used_at is null
        `;
        await transaction`
          update auth_users set email_verified = true, updated_at = ${now}
          where id = ${row.user_id}::uuid
        `;
      });
      const redirectTo = new URL(input.returnTo);
      redirectTo.searchParams.set("verified", "1");
      return {
        redirectTo: redirectTo.toString(),
        headers: {
          "cache-control": "no-store",
          "referrer-policy": "no-referrer"
        }
      };
    },

    async logout(request) {
      const secret = cookieValue(request.headers.get("cookie"), cookieName);
      if (secret) {
        await options.sql`
          update auth_sessions set revoked_at = now()
          where token_hash = ${await hashToken(secret)} and revoked_at is null
        `;
      }
      return {
        redirectTo: new URL("/", options.webOrigin).toString(),
        headers: {
          "set-cookie": clearSessionCookie(secureCookie)
        }
      };
    }
  };
}

export async function verifyEmailByOperator(sql: SQL, email: string) {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();
  return sql.begin(async (transaction) => {
    const [user] = await transaction<{ id: string; email: string }[]>`
      update auth_users
      set email_verified = true, updated_at = ${now}
      where email = ${normalizedEmail}
      returning id, email
    `;
    if (!user) {
      throw new AuthError(
        "user_not_found",
        "No user exists for this email",
        404
      );
    }
    await transaction`
      update auth_verification_tokens set used_at = ${now}
      where user_id = ${user.id}::uuid and used_at is null
    `;
    return { email: user.email, emailVerified: true as const };
  });
}

const passwordOptions = {
  algorithm: "argon2id" as const,
  memoryCost: 64 * 1024,
  timeCost: 2
};

function normalizeRegistration(request: EmailRegistration) {
  const email = normalizeEmail(request.email);
  const displayName = request.displayName?.trim();
  if (!displayName || displayName.length > 100) {
    throw new AuthError(
      "invalid_display_name",
      "Display name must contain 1-100 characters"
    );
  }
  return { email, displayName, password: normalizePassword(request.password) };
}

function normalizeLogin(request: EmailLogin) {
  return {
    email: normalizeEmail(request.email),
    password: normalizePassword(request.password)
  };
}

function normalizeEmail(value: string): string {
  const email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !emailPattern.test(email)) {
    throw new AuthError("invalid_email", "A valid email is required");
  }
  return email;
}

function normalizePassword(value: string): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 512) {
    throw new AuthError("invalid_password", "Password must contain 12-512 characters");
  }
  return value;
}

function toSession(row: UserRow): AuthSession {
  return {
    user: { id: row.id, email: row.email, displayName: row.display_name }
  };
}

function randomSecret(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function cookieValue(header: string | null, name: string): string | null {
  const prefix = `${name}=`;
  const value = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return value?.slice(prefix.length) ?? null;
}

function sessionCookie(secret: string, secure: boolean, ttlMs: number): string {
  return `${cookieName}=${secret}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(ttlMs / 1000)}${secure ? "; Secure" : ""}`;
}

function clearSessionCookie(secure: boolean): string {
  return `${cookieName}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

function invalidVerificationToken(): AuthError {
  return new AuthError(
    "invalid_or_expired_token",
    "Verification link is invalid or expired",
    400
  );
}
