# syntax=docker/dockerfile:1
# Production image of the National Industrial Initiatives Platform (the platform + every initiative module: Shams El-Senaa,
# Sona'a El-Mostaqbal). The backend serves the built frontend on the same origin (no CORS, one domain); TLS ends at the
# reverse proxy in front of the container (e.g. Coolify's). Database: MySQL 8.4 only (the mysql service of docker-compose.yml).
#
# Build context: the repository root (the Shams module frontend imports its API contract types from the backend tree).
# No secret is used at build time or stored in a layer: every secret is a runtime environment variable.

ARG NODE_IMAGE=node:22.23.4-alpine3.23

# ── 1) frontend build (same origin: the API is /api/v1 on the serving host) ──
FROM ${NODE_IMAGE} AS web
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
# frontend/src/initiatives/shams/api/schemas.ts re-exports backend/src/initiatives/shams/contracts/api.contracts
COPY backend/src/initiatives/shams/contracts /build/backend/src/initiatives/shams/contracts
RUN npm run build

# ── 2) backend build (tsc + SQL migrations into dist), then production-only dependencies ──
FROM ${NODE_IMAGE} AS api
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/scripts ./scripts
RUN npm run build && npm prune --omit=dev --no-audit --no-fund && npm cache clean --force

# ── 3) runtime ──
FROM ${NODE_IMAGE} AS runtime
# tini: PID 1 that forwards SIGTERM to Node and reaps zombies (graceful shutdown on redeploy).
RUN apk add --no-cache tini
WORKDIR /app
# SEED_ON_DEPLOY=1: one account for every role is created on the first start (any missing one on later starts).
# SECRETS_DIR: JWT_SECRET is generated there once when the environment does not provide it.
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0 \
    UPLOAD_DIR=/data/uploads \
    SECRETS_DIR=/data/secrets \
    SEED_ON_DEPLOY=1 \
    SEED_ON_BOOT=0 \
    SERVE_FRONTEND=1 \
    FRONTEND_DIST=/app/public \
    TRUST_PROXY=1 \
    REGISTRY_ADAPTER=manual
COPY backend/package.json ./
COPY --from=api /app/node_modules ./node_modules
COPY --from=api /app/dist ./dist
COPY --from=api /app/scripts ./scripts
# logos embedded in the official e-mails (cid:platform-logo, cid:sona3-logo)
COPY backend/assets ./assets
COPY --from=web /build/frontend/dist ./public
# /data = persistent volume: uploaded documents of the platform (core/) and of every module (shams/, sona3/), and the
# secrets the platform generates on its first start (/data/secrets, readable by the app user only).
RUN mkdir -p /data/uploads /data/secrets && chmod 700 /data/secrets && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
STOPSIGNAL SIGTERM
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
