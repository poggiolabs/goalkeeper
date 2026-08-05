import { apiRoutes } from "./routes";

const host = process.env.API_HOST ?? "0.0.0.0";
const port = Number(process.env.API_PORT ?? 3001);

const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS"
    }
  });

export function handleApiRequest(request: Request): Response {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS"
      }
    });
  }

  const url = new URL(request.url);

  if (
    request.method === apiRoutes.health.method &&
    url.pathname === apiRoutes.health.path
  ) {
    return json({ service: "api", status: "ok" });
  }

  return json({ error: "not_found" }, 404);
}

if (import.meta.main) {
  const server = Bun.serve({
    hostname: host,
    port,
    fetch: handleApiRequest
  });

  console.log(`REST API listening on http://${server.hostname}:${server.port}`);
}
