import { authRoutes } from "./routes";

export const authOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Goalkeeper Auth API",
    version: "0.0.0",
    description: "Authentication service API."
  },
  servers: [{ url: "http://localhost:3002", description: "Local development" }],
  tags: [{ name: "System", description: "Service status endpoints." }],
  paths: {
    [authRoutes.health.path]: {
      get: {
        operationId: "getAuthHealth",
        summary: "Get auth service health",
        description: "Returns the auth service status.",
        tags: ["System"],
        responses: {
          "200": {
            description: "Auth service status response.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  additionalProperties: false,
                  required: ["service", "status"],
                  properties: {
                    service: { type: "string", const: "auth" },
                    status: { type: "string", const: "ok" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
} as const;
