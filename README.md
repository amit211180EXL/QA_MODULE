# QA Platform — Monorepo

Multi-tenant SaaS QA evaluation platform.

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 9 (`npm install -g pnpm`)
- Docker + Docker Compose

## Workspace Structure

```
apps/
  api/          — NestJS API server
packages/
  config/       — Zod-validated env loader
  shared/       — Shared TypeScript types, enums, constants
  prisma-master/ — Master DB Prisma schema + client
  prisma-tenant/ — Tenant DB Prisma schema + client
```

## Local Development

### 1. Start infrastructure

```bash
docker compose up postgres-master postgres-tenant redis -d
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — set JWT_SECRET, REFRESH_SECRET, MASTER_ENCRYPTION_KEY
# Generate encryption key:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 3. Install dependencies

```bash
pnpm install
```

### 4. Generate Prisma clients

```bash
pnpm --filter @qa/prisma-master db:generate
pnpm --filter @qa/prisma-tenant db:generate
```

### 5. Run master DB migration

```bash
pnpm --filter @qa/prisma-master migrate:dev
```

### 6. Seed master DB (dev data)

```bash
pnpm --filter @qa/prisma-master db:seed
```

### 7. Start API

```bash
pnpm --filter api dev
```

API: http://localhost:3000  
Swagger: http://localhost:3000/api/docs

## Testing

```bash
# Unit tests
pnpm test

# E2E tests (requires running DB + Redis)
pnpm test:e2e
```

## Environment Variables

See [.env.example](.env.example) for all required variables.

Critical variables:
- `MASTER_ENCRYPTION_KEY` — 64 hex chars (32 bytes). **Never rotate without a migration plan.**
- `JWT_SECRET` / `REFRESH_SECRET` — min 32 chars. Rotation invalidates all active sessions.
- `TENANT_DB_SUPERUSER` — PostgreSQL superuser for creating tenant databases.

## Database Architecture

- **Master DB** (`postgres-master:5432`) — tenants, users, billing, LLM configs
- **Tenant DB** (`postgres-tenant:5433`) — per-tenant: conversations, forms, evaluations, audit logs

Tenant DB connections are lazily pooled per-request using `TenantConnectionPool`.

## Move To Another Server (DB Quick Setup)

Use the bootstrap SQL file to provision the required PostgreSQL roles/database on a fresh server:

```bash
psql -U postgres -d postgres -f db-server-bootstrap.sql
```

Then run Prisma migrations on the new server:

```bash
pnpm install
pnpm db:generate
pnpm db:migrate:deploy:all
pnpm db:seed
```

Before running, update passwords in `db-server-bootstrap.sql` and match them in `.env` (`MASTER_DATABASE_URL`, `TENANT_DB_SUPERUSER`, `TENANT_DB_SUPERUSER_PASSWORD`).

One-command setup scripts are also available:

```bash
# Linux/macOS
pnpm db:bootstrap:server

# Windows PowerShell
pnpm db:bootstrap:server:windows
```

Optional environment overrides for target PostgreSQL server:

- `POSTGRES_HOST` (default: `localhost`)
- `POSTGRES_PORT` (default: `5432`)
- `POSTGRES_USER` (default: `postgres`)
- `POSTGRES_DB` (default: `postgres`)
- `BOOTSTRAP_SQL` (default: `./db-server-bootstrap.sql`)

## Useful Commands

```bash
# Prisma Studio (master DB)
pnpm --filter @qa/prisma-master db:studio

# New master migration
pnpm --filter @qa/prisma-master migrate:dev --name <migration_name>

# Run all builds
pnpm build

# Lint all packages
pnpm lint
```
