# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json ./packages/server/

# Install all deps (needed for build)
RUN pnpm install --frozen-lockfile --filter @hum/server...

# Copy source and build
COPY packages/server ./packages/server
COPY tsconfig.base.json ./
RUN pnpm --filter @hum/server build

# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy workspace manifests for prod install
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/server/package.json ./packages/server/

# Install production deps only
RUN pnpm install --frozen-lockfile --filter @hum/server --prod

# Copy compiled output and migration folders
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/drizzle ./packages/server/drizzle
COPY --from=builder /app/packages/server/drizzle.pg ./packages/server/drizzle.pg

# Data directory for SQLite DB
RUN mkdir -p /data

ENV NODE_ENV=production
ENV PORT=3001
ENV DB_PATH=/data/hum.db

EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
