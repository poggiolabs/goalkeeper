# syntax=docker/dockerfile:1.7

ARG BUN_VERSION=1.3.9
ARG VERSION=0.0.0
ARG REVISION=unknown

FROM oven/bun:${BUN_VERSION}-slim@sha256:8ca06c7812d9050ccc4b80799685f395d6a0d051d3b7207dfd120e2b437b1ec9 AS build
WORKDIR /app
ARG VERSION
ARG REVISION

COPY . .
RUN bun install --frozen-lockfile --filter @goalkeeper/web
RUN bun scripts/web-distribution.ts build "$VERSION" "$REVISION"

FROM nginxinc/nginx-unprivileged:1.30.3-alpine@sha256:b3f2436575bd5be7386518084d842dac414ab4962712afa31e99e0942a56e3b2 AS runtime

ARG VERSION=0.0.0
ARG REVISION=unknown

LABEL org.opencontainers.image.title="Goalkeeper Web" \
      org.opencontainers.image.description="Browser application for Goalkeeper" \
      org.opencontainers.image.source="https://github.com/poggiolabs/goalkeeper" \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV GOALKEEPER_API_URL= \
    GOALKEEPER_DOCS_URL= \
    GOALKEEPER_MCP_URL=

COPY --from=build --chown=101:101 /app/apps/web/dist /usr/share/nginx/html
COPY containers/web/default.conf.template /etc/nginx/templates/default.conf.template
COPY --chmod=755 containers/web/05-goalkeeper-runtime-config.sh /docker-entrypoint.d/05-goalkeeper-runtime-config.sh

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
