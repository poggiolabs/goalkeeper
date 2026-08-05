# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.9

FROM oven/bun:${BUN_VERSION}-slim@sha256:8ca06c7812d9050ccc4b80799685f395d6a0d051d3b7207dfd120e2b437b1ec9 AS install
WORKDIR /app

COPY . .
RUN bun install --frozen-lockfile --production --filter @goalkeeper/api

FROM oven/bun:${BUN_VERSION}-slim@sha256:8ca06c7812d9050ccc4b80799685f395d6a0d051d3b7207dfd120e2b437b1ec9 AS runtime

ARG VERSION=0.0.0
ARG REVISION=unknown

LABEL org.opencontainers.image.title="Goalkeeper API" \
      org.opencontainers.image.description="Goal and organization REST API for AI agents" \
      org.opencontainers.image.source="https://github.com/poggiolabs/goalkeeper" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3001

WORKDIR /app
COPY --from=install --chown=bun:bun /app/package.json /app/bun.lock ./
COPY --from=install --chown=bun:bun /app/node_modules ./node_modules
COPY --from=install --chown=bun:bun /app/services/api ./services/api

USER bun
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["bun", "-e", "const response = await fetch('http://127.0.0.1:3001/health'); if (!response.ok) process.exit(1)"]

CMD ["bun", "run", "services/api/src/server.ts"]
