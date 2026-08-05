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
      name: "API Tokens",
      description: "Scoped credentials owned by an authenticated user."
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
    [apiRoutes.apiTokensList.path]: {
      get: {
        operationId: "listApiTokens",
        summary: "List API tokens",
        description: "Lists the current user's active, unexpired API tokens.",
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
        description: "Creates a scoped API token and returns its secret once.",
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
        description: "Immediately revokes one of the current user's API tokens.",
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
            description: "The API token does not exist for the current user.",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Error" }
              }
            }
          }
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
        required: ["user"],
        properties: {
          user: { $ref: "#/components/schemas/AuthUser" }
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
    }
  }
} as const;
