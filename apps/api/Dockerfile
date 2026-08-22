# Build stage
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
RUN apk add --no-cache openssl

# Install dependencies
FROM base AS deps
WORKDIR /build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/types/package.json ./packages/types/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

# Build
FROM base AS builder
WORKDIR /build
COPY --from=deps /build/node_modules ./node_modules
COPY --from=deps /build/packages/types/node_modules ./packages/types/node_modules
COPY --from=deps /build/apps/api/node_modules ./apps/api/node_modules
COPY pnpm-workspace.yaml package.json turbo.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# Build types
WORKDIR /build/packages/types
RUN pnpm run build

# Generate Prisma client and build API
WORKDIR /build/apps/api
RUN pnpm run db:generate
RUN pnpm run build

# Production
FROM node:20-alpine AS production
RUN apk add --no-cache openssl curl
WORKDIR /build

COPY --from=builder /build/apps/api/dist /build/apps/api/dist
COPY --from=builder /build/apps/api/package.json /build/apps/api/
COPY --from=builder /build/apps/api/prisma /build/apps/api/prisma
COPY --from=builder /build/node_modules /build/node_modules
COPY --from=builder /build/apps/api/node_modules /build/apps/api/node_modules
COPY --from=builder /build/packages/types /build/packages/types

WORKDIR /build/apps/api

# Apply Prisma migrations against the (Postgres) DATABASE_URL, then start the
# API. `migrate deploy` is idempotent and safe to run on every boot; it falls
# back to `db push` if the migration history isn't usable.
COPY apps/api/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/main"]
