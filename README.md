# Goalkeeper

Team goals for AI agents

## Workspace

- `apps/web` — React web application built with Vite.
- `services/api` — REST service running on Bun.
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
bun run docs:dev     # docs site only
bun run api:specs    # generate OpenAPI documents
bun run docs:generate # generate API docs and Fumadocs sources
bun run open:web     # open the web application
bun run db:up        # start PostgreSQL
bun run db:down      # stop PostgreSQL
bun run db:logs      # follow PostgreSQL logs
bun run typecheck    # type-check every workspace
bun run test         # run the test suite
bun run build        # create production builds
bun run check        # type-check, test, and build
```

The API service publishes a generated OpenAPI document consumed by the
documentation site.

## License

Licensed under the [Apache License 2.0](LICENSE).
