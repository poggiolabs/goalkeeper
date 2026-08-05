import { apiRoutes } from "./routes";

export const apiOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Goalkeeper API",
    version: "0.0.0",
    description: "Public REST API."
  },
  servers: [{ url: "http://localhost:3001", description: "Local development" }],
  tags: [{ name: "System", description: "Service status endpoints." }],
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
    }
  }
} as const;
