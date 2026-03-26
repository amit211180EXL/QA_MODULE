FROM node:20-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

# ─── Dependencies ───────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/api/package.json ./apps/api/
COPY packages/config/package.json ./packages/config/
COPY packages/shared/package.json ./packages/shared/
COPY packages/prisma-master/package.json ./packages/prisma-master/
COPY packages/prisma-tenant/package.json ./packages/prisma-tenant/
RUN pnpm install --frozen-lockfile

# ─── Build ──────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN pnpm --filter @qa/config build
RUN pnpm --filter @qa/shared build
RUN pnpm --filter @qa/prisma-master db:generate
RUN pnpm --filter @qa/prisma-tenant db:generate
RUN pnpm --filter @qa/prisma-master build
RUN pnpm --filter @qa/prisma-tenant build
RUN pnpm --filter api build

# ─── Production image ────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app
RUN npm install -g pnpm
ENV NODE_ENV=production

COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages ./packages

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nestjs
USER nestjs

EXPOSE 3000
CMD ["node", "apps/api/dist/main.js"]
