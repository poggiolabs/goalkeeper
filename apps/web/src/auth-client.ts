export type AuthUser = {
  id: string;
  displayName: string;
  email: string;
};

export type AuthSession = {
  user: AuthUser;
  activeOrganizationId: string;
  organizations: OrganizationSummary[];
};

export type OrganizationSummary = {
  id: string;
  name: string;
  role: OrganizationRole;
};

export type OrganizationRole = "owner" | "admin" | "member";

export type OrganizationMember = {
  userId: string;
  displayName: string;
  email: string | null;
  role: OrganizationRole;
};

export type OrganizationContext = {
  activeOrganizationId: string;
  organizations: OrganizationSummary[];
};

export type AuthConfiguration = {
  method: "redirect" | "email";
};

export type ApiTokenScope = string;

export type ApiTokenScopeDefinition = {
  id: ApiTokenScope;
  label: string;
  description: string;
  default: boolean;
};

export type ApiToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiTokenScope[];
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export class UnauthorizedError extends Error {}

const unauthorizedListeners = new Set<() => void>();

export function subscribeToAuthUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export function loginUrl(apiUrl: string, returnTo: string): string {
  const url = new URL("/v1/auth/login", apiUrl);
  url.searchParams.set("returnTo", returnTo);
  return url.toString();
}

export async function getAuthConfiguration(
  apiUrl: string,
  signal?: AbortSignal
): Promise<AuthConfiguration> {
  const response = await fetch(new URL("/v1/auth/config", apiUrl), { signal });
  if (!response.ok) throw new Error("Unable to load authentication settings.");

  try {
    const configuration = (await response.json()) as Partial<AuthConfiguration>;
    if (
      configuration.method !== "redirect" &&
      configuration.method !== "email"
    ) {
      throw new Error("Invalid authentication configuration");
    }
    return configuration as AuthConfiguration;
  } catch {
    throw new Error("Unable to load authentication settings.");
  }
}

export async function loginWithEmail(
  apiUrl: string,
  input: { email: string; password: string; returnTo: string }
): Promise<string> {
  const response = await fetch(new URL("/v1/auth/login", apiUrl), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  await assertApiResponse(response, "Unable to sign in.", false);
  const result = (await response.json()) as { redirectTo: string };
  return result.redirectTo;
}

export async function verifyEmail(
  apiUrl: string,
  token: string
): Promise<string> {
  const response = await fetch(new URL("/v1/auth/verify-email", apiUrl), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token })
  });
  await assertApiResponse(response, "Unable to verify email.", false);
  const result = (await response.json()) as { redirectTo: string };
  return result.redirectTo;
}

export async function registerWithEmail(
  apiUrl: string,
  input: { email: string; password: string; displayName: string }
): Promise<{ emailVerificationRequired: true; email: string }> {
  const response = await fetch(new URL("/v1/auth/register", apiUrl), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  await assertApiResponse(response, "Unable to create account.");
  return response.json() as Promise<{
    emailVerificationRequired: true;
    email: string;
  }>;
}

export async function getAuthSession(
  apiUrl: string,
  signal?: AbortSignal
): Promise<AuthSession> {
  const response = await fetch(new URL("/v1/auth/session", apiUrl), {
    credentials: "include",
    signal
  });

  if (response.status === 401) {
    throw unauthorizedError();
  }

  if (!response.ok) {
    throw new Error("Unable to load your account.");
  }

  return response.json() as Promise<AuthSession>;
}

export async function logout(apiUrl: string): Promise<string> {
  const response = await fetch(new URL("/v1/auth/logout", apiUrl), {
    method: "POST",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error("Unable to log out.");
  }

  const result = (await response.json()) as { redirectTo: string };
  return result.redirectTo;
}

export async function createOrganization(
  apiUrl: string,
  name: string
): Promise<OrganizationContext> {
  const response = await fetch(new URL("/v1/organizations", apiUrl), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  await assertApiResponse(response, "Unable to create organization.");
  return response.json() as Promise<OrganizationContext>;
}

export async function switchOrganization(
  apiUrl: string,
  organizationId: string
): Promise<OrganizationContext> {
  const response = await fetch(new URL("/v1/organizations/switch", apiUrl), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ organizationId })
  });
  await assertApiResponse(response, "Unable to switch organization.");
  return response.json() as Promise<OrganizationContext>;
}

export async function updateOrganizationName(
  apiUrl: string,
  name: string
): Promise<OrganizationContext> {
  const response = await fetch(new URL("/v1/organizations/current", apiUrl), {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name })
  });
  await assertApiResponse(response, "Unable to update organization.");
  return response.json() as Promise<OrganizationContext>;
}

export async function listOrganizationMembers(
  apiUrl: string,
  signal?: AbortSignal
): Promise<OrganizationMember[]> {
  const response = await fetch(
    new URL("/v1/organizations/current/members", apiUrl),
    { credentials: "include", signal }
  );
  await assertApiResponse(response, "Unable to load organization members.");
  const result = (await response.json()) as { members: OrganizationMember[] };
  return result.members;
}

export async function updateOrganizationMemberRole(
  apiUrl: string,
  userId: string,
  role: Exclude<OrganizationRole, "owner">
): Promise<OrganizationMember> {
  const response = await fetch(
    new URL(
      `/v1/organizations/current/members/${encodeURIComponent(userId)}`,
      apiUrl
    ),
    {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role })
    }
  );
  await assertApiResponse(response, "Unable to update member role.");
  const result = (await response.json()) as { member: OrganizationMember };
  return result.member;
}

export async function listApiTokens(
  apiUrl: string,
  signal?: AbortSignal
): Promise<ApiToken[]> {
  const response = await fetch(new URL("/v1/api-tokens", apiUrl), {
    credentials: "include",
    signal
  });
  await assertApiResponse(response, "Unable to load API tokens.");
  const result = (await response.json()) as { tokens: ApiToken[] };
  return result.tokens;
}

export async function getApiTokenScopes(
  apiUrl: string,
  signal?: AbortSignal
): Promise<ApiTokenScopeDefinition[]> {
  const response = await fetch(new URL("/v1/api-token-scopes", apiUrl), {
    signal
  });
  await assertApiResponse(response, "Unable to load API token scopes.");
  const result = (await response.json()) as {
    scopes: ApiTokenScopeDefinition[];
  };
  return result.scopes;
}

export async function createApiToken(
  apiUrl: string,
  input: {
    name: string;
    scopes: ApiTokenScope[];
    expiresInDays: number;
  }
): Promise<{ token: ApiToken; secret: string }> {
  const response = await fetch(new URL("/v1/api-tokens", apiUrl), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input)
  });
  await assertApiResponse(response, "Unable to create API token.");
  return response.json() as Promise<{ token: ApiToken; secret: string }>;
}

export async function revokeApiToken(
  apiUrl: string,
  tokenId: string
): Promise<void> {
  const response = await fetch(
    new URL(`/v1/api-tokens/${encodeURIComponent(tokenId)}`, apiUrl),
    { method: "DELETE", credentials: "include" }
  );
  await assertApiResponse(response, "Unable to revoke API token.");
}

async function assertApiResponse(
  response: Response,
  fallbackMessage: string,
  sessionRequired = true
): Promise<void> {
  if (sessionRequired && response.status === 401) {
    throw unauthorizedError();
  }
  if (response.ok) return;

  const body = (await response.json().catch(() => null)) as {
    message?: unknown;
  } | null;
  throw new Error(
    typeof body?.message === "string" ? body.message : fallbackMessage
  );
}

function unauthorizedError(): UnauthorizedError {
  for (const listener of unauthorizedListeners) listener();
  return new UnauthorizedError("Authentication is required.");
}
