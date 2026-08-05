import { apiRoutes } from "./routes";
import { apiTokenScopes } from "./api-tokens/types";

const errorResponse = {
  description: "The request is not authenticated.",
  content: {
    "application/json": {
      schema: { $ref: "#/components/schemas/Error" }
    }
  }
} as const;

const goalSecurity = [{ bearerAuth: [] }, { cookieAuth: [] }] as const;

const goalErrorResponses = {
  "400": {
    description: "The request is invalid.",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Error" } }
    }
  },
  "401": errorResponse,
  "403": {
    description: "The credential lacks the required scope or authority.",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Error" } }
    }
  },
  "404": {
    description: "The resource was not found or is not visible to the caller.",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Error" } }
    }
  },
  "409": {
    description: "The requested state conflicts with an existing resource.",
    content: {
      "application/json": { schema: { $ref: "#/components/schemas/Error" } }
    }
  }
} as const;

export const apiOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Goalkeeper API",
    version: "0.0.0",
    description: "Public REST API."
  },
  servers: [{ url: "http://localhost:3001", description: "Local development" }],
  tags: [
    { name: "System", description: "Service status endpoints." },
    { name: "Authentication", description: "User session lifecycle." },
    {
      name: "Organizations",
      description: "Organization membership and active organization selection."
    },
    {
      name: "API Tokens",
      description: "Scoped credentials owned by an organization and user."
    },
    {
      name: "Goals",
      description: "Organization goals and their label taxonomy."
    }
  ],
  paths: {
    [apiRoutes.health.path]: {
      get: {
        operationId: "getApiHealth",
        summary: "Get REST API health",
        description: "Returns the REST API service status.",
        tags: ["System"],
        responses: {
          "200": {
            description: "REST API status response.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["service", "status"],
                  properties: {
                    service: { type: "string", const: "api" },
                    status: { type: "string", const: "ok" }
                  }
                }
              }
            }
          }
        }
      }
    },
    [apiRoutes.authSession.path]: {
      get: {
        operationId: "getAuthSession",
        summary: "Get the current session",
        description: "Returns the authenticated user for the current session.",
        tags: ["Authentication"],
        responses: {
          "200": {
            description: "The current authenticated session.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthSession" }
              }
            }
          },
          "401": errorResponse
        }
      }
    },
    [apiRoutes.authConfig.path]: {
      get: {
        operationId: "getAuthConfiguration",
        summary: "Get authentication configuration",
        description: "Returns the authentication method configured for this service.",
        tags: ["Authentication"],
        responses: {
          "200": {
            description: "Authentication configuration.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/AuthConfiguration" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.authLogin.path]: {
      get: {
        operationId: "beginAuthLogin",
        summary: "Begin login",
        description: "Starts the configured login flow and redirects the browser.",
        tags: ["Authentication"],
        parameters: [
          {
            name: "returnTo",
            in: "query",
            required: false,
            description: "Same-origin application URL to open after login.",
            schema: { type: "string", format: "uri" }
          }
        ],
        responses: {
          "302": {
            description: "Continue the login flow.",
            headers: {
              Location: {
                description: "The next browser location.",
                schema: { type: "string", format: "uri" }
              }
            }
          }
        }
      },
      post: {
        operationId: "loginWithEmail",
        summary: "Sign in with email",
        description: "Authenticates a verified email principal and starts a session.",
        tags: ["Authentication"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EmailLoginRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "The session started.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthTransitionResponse"
                }
              }
            }
          },
          "400": {
            description: "The request is invalid.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "401": errorResponse,
          "403": {
            description: "The request origin is not allowed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.authRegister.path]: {
      post: {
        operationId: "registerWithEmail",
        summary: "Register with email",
        description: "Creates an email principal and sends a verification link.",
        tags: ["Authentication"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EmailRegistrationRequest" }
            }
          }
        },
        responses: {
          "202": {
            description: "Email verification is required.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EmailRegistrationResponse" }
              }
            }
          },
          "400": {
            description: "The registration request is invalid.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "403": {
            description: "The request origin is not allowed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.authVerifyEmail.path]: {
      post: {
        operationId: "verifyEmail",
        summary: "Verify an email principal",
        description: "Consumes a single-use verification token after explicit browser confirmation.",
        tags: ["Authentication"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EmailVerificationRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "The email principal was verified.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthTransitionResponse"
                }
              }
            }
          },
          "400": {
            description: "The verification token is invalid or expired.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "403": {
            description: "The request origin is not allowed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.authCallback.path]: {
      get: {
        operationId: "completeAuthLogin",
        summary: "Complete login",
        description: "Completes the configured login flow and redirects the browser.",
        tags: ["Authentication"],
        parameters: [
          {
            name: "returnTo",
            in: "query",
            required: false,
            description: "Same-origin application URL to open after login.",
            schema: { type: "string", format: "uri" }
          }
        ],
        responses: {
          "302": {
            description: "Open the authenticated application page.",
            headers: {
              Location: {
                description: "The authenticated application location.",
                schema: { type: "string", format: "uri" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.authLogout.path]: {
      post: {
        operationId: "logoutAuthSession",
        summary: "Log out",
        description: "Ends the current session and returns the next browser location.",
        tags: ["Authentication"],
        responses: {
          "200": {
            description: "The session ended.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/AuthTransitionResponse"
                }
              }
            }
          },
          "403": {
            description: "The request origin is not allowed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.organizationsList.path]: {
      get: {
        operationId: "listOrganizations",
        summary: "List organizations",
        description:
          "Lists the current user's organizations and active organization. Creates the user's first organization when none exists.",
        tags: ["Organizations"],
        responses: {
          "200": {
            description: "Organization membership context.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrganizationContext" }
              }
            }
          },
          "401": errorResponse
        }
      },
      post: {
        operationId: "createOrganization",
        summary: "Create an organization",
        description:
          "Creates an organization owned by the current user and makes it active.",
        tags: ["Organizations"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateOrganizationRequest" }
            }
          }
        },
        responses: {
          "201": {
            description: "The created organization is active.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrganizationContext" }
              }
            }
          },
          "400": {
            description: "The organization request is invalid.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "401": errorResponse,
          "403": {
            description: "The request origin is not allowed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.organizationsSwitch.path]: {
      post: {
        operationId: "switchOrganization",
        summary: "Switch organizations",
        description:
          "Makes one of the current user's organization memberships active.",
        tags: ["Organizations"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SwitchOrganizationRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "The selected organization is active.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrganizationContext" }
              }
            }
          },
          "400": {
            description: "The organization identifier is invalid.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "401": errorResponse,
          "403": {
            description: "The user is not a member or the origin is not allowed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.organizationUpdate.path]: {
      patch: {
        operationId: "updateCurrentOrganization",
        summary: "Update the active organization",
        description:
          "Updates the active organization. The current user must be an owner or administrator.",
        tags: ["Organizations"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateOrganizationRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "The active organization was updated.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/OrganizationContext" }
              }
            }
          },
          "400": {
            description: "The organization request is invalid.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "401": errorResponse,
          "403": {
            description: "Administrator access is required or the origin is not allowed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.organizationMembersList.path]: {
      get: {
        operationId: "listCurrentOrganizationMembers",
        summary: "List active organization members",
        description:
          "Lists the user-to-organization memberships for the active organization.",
        tags: ["Organizations"],
        responses: {
          "200": {
            description: "Active organization members.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ListOrganizationMembersResponse"
                }
              }
            }
          },
          "401": errorResponse,
          "403": {
            description: "Organization membership is required.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.organizationMemberUpdate.path]: {
      patch: {
        operationId: "updateCurrentOrganizationMemberRole",
        summary: "Update an organization member role",
        description:
          "Updates a non-owner membership role. The current user must be an owner or administrator.",
        tags: ["Organizations"],
        parameters: [
          {
            name: "userId",
            in: "path",
            required: true,
            schema: { type: "string", minLength: 1 }
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/UpdateOrganizationMemberRoleRequest"
              }
            }
          }
        },
        responses: {
          "200": {
            description: "The membership role was updated.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/UpdateOrganizationMemberRoleResponse"
                }
              }
            }
          },
          "400": {
            description: "The member or role is invalid.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "401": errorResponse,
          "403": {
            description:
              "Administrator access is required, the owner role is immutable, or the origin is not allowed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.apiTokensList.path]: {
      get: {
        operationId: "listApiTokens",
        summary: "List API tokens",
        description:
          "Lists active, unexpired API tokens for the current user and active organization.",
        tags: ["API Tokens"],
        responses: {
          "200": {
            description: "Active API tokens.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ListApiTokensResponse" }
              }
            }
          },
          "401": errorResponse
        }
      },
      post: {
        operationId: "createApiToken",
        summary: "Create an API token",
        description:
          "Creates a scoped API token in the active organization and returns its secret once.",
        tags: ["API Tokens"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateApiTokenRequest" }
            }
          }
        },
        responses: {
          "201": {
            description: "The token and its one-time secret.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateApiTokenResponse" }
              }
            }
          },
          "400": {
            description: "The token request is invalid.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "401": errorResponse,
          "403": {
            description: "The request origin is not allowed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.apiTokenScopes.path]: {
      get: {
        operationId: "listApiTokenScopes",
        summary: "List API token scopes",
        description: "Returns the canonical API token scope registry.",
        tags: ["API Tokens"],
        responses: {
          "200": {
            description: "Available API token scopes and defaults.",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ListApiTokenScopesResponse"
                }
              }
            }
          }
        }
      }
    },
    [apiRoutes.apiTokenRevoke.path]: {
      delete: {
        operationId: "revokeApiToken",
        summary: "Revoke an API token",
        description:
          "Immediately revokes one of the current user's API tokens in the active organization.",
        tags: ["API Tokens"],
        parameters: [
          {
            name: "tokenId",
            in: "path",
            required: true,
            description: "API token identifier.",
            schema: { type: "string", format: "uuid" }
          }
        ],
        responses: {
          "200": {
            description: "The revoked API token.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RevokeApiTokenResponse" }
              }
            }
          },
          "401": errorResponse,
          "403": {
            description: "The request origin is not allowed.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          },
          "404": {
            description:
              "The API token does not exist for the current user and active organization.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
        }
      }
    },
    [apiRoutes.goalsList.path]: {
      get: {
        operationId: "listGoals",
        summary: "List goals",
        description:
          "Lists goals in the credential's organization, constrained by its own-goals or all-goals scope.",
        tags: ["Goals"],
        security: goalSecurity,
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/GoalStatus" }
          },
          {
            name: "ownerUserId",
            in: "query",
            required: false,
            schema: { type: "string", minLength: 1, maxLength: 200 }
          },
          {
            name: "labelId",
            in: "query",
            required: false,
            schema: { type: "string", format: "uuid" }
          }
        ],
        responses: {
          "200": {
            description: "Goals visible to the caller.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ListGoalsResponse" }
              }
            }
          },
          ...goalErrorResponses
        }
      },
      post: {
        operationId: "createGoal",
        summary: "Create a goal",
        description:
          "Creates an active goal. The owner defaults to the caller and the title defaults to a concise form of the prompt.",
        tags: ["Goals"],
        security: goalSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateGoalRequest" }
            }
          }
        },
        responses: {
          "201": {
            description: "The created goal.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GoalResponse" }
              }
            }
          },
          ...goalErrorResponses
        }
      }
    },
    [apiRoutes.goalGet.path]: {
      get: {
        operationId: "getGoal",
        summary: "Get a goal",
        tags: ["Goals"],
        security: goalSecurity,
        parameters: [
          {
            name: "goalId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" }
          }
        ],
        responses: {
          "200": {
            description: "The goal.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GoalResponse" }
              }
            }
          },
          ...goalErrorResponses
        }
      },
      patch: {
        operationId: "updateGoal",
        summary: "Update a goal",
        tags: ["Goals"],
        security: goalSecurity,
        parameters: [
          {
            name: "goalId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" }
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateGoalRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "The updated goal.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GoalResponse" }
              }
            }
          },
          ...goalErrorResponses
        }
      },
      delete: {
        operationId: "deleteGoal",
        summary: "Delete a goal",
        tags: ["Goals"],
        security: goalSecurity,
        parameters: [
          {
            name: "goalId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" }
          }
        ],
        responses: {
          "204": { description: "The goal was deleted." },
          ...goalErrorResponses
        }
      }
    },
    [apiRoutes.goalLabelsList.path]: {
      get: {
        operationId: "listGoalLabels",
        summary: "List goal labels",
        tags: ["Goals"],
        security: goalSecurity,
        responses: {
          "200": {
            description: "Goal labels in the credential's organization.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ListGoalLabelsResponse" }
              }
            }
          },
          ...goalErrorResponses
        }
      },
      post: {
        operationId: "createGoalLabel",
        summary: "Create a goal label",
        tags: ["Goals"],
        security: goalSecurity,
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CreateGoalLabelRequest" }
            }
          }
        },
        responses: {
          "201": {
            description: "The created goal label.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GoalLabelResponse" }
              }
            }
          },
          ...goalErrorResponses
        }
      }
    },
    [apiRoutes.goalLabelGet.path]: {
      get: {
        operationId: "getGoalLabel",
        summary: "Get a goal label",
        tags: ["Goals"],
        security: goalSecurity,
        parameters: [
          {
            name: "labelId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" }
          }
        ],
        responses: {
          "200": {
            description: "The goal label.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GoalLabelResponse" }
              }
            }
          },
          ...goalErrorResponses
        }
      },
      patch: {
        operationId: "updateGoalLabel",
        summary: "Update a goal label",
        tags: ["Goals"],
        security: goalSecurity,
        parameters: [
          {
            name: "labelId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" }
          }
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UpdateGoalLabelRequest" }
            }
          }
        },
        responses: {
          "200": {
            description: "The updated goal label.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/GoalLabelResponse" }
              }
            }
          },
          ...goalErrorResponses
        }
      },
      delete: {
        operationId: "deleteGoalLabel",
        summary: "Delete an unused goal label",
        tags: ["Goals"],
        security: goalSecurity,
        parameters: [
          {
            name: "labelId",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" }
          }
        ],
        responses: {
          "204": { description: "The goal label was deleted." },
          ...goalErrorResponses
        }
      }
    }
  },
  components: {
    schemas: {
      AuthConfiguration: {
        type: "object",
        additionalProperties: false,
        required: ["method"],
        properties: {
          method: { type: "string", enum: ["redirect", "email"] }
        }
      },
      EmailLoginRequest: {
        type: "object",
        additionalProperties: false,
        required: ["email", "password", "returnTo"],
        properties: {
          email: { type: "string", format: "email", maxLength: 254 },
          password: { type: "string", minLength: 12, maxLength: 512 },
          returnTo: { type: "string", format: "uri" }
        }
      },
      EmailRegistrationRequest: {
        type: "object",
        additionalProperties: false,
        required: ["email", "password", "displayName"],
        properties: {
          email: { type: "string", format: "email", maxLength: 254 },
          password: { type: "string", minLength: 12, maxLength: 512 },
          displayName: { type: "string", minLength: 1, maxLength: 100 }
        }
      },
      EmailRegistrationResponse: {
        type: "object",
        additionalProperties: false,
        required: ["emailVerificationRequired", "email"],
        properties: {
          emailVerificationRequired: { type: "boolean", const: true },
          email: { type: "string", format: "email" }
        }
      },
      EmailVerificationRequest: {
        type: "object",
        additionalProperties: false,
        required: ["token"],
        properties: {
          token: { type: "string", minLength: 1 }
        }
      },
      ApiTokenScope: {
        type: "string",
        enum: apiTokenScopes
      },
      OrganizationRole: {
        type: "string",
        enum: ["owner", "admin", "member"]
      },
      OrganizationSummary: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "role"],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", minLength: 1, maxLength: 100 },
          role: { $ref: "#/components/schemas/OrganizationRole" }
        }
      },
      OrganizationContext: {
        type: "object",
        additionalProperties: false,
        required: ["activeOrganizationId", "organizations"],
        properties: {
          activeOrganizationId: { type: "string", format: "uuid" },
          organizations: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/OrganizationSummary" }
          }
        }
      },
      CreateOrganizationRequest: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 }
        }
      },
      SwitchOrganizationRequest: {
        type: "object",
        additionalProperties: false,
        required: ["organizationId"],
        properties: {
          organizationId: { type: "string", format: "uuid" }
        }
      },
      UpdateOrganizationRequest: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 }
        }
      },
      OrganizationMember: {
        type: "object",
        additionalProperties: false,
        required: ["userId", "displayName", "email", "role"],
        properties: {
          userId: { type: "string", minLength: 1 },
          displayName: { type: "string", minLength: 1 },
          email: { type: ["string", "null"], format: "email" },
          role: { $ref: "#/components/schemas/OrganizationRole" }
        }
      },
      ListOrganizationMembersResponse: {
        type: "object",
        additionalProperties: false,
        required: ["members"],
        properties: {
          members: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/OrganizationMember" }
          }
        }
      },
      UpdateOrganizationMemberRoleRequest: {
        type: "object",
        additionalProperties: false,
        required: ["role"],
        properties: {
          role: { type: "string", enum: ["admin", "member"] }
        }
      },
      UpdateOrganizationMemberRoleResponse: {
        type: "object",
        additionalProperties: false,
        required: ["member"],
        properties: {
          member: { $ref: "#/components/schemas/OrganizationMember" }
        }
      },
      GoalStatus: {
        type: "string",
        enum: ["active", "completed", "paused", "archived"]
      },
      GoalLabel: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "organizationId",
          "name",
          "color",
          "description",
          "createdAt",
          "createdBy",
          "updatedAt",
          "updatedBy"
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          organizationId: { type: "string", format: "uuid" },
          name: { type: "string", minLength: 1, maxLength: 64 },
          color: { type: ["string", "null"], minLength: 1, maxLength: 32 },
          description: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 500
          },
          createdAt: { type: "string", format: "date-time" },
          createdBy: { type: "string", minLength: 1 },
          updatedAt: { type: "string", format: "date-time" },
          updatedBy: { type: "string", minLength: 1 }
        }
      },
      Goal: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "organizationId",
          "title",
          "prompt",
          "status",
          "ownerUserId",
          "labels",
          "measurementMethod",
          "createdAt",
          "createdBy",
          "updatedAt",
          "updatedBy"
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          organizationId: { type: "string", format: "uuid" },
          title: { type: "string", minLength: 1, maxLength: 200 },
          prompt: { type: "string", minLength: 1, maxLength: 50000 },
          status: { $ref: "#/components/schemas/GoalStatus" },
          ownerUserId: { type: "string", minLength: 1, maxLength: 200 },
          labels: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/GoalLabel" }
          },
          measurementMethod: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 10000
          },
          createdAt: { type: "string", format: "date-time" },
          createdBy: { type: "string", minLength: 1 },
          updatedAt: { type: "string", format: "date-time" },
          updatedBy: { type: "string", minLength: 1 }
        }
      },
      GoalResponse: {
        type: "object",
        additionalProperties: false,
        required: ["goal"],
        properties: { goal: { $ref: "#/components/schemas/Goal" } }
      },
      ListGoalsResponse: {
        type: "object",
        additionalProperties: false,
        required: ["goals"],
        properties: {
          goals: {
            type: "array",
            items: { $ref: "#/components/schemas/Goal" }
          }
        }
      },
      CreateGoalRequest: {
        type: "object",
        additionalProperties: false,
        required: ["prompt"],
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          prompt: { type: "string", minLength: 1, maxLength: 50000 },
          ownerUserId: { type: "string", minLength: 1, maxLength: 200 },
          labelIds: {
            type: "array",
            maxItems: 20,
            uniqueItems: true,
            items: { type: "string", format: "uuid" }
          },
          measurementMethod: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 10000
          }
        }
      },
      UpdateGoalRequest: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          title: { type: "string", minLength: 1, maxLength: 200 },
          prompt: { type: "string", minLength: 1, maxLength: 50000 },
          status: { $ref: "#/components/schemas/GoalStatus" },
          ownerUserId: { type: "string", minLength: 1, maxLength: 200 },
          labelIds: {
            type: "array",
            maxItems: 20,
            uniqueItems: true,
            items: { type: "string", format: "uuid" }
          },
          measurementMethod: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 10000
          }
        }
      },
      GoalLabelResponse: {
        type: "object",
        additionalProperties: false,
        required: ["label"],
        properties: { label: { $ref: "#/components/schemas/GoalLabel" } }
      },
      ListGoalLabelsResponse: {
        type: "object",
        additionalProperties: false,
        required: ["labels"],
        properties: {
          labels: {
            type: "array",
            items: { $ref: "#/components/schemas/GoalLabel" }
          }
        }
      },
      CreateGoalLabelRequest: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 64 },
          color: { type: ["string", "null"], minLength: 1, maxLength: 32 },
          description: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 500
          }
        }
      },
      UpdateGoalLabelRequest: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          name: { type: "string", minLength: 1, maxLength: 64 },
          color: { type: ["string", "null"], minLength: 1, maxLength: 32 },
          description: {
            type: ["string", "null"],
            minLength: 1,
            maxLength: 500
          }
        }
      },
      ApiTokenScopeDefinition: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "description", "default"],
        properties: {
          id: { $ref: "#/components/schemas/ApiTokenScope" },
          label: { type: "string" },
          description: { type: "string" },
          default: { type: "boolean" }
        }
      },
      ListApiTokenScopesResponse: {
        type: "object",
        additionalProperties: false,
        required: ["scopes"],
        properties: {
          scopes: {
            type: "array",
            items: { $ref: "#/components/schemas/ApiTokenScopeDefinition" }
          }
        }
      },
      ApiToken: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "name",
          "prefix",
          "scopes",
          "expiresAt",
          "lastUsedAt",
          "revokedAt",
          "createdAt"
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string", minLength: 1, maxLength: 100 },
          prefix: { type: "string" },
          scopes: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { $ref: "#/components/schemas/ApiTokenScope" }
          },
          expiresAt: { type: "string", format: "date-time" },
          lastUsedAt: {
            anyOf: [
              { type: "string", format: "date-time" },
              { type: "null" }
            ]
          },
          revokedAt: {
            anyOf: [
              { type: "string", format: "date-time" },
              { type: "null" }
            ]
          },
          createdAt: { type: "string", format: "date-time" }
        }
      },
      ListApiTokensResponse: {
        type: "object",
        additionalProperties: false,
        required: ["tokens"],
        properties: {
          tokens: {
            type: "array",
            items: { $ref: "#/components/schemas/ApiToken" }
          }
        }
      },
      CreateApiTokenRequest: {
        type: "object",
        additionalProperties: false,
        required: ["name", "scopes"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 100 },
          scopes: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { $ref: "#/components/schemas/ApiTokenScope" }
          },
          expiresInDays: {
            type: "integer",
            minimum: 1,
            maximum: 365,
            default: 90
          }
        }
      },
      CreateApiTokenResponse: {
        type: "object",
        additionalProperties: false,
        required: ["token", "secret"],
        properties: {
          token: { $ref: "#/components/schemas/ApiToken" },
          secret: { type: "string" }
        }
      },
      RevokeApiTokenResponse: {
        type: "object",
        additionalProperties: false,
        required: ["token"],
        properties: {
          token: { $ref: "#/components/schemas/ApiToken" }
        }
      },
      AuthUser: {
        type: "object",
        additionalProperties: false,
        required: ["id", "displayName", "email"],
        properties: {
          id: { type: "string" },
          displayName: { type: "string" },
          email: { type: "string", format: "email" }
        }
      },
      AuthSession: {
        type: "object",
        additionalProperties: false,
        required: ["user", "activeOrganizationId", "organizations"],
        properties: {
          user: { $ref: "#/components/schemas/AuthUser" },
          activeOrganizationId: { type: "string", format: "uuid" },
          organizations: {
            type: "array",
            minItems: 1,
            items: { $ref: "#/components/schemas/OrganizationSummary" }
          }
        }
      },
      AuthTransitionResponse: {
        type: "object",
        additionalProperties: false,
        required: ["redirectTo"],
        properties: {
          redirectTo: { type: "string", format: "uri" }
        }
      },
      Error: {
        type: "object",
        additionalProperties: false,
        required: ["error"],
        properties: {
          error: { type: "string" },
          message: { type: "string" }
        }
      }
    },
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "A Goalkeeper API token or provider-issued OAuth access token."
      },
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "goalkeeper_session"
      }
    }
  }
} as const;
