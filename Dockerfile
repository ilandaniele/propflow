FROM node:22-alpine AS base

FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate && pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_META_APP_ID
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
ENV NEXT_PUBLIC_META_APP_ID=${NEXT_PUBLIC_META_APP_ID}
# Skip DB connection during build
ENV NEXT_PHASE=phase-production-build
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate && pnpm run build
# Standalone migration runner deps (postgres.js has no dependencies); -L resolves pnpm symlinks
RUN mkdir -p /migrate/node_modules && cp -rL node_modules/postgres /migrate/node_modules/postgres

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# SQL migrations + runner, executed by fly.toml [deploy] release_command
COPY --from=builder --chown=nextjs:nodejs /app/src/lib/db/migrations ./src/lib/db/migrations
COPY --from=builder --chown=nextjs:nodejs /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --from=builder --chown=nextjs:nodejs /migrate/node_modules ./scripts/node_modules
USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]
