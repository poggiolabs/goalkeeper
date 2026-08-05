import {
  AuthError,
  type AuthSession,
  type EmailAuthBackend,
  type EmailLogin,
  type EmailRegistration
} from "../../services/api/src/auth/types";

type TestUser = AuthSession["user"] & {
  password: string;
  emailVerified: boolean;
};

export class MemoryEmailAuthBackend implements EmailAuthBackend {
  readonly method = "email";
  readonly users = new Map<string, TestUser>();
  readonly sessions = new Map<string, { id: string; email: string }>();
  readonly verificationTokens = new Map<string, string>();

  constructor(private readonly webOrigin: string) {}

  invalidSessionHeaders(request: Request) {
    return request.headers.get("cookie")?.includes("test_session=")
      ? {
          "set-cookie":
            "test_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
        }
      : undefined;
  }

  addVerifiedUser(input: {
    email: string;
    password: string;
    displayName: string;
  }): TestUser {
    const user = {
      id: crypto.randomUUID(),
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      password: input.password,
      emailVerified: true
    };
    this.users.set(user.email, user);
    return user;
  }

  async getSession(request: Request): Promise<AuthSession | null> {
    const secret = request.headers.get("cookie")?.match(/test_session=([^;]+)/)?.[1];
    const session = secret ? this.sessions.get(secret) : undefined;
    const user = session ? this.users.get(session.email) : undefined;
    return user?.emailVerified
      ? {
          id: session!.id,
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName
          }
        }
      : null;
  }

  async beginLogin(input: { returnTo: string }) {
    return { redirectTo: input.returnTo };
  }

  async completeLogin(input: { returnTo: string }) {
    return { redirectTo: input.returnTo };
  }

  async register(request: EmailRegistration) {
    const email = request.email.trim().toLowerCase();
    const user: TestUser = {
      id: this.users.get(email)?.id ?? crypto.randomUUID(),
      email,
      displayName: request.displayName,
      password: request.password,
      emailVerified: false
    };
    this.users.set(email, user);
    const token = `verification-${crypto.randomUUID()}`;
    this.verificationTokens.set(token, email);
    return { emailVerificationRequired: true as const, email };
  }

  async login(request: EmailLogin) {
    const user = this.users.get(request.email.trim().toLowerCase());
    if (!user || user.password !== request.password || !user.emailVerified) {
      throw new AuthError("invalid_credentials", "Invalid email or password", 401);
    }
    const secret = crypto.randomUUID();
    this.sessions.set(secret, { id: crypto.randomUUID(), email: user.email });
    return {
      redirectTo: request.returnTo,
      headers: {
        "set-cookie": `test_session=${secret}; HttpOnly; Path=/; SameSite=Lax`
      }
    };
  }

  async verifyEmail(input: { token: string; returnTo: string }) {
    const email = this.verificationTokens.get(input.token);
    const user = email ? this.users.get(email) : undefined;
    if (!user) {
      throw new AuthError("invalid_or_expired_token", "Invalid token");
    }
    user.emailVerified = true;
    this.verificationTokens.delete(input.token);
    const redirectTo = new URL(input.returnTo);
    redirectTo.searchParams.set("verified", "1");
    return { redirectTo: redirectTo.toString() };
  }

  async logout(request: Request) {
    const secret = request.headers.get("cookie")?.match(/test_session=([^;]+)/)?.[1];
    if (secret) this.sessions.delete(secret);
    return {
      redirectTo: `${this.webOrigin}/sign-in`,
      headers: {
        "set-cookie": "test_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0"
      }
    };
  }
}
