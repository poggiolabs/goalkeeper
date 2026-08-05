import { describe, expect, test } from "bun:test";
import { apiRoutes } from "../services/api/src/routes";
import { handleApiRequest } from "../services/api/src/server";
import { apiOpenApiDocument } from "../services/api/src/spec";

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
