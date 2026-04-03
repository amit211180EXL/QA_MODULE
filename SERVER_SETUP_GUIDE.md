# QA Platform — New Server Setup Guide

Complete step-by-step instructions to configure and deploy the QA Platform on a fresh server, including database provisioning.

---

## Prerequisites

| Software          | Version  | Purpose                            |
|-------------------|----------|------------------------------------|
| Node.js           | ≥ 20     | JavaScript runtime                 |
| pnpm              | ≥ 9      | Package manager (`npm i -g pnpm`)  |
| PostgreSQL        | ≥ 15     | Master + tenant databases          |
| Redis             | ≥ 7      | Job queues & caching               |
| Git               | any      | Clone the repository               |
| Docker (optional) | ≥ 24     | Run infra via `docker compose`     |

---

## 1. Clone the Repository

```bash
git clone https://github.com/amit211180EXL/QA_MODULE.git
cd QA_MODULE
```

---

## 2. Infrastructure Setup

### Option A — Docker Compose (recommended for dev/staging)

Starts PostgreSQL (master + tenant), Redis in containers:

```bash
docker compose up postgres-master postgres-tenant redis -d
```

Default ports:
- Master PostgreSQL: `localhost:5432` (user: `qa_master`, pass: `masterpass`)
- Tenant PostgreSQL: `localhost:5433` (user: `qa_superuser`, pass: `superpass`)
- Redis: `localhost:6379`

### Option B — Bare-metal / Managed PostgreSQL

If PostgreSQL and Redis are already installed on the server:

#### 2b-1. Bootstrap database roles & master DB

Edit passwords in `db-server-bootstrap.sql`, then run:

```bash
psql -U postgres -d postgres -f db-server-bootstrap.sql
```

Important: the script now fails if it still contains placeholder values (`CHANGE_ME_*`).

This creates:
- **Role** `qa_master` — owns the master database
- **Database** `qa_master` — stores tenants, users, billing, LLM configs
- **Role** `qa_superuser` (with CREATEDB, CREATEROLE) — used by the app to provision per-tenant databases at runtime

#### 2b-1a. Fix invalid `qa_master` credentials (common Linux issue)

If startup logs say `provided credentials for qa_master are not valid`, run:

```bash
sudo -u postgres psql
ALTER ROLE qa_master WITH LOGIN PASSWORD 'your_master_password';
ALTER ROLE qa_superuser WITH LOGIN PASSWORD 'your_tenant_superuser_password' CREATEDB CREATEROLE;
\q
```

Then ensure `apps/api/.env` matches exactly:

```env
MASTER_DATABASE_URL=postgresql://qa_master:your_master_password@<DB_HOST>:5432/qa_master
TENANT_DB_SUPERUSER=qa_superuser
TENANT_DB_SUPERUSER_PASSWORD=your_tenant_superuser_password
```

Verify login directly:

```bash
PGPASSWORD='your_master_password' psql -h <DB_HOST> -U qa_master -d qa_master -c 'SELECT 1;'
```

If login still fails, check authentication method (`pg_hba.conf`) and ensure host entries use `md5` or `scram-sha-256`.

#### 2b-2. Redis

Ensure Redis is running and accessible:

```bash
redis-cli ping
# Expected: PONG
```

---

## 3. Environment Configuration

```bash
cp .env.example apps/api/.env
```

Edit `apps/api/.env` with your actual values:

```env
# ─── App ─────────────────────────────────────────────────────
NODE_ENV=production
PORT=3000
API_URL=https://your-domain.com

# ─── Master DB ───────────────────────────────────────────────
MASTER_DATABASE_URL=postgresql://qa_master:<PASSWORD>@<DB_HOST>:5432/qa_master

# ─── Redis ───────────────────────────────────────────────────
REDIS_HOST=<REDIS_HOST>
REDIS_PORT=6379
REDIS_PASSWORD=<REDIS_PASSWORD>          # omit if none

# ─── JWT (min 32 chars each — generate unique secrets) ───────
JWT_SECRET=<GENERATE_UNIQUE_SECRET_32+_CHARS>
JWT_EXPIRES_IN=15m
REFRESH_SECRET=<GENERATE_UNIQUE_SECRET_32+_CHARS>
REFRESH_EXPIRES_IN=30d

# ─── Encryption key (64 hex chars = 32 bytes) ────────────────
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
MASTER_ENCRYPTION_KEY=<64_HEX_CHARS>

# ─── Tenant DB provisioning ─────────────────────────────────
TENANT_DB_HOST=<DB_HOST>
TENANT_DB_PORT=5432
TENANT_DB_SUPERUSER=qa_superuser
TENANT_DB_SUPERUSER_PASSWORD=<PASSWORD>

# ─── Email (SMTP) ───────────────────────────────────────────
EMAIL_FROM=noreply@your-domain.com
SMTP_HOST=<SMTP_HOST>
SMTP_PORT=587
SMTP_USER=<SMTP_USER>
SMTP_PASS=<SMTP_PASS>

# ─── Stripe (optional) ──────────────────────────────────────
# STRIPE_SECRET_KEY=sk_live_...
# STRIPE_WEBHOOK_SECRET=whsec_...
```

### Generate secrets quickly

```bash
# JWT / Refresh secrets
openssl rand -base64 48

# Encryption key (64 hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> **Important:** `MASTER_ENCRYPTION_KEY` encrypts tenant DB passwords. Once set and tenants are provisioned, **never change it** without a migration plan.

---

## 4. Install Dependencies

```bash
pnpm install
```

---

## 5. Generate Prisma Clients

```bash
pnpm db:generate
```

This generates typed database clients for both master and tenant schemas.

---

## 6. Run Database Migrations

```bash
pnpm db:migrate:deploy:all
```

This applies all pending migrations on the master database. Tenant databases are migrated automatically when each tenant is provisioned.

---

## 7. Seed Master Database

```bash
pnpm db:seed
```

Creates the initial admin user and dev tenant (for development). For production, use the signup flow or API instead.

---

## 8. Provision Tenants

After seeding, provision any tenants in `PROVISIONING` status:

```bash
pnpm dev:provision
```

This creates the tenant-specific PostgreSQL database, runs tenant migrations, and seeds a starter form template.

### 8a. Recovery: `qa_tenant_dev` missing / auth failed

If you get errors like `Authentication failed for user qa_tenant_dev` or `database qa_tenant_dev does not exist`, the master tenant record exists but the tenant DB/user was not provisioned on PostgreSQL.

Run this recovery flow:

```bash
# 1) Ensure env is loaded from repo root and key exists
grep MASTER_ENCRYPTION_KEY apps/api/.env

# 2) Re-provision the specific tenant (works even when not in PROVISIONING status)
pnpm dev:provision dev-tenant

# 3) Seed sample channel conversations for that tenant
node scripts/seed-channel-conversations.cjs --tenant=dev-tenant --count=3
```

If PostgreSQL role/database are still missing, create them manually and rerun tenant migrations:

```bash
sudo -u postgres psql
CREATE ROLE qa_tenant_dev LOGIN PASSWORD 'devpassword';
CREATE DATABASE qa_tenant_dev OWNER qa_tenant_dev;
\q

pnpm --dir packages/prisma-tenant exec prisma migrate deploy --schema=prisma/schema.prisma
```

---

## 9. Seed Sample Conversations (optional)

To populate sample conversations across all channels (CHAT, EMAIL, CALL, SOCIAL):

```bash
pnpm db:seed:channels
# or for a specific tenant:
node scripts/seed-channel-conversations.cjs --tenant=dev-tenant --count=3
```

---

## 10. Build for Production

```bash
pnpm build
```

This builds all packages and both apps (API + Web).

---

## 11. Start the Application

### Development

```bash
pnpm dev
```

- API: http://localhost:3000
- Web: http://localhost:3001
- Swagger: http://localhost:3000/api/docs

### Production

```bash
# API
NODE_ENV=production node apps/api/dist/main.js

# Web (Next.js)
cd apps/web && pnpm start
```

### Docker (full stack)

```bash
docker compose up -d
```

---

## One-Click Bootstrap Scripts

For fully automated setup on a fresh server:

```bash
# Linux / macOS
pnpm db:bootstrap:server

# Windows PowerShell
pnpm db:bootstrap:server:windows
```

These scripts run all 5 steps: SQL bootstrap → install → generate → migrate → seed.

Override target PostgreSQL connection:

| Variable         | Default     | Description              |
|------------------|-------------|--------------------------|
| `POSTGRES_HOST`  | `localhost` | PostgreSQL host          |
| `POSTGRES_PORT`  | `5432`      | PostgreSQL port          |
| `POSTGRES_USER`  | `postgres`  | Superuser for bootstrap  |
| `POSTGRES_DB`    | `postgres`  | Initial connection DB    |
| `BOOTSTRAP_SQL`  | `./db-server-bootstrap.sql` | Path to SQL file |

---

## Database Architecture

```
┌─────────────────────────────────────────────────┐
│              Master PostgreSQL                   │
│  Database: qa_master   (port 5432)               │
│  Tables:  tenants, users, subscriptions,         │
│           invoices, llm_configs,                 │
│           escalation_rules, blind_review_settings│
│           outbound_webhooks, email_settings      │
└─────────────────────────────────────────────────┘
           │
           │  App creates per-tenant DBs at runtime
           ▼
┌─────────────────────────────────────────────────┐
│           Tenant PostgreSQL(s)                   │
│  Database: qa_tenant_<id>  (port 5432/5433)      │
│  Tables:  conversations, evaluations,            │
│           form_definitions, workflow_queues,      │
│           audit_logs, audit_cases,               │
│           deviation_records                      │
└─────────────────────────────────────────────────┘
```

- **Master DB** stores global platform data (tenants, users, billing, configs).
- **Tenant DBs** store per-tenant operational data (conversations, evaluations, forms).
- Tenant DB credentials are encrypted in the master DB using `MASTER_ENCRYPTION_KEY`.
- Connections are lazily pooled via `TenantConnectionPool` service.

---

## Project Structure

```
QA_MODULE/
├── apps/
│   ├── api/              NestJS API server (port 3000)
│   └── web/              Next.js frontend  (port 3001)
├── packages/
│   ├── config/           Zod-validated env loader
│   ├── shared/           Shared TypeScript types & enums
│   ├── prisma-master/    Master DB schema, migrations, seed
│   └── prisma-tenant/    Tenant DB schema, migrations
├── scripts/
│   ├── bootstrap-server.sh      One-click Linux setup
│   ├── bootstrap-server.ps1     One-click Windows setup
│   ├── seed-channel-conversations.cjs  Sample data seeder
│   ├── dev-provision.cjs        Tenant provisioning
│   └── seed-runner.cjs          Master DB seeder
├── db-server-bootstrap.sql      PostgreSQL roles/DB setup
├── docker-compose.yml           Full infra + API containers
└── .env.example                 Environment variable template
```

---

## Useful Commands Reference

| Command                           | Description                                    |
|-----------------------------------|------------------------------------------------|
| `pnpm dev`                        | Start API + Web in dev mode                    |
| `pnpm build`                      | Build all packages and apps                    |
| `pnpm type-check`                 | Type-check all packages                        |
| `pnpm test`                       | Run unit tests                                 |
| `pnpm test:e2e`                   | Run E2E tests (needs DB + Redis)               |
| `pnpm db:generate`                | Generate Prisma clients                        |
| `pnpm db:migrate:deploy:all`      | Apply all pending migrations                   |
| `pnpm db:seed`                    | Seed master database                           |
| `pnpm db:seed:channels`           | Seed sample conversations (all channels)       |
| `pnpm dev:provision`              | Provision pending tenants                      |
| `pnpm db:bootstrap:server`        | One-click Linux/macOS setup                    |
| `pnpm db:bootstrap:server:windows`| One-click Windows setup                        |
| `pnpm smoke:auth`                 | Smoke test auth + conversations API            |

---

## Troubleshooting

### "role qa_master does not exist"
Run the bootstrap SQL first: `psql -U postgres -d postgres -f db-server-bootstrap.sql`

### "provided credentials for qa_master are not valid"
1. Reset role passwords via `ALTER ROLE` as shown above.
2. Ensure `.env` uses the same credentials.
3. Verify with `psql -h <DB_HOST> -U qa_master -d qa_master -c 'SELECT 1;'`.
4. If needed, update `pg_hba.conf` to `md5`/`scram-sha-256` and reload PostgreSQL.

### "MASTER_ENCRYPTION_KEY must be 64 hex characters"
Generate one: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### "Cannot connect to Redis"
Ensure Redis is running: `redis-cli ping` should return `PONG`.

### "No PROVISIONING tenants found"
Seed the master DB first: `pnpm db:seed`, then provision: `pnpm dev:provision`

### Prisma migration errors
Ensure Prisma clients are generated first: `pnpm db:generate`

### Port conflicts
Default ports: API=3000, Web=3001, Master PG=5432, Tenant PG=5433, Redis=6379.
Change in `.env` and `docker-compose.yml` as needed.
