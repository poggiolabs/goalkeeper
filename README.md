# Goalkeeper

Team goals for AI agents

## Repository layout

- `apps/web` — React web application built with Vite.
- `services/api` — REST service running on Bun.
- `services/mcp` — stateless Streamable HTTP MCP service.
- `services/docs` — documentation site built with Fumadocs and Next.js.
- `docker-compose.yml` — local PostgreSQL 17 instance.

## Requirements

- [Bun](https://bun.sh/) 1.3 or newer
- Docker with Compose

## Start locally

Install dependencies, copy the local environment, and start every service:

```sh
bun install
cp .env.example .env
bun run dev
```

The services are available at:

- Web: <http://localhost:3000>
- REST API: <http://localhost:3001>
- MCP: <http://127.0.0.1:3002/mcp>
- Docs: <http://localhost:3003>
- PostgreSQL: `localhost:5432`

Stop the application processes with `Ctrl-C`. PostgreSQL remains available until
you run:

```sh
bun run db:down
```

## Commands

```sh
bun run dev          # PostgreSQL and all application services
bun run web:dev      # web application only
bun run api:dev      # REST API only
bun run mcp:dev      # MCP service only
bun run docs:dev     # docs site only
bun run api:specs    # generate OpenAPI documents
bun run docs:generate # generate API docs and Fumadocs sources
bun run open:web     # open the web application
bun run db:up        # start PostgreSQL
bun run db:migrate   # apply API database migrations
bun run auth:verify-email -- user@example.com # verify a local email principal
bun run db:down      # stop PostgreSQL
bun run db:logs      # follow PostgreSQL logs
bun run typecheck    # type-check every package
bun run test         # run the test suite
bun run build        # create production builds
bun run check        # type-check, test, and build
```

The API service publishes a generated OpenAPI document consumed by the
documentation site.

## Authentication

Open <http://localhost:3000> to exercise the local authentication flow.
Local development uses the built-in PostgreSQL email provider. Register from
`/sign-in`, then open and confirm the verification link logged by the API or run
`bun run auth:verify-email -- user@example.com`.

Self-hosted operators can replace the built-in implementation by supplying an
`AuthBackend` to `createApiHandler`. The browser continues to use the canonical
`/v1/auth/*` routes and receives only the application's `id`, `displayName`, and
`email` fields. Provider-specific claims and SDK types remain behind that
interface.

The authenticated app opens at `/home`. API tokens are managed at
`/settings/api-tokens`, while logout is available from the account menu in the
sidebar. The first authenticated session creates
an organization named after the user; the same menu creates and switches
organizations. API tokens belong to the active organization. Token secrets are
returned once, stored only as SHA-256 hashes, expire after a bounded lifetime,
and can be revoked immediately. Available scopes distinguish access to the
token owner's goals from access to all goals: `goals:read`, `goals:write`,
`goals:read:all`, and `goals:write:all`.

Organization owners and administrators can rename the active organization at
`/settings/organization` and manage existing member roles at `/settings/team`.
Memberships model the N:M relationship between users and organizations;
invitations are not implemented yet.

## License

Licensed under the [Apache License 2.0](LICENSE).
