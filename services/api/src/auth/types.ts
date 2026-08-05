export type AuthUser = {
  id: string;
  displayName: string;
  email: string;
};

export type AuthSession = {
  user: AuthUser;
};

export type AuthTransition = {
  redirectTo: string;
  headers?: HeadersInit;
};

export type AuthTransitionInput = {
  request: Request;
  returnTo: string;
};

export interface AuthBackend {
  readonly method: "redirect" | "email";
  /**
   * Returns only a fully verified canonical session. Implementations that
   * accept JWTs must validate signature, algorithm, key ID, issuer, audience,
   * and expiry before returning.
   */
  getSession(request: Request): Promise<AuthSession | null>;
  beginLogin(input: AuthTransitionInput): Promise<AuthTransition>;
  completeLogin(input: AuthTransitionInput): Promise<AuthTransition>;
  logout(request: Request): Promise<AuthTransition>;
  invalidSessionHeaders?(request: Request): HeadersInit | undefined;
}

export type EmailRegistration = {
  email: string;
  password: string;
  displayName: string;
};

export type EmailLogin = {
  email: string;
  password: string;
  returnTo: string;
};

export interface EmailAuthBackend extends AuthBackend {
  readonly method: "email";
  register(request: EmailRegistration): Promise<{
    emailVerificationRequired: true;
    email: string;
  }>;
  login(request: EmailLogin): Promise<AuthTransition>;
  verifyEmail(input: {
    token: string;
    returnTo: string;
  }): Promise<AuthTransition>;
}

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function isEmailAuthBackend(
  backend: AuthBackend
): backend is EmailAuthBackend {
  return backend.method === "email";
}
