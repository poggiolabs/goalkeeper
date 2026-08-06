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
  },
  goalsList: {
    method: "GET",
    path: "/v1/goals"
  },
  goalsCreate: {
    method: "POST",
    path: "/v1/goals"
  },
  goalGet: {
    method: "GET",
    path: "/v1/goals/{goalId}"
  },
  goalUpdate: {
    method: "PATCH",
    path: "/v1/goals/{goalId}"
  },
  goalDelete: {
    method: "DELETE",
    path: "/v1/goals/{goalId}"
  },
  goalUpdatesList: {
    method: "GET",
    path: "/v1/goals/{goalId}/updates"
  },
  goalUpdatesCreate: {
    method: "POST",
    path: "/v1/goals/{goalId}/updates"
  },
  goalLabelsList: {
    method: "GET",
    path: "/v1/goal-labels"
  },
  goalLabelsCreate: {
    method: "POST",
    path: "/v1/goal-labels"
  },
  goalLabelGet: {
    method: "GET",
    path: "/v1/goal-labels/{labelId}"
  },
  goalLabelUpdate: {
    method: "PATCH",
    path: "/v1/goal-labels/{labelId}"
  },
  goalLabelDelete: {
    method: "DELETE",
    path: "/v1/goal-labels/{labelId}"
  }
} as const;
