export const apiRoutes = {
  health: {
    method: "GET",
    path: "/health"
  },
  authSession: {
    method: "GET",
    path: "/v1/auth/session"
  },
  authConfig: {
    method: "GET",
    path: "/v1/auth/config"
  },
  authLogin: {
    method: "GET",
    path: "/v1/auth/login"
  },
  authEmailLogin: {
    method: "POST",
    path: "/v1/auth/login"
  },
  authRegister: {
    method: "POST",
    path: "/v1/auth/register"
  },
  authVerifyEmail: {
    method: "POST",
    path: "/v1/auth/verify-email"
  },
  authCallback: {
    method: "GET",
    path: "/v1/auth/callback"
  },
  authLogout: {
    method: "POST",
    path: "/v1/auth/logout"
  },
  organizationsList: {
    method: "GET",
    path: "/v1/organizations"
  },
  organizationsCreate: {
    method: "POST",
    path: "/v1/organizations"
  },
  organizationsSwitch: {
    method: "POST",
    path: "/v1/organizations/switch"
  },
  organizationUpdate: {
    method: "PATCH",
    path: "/v1/organizations/current"
  },
  organizationMembersList: {
    method: "GET",
    path: "/v1/organizations/current/members"
  },
  organizationMemberUpdate: {
    method: "PATCH",
    path: "/v1/organizations/current/members/{userId}"
  },
  apiTokensList: {
    method: "GET",
    path: "/v1/api-tokens"
  },
  apiTokenScopes: {
    method: "GET",
    path: "/v1/api-token-scopes"
  },
  apiTokensCreate: {
    method: "POST",
    path: "/v1/api-tokens"
  },
  apiTokenRevoke: {
    method: "DELETE",
    path: "/v1/api-tokens/{tokenId}"
  }
} as const;
