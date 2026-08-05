import { describe, expect, test } from "bun:test";
import { apiRoutes } from "../services/api/src/routes";
import { handleApiRequest } from "../services/api/src/server";
import { apiOpenApiDocument } from "../services/api/src/spec";
import { authRoutes } from "../services/auth/src/routes";
import { handleAuthRequest } from "../services/auth/src/server";
import { authOpenApiDocument } from "../services/auth/src/spec";

describe("REST API contract", () => {
  test("serves the documented health route", async () => {
    const response = handleApiRequest(
      new Request(`http://localhost${apiRoutes.health.path}`)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "api", status: "ok" });
    expect(apiOpenApiDocument.paths[apiRoutes.health.path].get).toBeDefined();
  });

  test("returns 404 for an unknown route", async () => {
    const response = handleApiRequest(
      new Request("http://localhost/v1/unknown")
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  test("handles CORS preflight", () => {
    const response = handleApiRequest(
      new Request("http://localhost/health", { method: "OPTIONS" })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET, OPTIONS"
    );
  });
});

describe("auth API contract", () => {
  test("serves the documented health route", async () => {
    const response = handleAuthRequest(
      new Request(`http://localhost${authRoutes.health.path}`)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "auth", status: "ok" });
    expect(authOpenApiDocument.paths[authRoutes.health.path].get).toBeDefined();
  });

  test("does not expose an undefined session route", async () => {
    const response = handleAuthRequest(
      new Request("http://localhost/v1/session", { method: "POST" })
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});
