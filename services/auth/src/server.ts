import { authRoutes } from "./routes";

const host = process.env.AUTH_HOST ?? "0.0.0.0";
const port = Number(process.env.AUTH_PORT ?? 3002);

export function handleAuthRequest(request: Request): Response {
  const url = new URL(request.url);

  if (
    request.method === authRoutes.health.method &&
    url.pathname === authRoutes.health.path
  ) {
    return Response.json({ service: "auth", status: "ok" });
  }

  return Response.json({ error: "not_found" }, { status: 404 });
}

if (import.meta.main) {
  const server = Bun.serve({
    hostname: host,
    port,
    fetch: handleAuthRequest
  });

  console.log(`Auth service listening on http://${server.hostname}:${server.port}`);
}
