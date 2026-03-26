# Phase 1 — Foundation: Week-by-Week Task Breakdown

**Goal:** Production-ready foundation — monorepo, auth, RBAC, tenant provisioning, master + tenant DB, onboarding shell.
**Output:** Deployable skeleton that future phases build on. No UI beyond basic auth pages.
**Team assumption:** 2–3 engineers.

---

## Week 1 — Monorepo, CI/CD, Master DB, Auth API

### Milestone: Auth works end-to-end. Master DB migrations run. CI pipeline green.

---

### Monorepo Setup

- [ ] Initialize monorepo (pnpm workspaces or Turborepo)
  - `/apps/api`        — NestJS API server
  - `/apps/web`        — Next.js frontend (shell only in Phase 1)
  - `/packages/prisma-master`   — Master DB Prisma client + schema
  - `/packages/prisma-tenant`   — Tenant DB Prisma client + schema
  - `/packages/shared`          — Shared types (DTOs, enums, constants)
  - `/packages/config`          — Env/config loader (Zod-validated)
- [ ] Configure TypeScript project references across packages
- [ ] Set up ESLint + Prettier with consistent rules
- [ ] Configure path aliases (`@qa/shared`, `@qa/config`, etc.)

### CI/CD Pipeline

- [ ] GitHub Actions (or equivalent) pipeline:
  - `lint` job — ESLint + Prettier check
  - `type-check` job — `tsc --noEmit` across all packages
  - `test` job — Jest unit tests
  - `build` job — `tsc` build for `/apps/api`
- [ ] `.env.example` with all required vars documented
- [ ] Docker Compose for local development:
  - `postgres-master` (port 5432)
  - `postgres-tenant-dev` (port 5433, single dev tenant DB)
  - `redis` (port 6379)

### Master DB — Prisma Schema + Migrations

- [ ] Define `02a-schema-master.prisma` (from schema document) in `/packages/prisma-master`
- [ ] Run `prisma migrate dev --name init_master` → generates initial migration
- [ ] Write TypeScript helper `getMasterClient()` (singleton, safe for hot reload in dev)
- [ ] Write `seed.master.ts`:
  - Insert a `dev` tenant record with known test DB credentials
  - Insert a dev admin user with known password hash

### Auth Module (`/apps/api/src/auth`)

- [ ] `POST /auth/signup` — create tenant + admin user, enqueue `tenant:provision` job
  - Validate slug uniqueness
  - Hash password with bcrypt (cost factor 12)
  - Store user with `status = INVITED`
  - Return 201 (user will receive `tenant:provision` email when ready)
- [ ] `POST /auth/login` — verify password, issue JWT access token (15 min) + refresh token (30 days)
  - Store refresh token hash in `refresh_tokens`
  - Never log or return raw refresh token twice
- [ ] `POST /auth/refresh` — rotate refresh token (issue new pair, revoke old)
- [ ] `POST /auth/logout` — revoke refresh token
- [ ] `POST /auth/forgot-password` — issue short-lived reset token (15 min), enqueue notify job
- [ ] `POST /auth/reset-password` — consume reset token, hash new password
- [ ] `GET /auth/me` — return current user

### Auth Infrastructure

- [ ] `JwtStrategy` (Passport) — verify access token, attach `{ userId, tenantId, role }` to request
- [ ] `JwtAuthGuard` — applied globally, whitelisted public routes via `@Public()` decorator
- [ ] Config service: `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_SECRET`, `REFRESH_EXPIRES_IN` from env (Zod-validated)
- [ ] Unit tests: login, refresh, revocation, invalid token

---

## Week 2 — Tenant Provisioning, Tenant DB, Connection Pooling

### Milestone: Signup → provision → tenant DB ready → tenant DB queries work in subsequent requests.

---

### BullMQ Queue Setup

- [ ] Install + configure BullMQ with Redis connection
- [ ] Create queue `tenant:provision` with retry + backoff config
- [ ] Worker process (`/apps/workers`) — separate process from API or same process (decision: same process in Phase 1 for simplicity, split in Phase 5)
- [ ] Job result tracking: store `{ jobId, status, result, error }` in Redis for polling via `GET /jobs/:jobId`

### `tenant:provision` Worker

- [ ] Implement full provisioning workflow per job contract:
  1. Generate unique DB name + user
  2. `CREATE DATABASE` + `CREATE USER` (connect as superuser)
  3. Encrypt DB password with AES-256-GCM using `MASTER_ENCRYPTION_KEY` from env
  4. Update `Tenant` record with `dbHost/dbPort/dbName/dbUser/dbPasswordEnc`
  5. Run `prisma migrate deploy` against new tenant DB using dynamic URL
  6. Seed defaults (escalation rules, blind review settings, starter form template)
  7. Set `User.status = ACTIVE` for admin
  8. Set `Tenant.status = ACTIVE`
  9. Enqueue `notify:send[tenant_ready]`
- [ ] Unit test: mock DB creation + migrations, verify state transitions
- [ ] Integration test: full provision against real local test DB

### Tenant DB — Prisma Schema + Migration Helper

- [ ] Define `02b-schema-tenant.prisma` in `/packages/prisma-tenant`
- [ ] Write `runTenantMigrations(dbUrl: string)` utility (used by provisioning worker)
- [ ] Verify all indexes exist and are correct
- [ ] Write `seed.tenant.ts`: starter form template + default escalation rules

### Tenant DB Connection Pool

- [ ] `TenantConnectionPool` service:
  - `getClient(tenantId)` — returns cached PrismaClient or creates new one
  - Cache key: `pool:tenant:{tenantId}` in Redis (stores `lastUsed` timestamp)
  - Pool sizing by plan: BASIC=2, PRO=5, ENTERPRISE=10
  - Eviction: `$disconnect()` + Redis key delete
- [ ] `TenantResolver` middleware:
  - Runs before all route handlers on authenticated routes
  - Reads `tenantId` from JWT claim
  - Calls `TenantConnectionPool.getClient(tenantId)`
  - Attaches `tenantDb` to request context
- [ ] `pool:reap` cron job (every 15 min) — evict idle pools
- [ ] Health check: `GET /internal/tenants/:id/health` → test DB connectivity
- [ ] Unit tests: pool creation, cache hit, eviction, reaper

### Notify Module (minimal)

- [ ] `notify:send` worker — email only in Phase 1
- [ ] Configure transactional email provider (SES or SMTP)
- [ ] Templates: `tenant_ready`, `user_invited`, `password_reset`
- [ ] Unit test: template rendering, payload validation

---

## Week 3 — RBAC Middleware, User Management API, Onboarding Shell

### Milestone: Admin can invite QA/Verifier users. RBAC enforced on all routes. Basic UI auth flow works.

---

### RBAC

- [ ] `RolesGuard` — checks `@Roles(...roles)` decorator against JWT `role` claim
  - Applied globally after `JwtAuthGuard`
  - Returns 403 with `INSUFFICIENT_ROLE` error code
- [ ] `FeatureGateGuard` — checks `@Feature('feature_name')` decorator against plan
  - Plan feature matrix defined in `/packages/config/features.ts`
  - Returns 403 with `PLAN_FEATURE_NOT_AVAILABLE` + upgrade hint
- [ ] Centralize guard order: `JwtAuthGuard → TenantResolver → RolesGuard → FeatureGateGuard`
- [ ] Write test matrix covering all role × route combinations

### Users API (`/apps/api/src/users`)

- [ ] `GET /users` — list tenant users (ADMIN only)
- [ ] `POST /users/invite` — create user with `status = INVITED`, enqueue `notify:send[user_invited]` with magic link
- [ ] `GET /users/:id` — get user (ADMIN only)
- [ ] `PATCH /users/:id` — update role/status/name. Guard: cannot demote last ADMIN.
- [ ] `DELETE /users/:id` — soft deactivate (`status = INACTIVE`)
- [ ] Magic invite link: signed JWT with `{ userId, type: "invite" }`, 72 hr expiry
  - `POST /auth/accept-invite` — consume invite token, set password, activate user
- [ ] Unit tests: invite flow, last-admin guard, RBAC enforcement

### LLM Config API (`/apps/api/src/llm-config`)

- [ ] `GET /llm-config` — return config (API key masked as `sk-***...***`)
- [ ] `PUT /llm-config` — validate + encrypt API key server-side, upsert record
- [ ] `POST /llm-config/test` — make a minimal LLM call (single token), return latency + provider confirmed
- [ ] Encryption utility: `encrypt(plaintext)` / `decrypt(ciphertext)` using `MASTER_ENCRYPTION_KEY`
- [ ] Unit tests: key masking, encryption round-trip, test endpoint mock

### Web App Shell (`/apps/web`)

- [ ] Next.js app router project with TypeScript + Tailwind
- [ ] Auth pages: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/accept-invite`
- [ ] Auth state: `next-auth` or custom JWT cookie strategy
- [ ] Auth context: `useCurrentUser()` hook
- [ ] Route guards: middleware redirect to `/login` if unauthenticated
- [ ] Layout: sidebar nav (links to future pages, disabled if not yet built), header with user menu + logout
- [ ] Onboarding flow (post-signup):
  - Step 1: LLM config (or skip — configure later)
  - Step 2: Invite users (or skip)
  - Step 3: "You're ready" — link to upload conversation (Phase 2)
- [ ] No QA/form/evaluation UI yet — scoped to Phase 2+

---

## Week 4 — Hardening, Integration Tests, First Deployment

### Milestone: Everything from Weeks 1–3 deployed to staging. Full integration test suite green.

---

### Security Hardening

- [ ] Rate limiting: `throttler` guard on auth routes (10 req/min per IP on `/auth/login`, `/auth/forgot-password`)
- [ ] Helmet headers on API (`X-Frame-Options`, `CSP`, `HSTS`, etc.)
- [ ] Request validation: `class-validator` + `class-transformer` on all DTOs (globally applied `ValidationPipe`)
- [ ] Response sanitization: never return `passwordHash`, `dbPasswordEnc`, `apiKeyEnc` in any response
- [ ] SQL injection: Prisma parameterizes all queries — verify no raw query construction
- [ ] Audit log: write `AuditLog` entry for all auth events (login, logout, password change, invite accept)
- [ ] Secrets audit: all secrets in env vars, none hardcoded, `.env` in `.gitignore`

### Observability

- [ ] Structured JSON logging via `pino`:
  - Every request: `{ requestId, tenantId, userId, method, path, statusCode, durationMs }`
  - Every job: `{ jobId, queue, tenantId, durationMs, status }`
  - Every LLM call stub: `{ tenantId, provider, model, tokens, costCents, durationMs }`
- [ ] `requestId` propagated via `AsyncLocalStorage` (no manual passing)
- [ ] Health check endpoints:
  - `GET /health` — master DB ping + Redis ping
  - `GET /health/ready` — includes queue worker status
- [ ] Prometheus metrics stub (instrument later in Phase 5): counter + histogram hooks in place

### Integration Tests

- [ ] Signup → provision flow (end-to-end with real test DBs)
- [ ] Login → token refresh → logout cycle
- [ ] Invite user → accept invite → login as invited user
- [ ] RBAC: verify QA cannot call ADMIN-only routes (test each role × route boundary)
- [ ] Feature gate: verify BASIC plan cannot call PRO-only endpoints
- [ ] Tenant isolation: create 2 test tenants, verify no cross-tenant data leak
- [ ] Pool reaper: verify idle pools are evicted

### Staging Deployment

- [ ] Dockerfile for `/apps/api` (multi-stage, non-root user, minimal image)
- [ ] Docker Compose for staging (or Kubernetes manifests if infra team involved)
- [ ] `.env.staging` configuration (not committed — documented in README)
- [ ] `prisma migrate deploy` runs as part of API startup (safe for idempotent migrations)
- [ ] Smoke test checklist:
  - [ ] Signup creates tenant record
  - [ ] Provisioning worker runs and sets `Tenant.status = ACTIVE`
  - [ ] Admin can log in and reach `GET /auth/me`
  - [ ] Admin can invite a QA user
  - [ ] QA can accept invite and log in
  - [ ] RBAC rejects QA accessing admin routes

### Documentation

- [ ] `README.md`: local dev setup, env vars required, how to run tests, how to run workers
- [ ] `CONTRIBUTING.md`: branch naming, PR checklist, migration conventions
- [ ] ADR (Architecture Decision Record) for: dual-DB pattern, BullMQ choice, connection pool strategy

---

## Phase 1 Definition of Done

| Criterion | Check |
|---|---|
| Auth API fully tested (unit + integration) | ☐ |
| Tenant provisioning worker runs end-to-end | ☐ |
| Tenant DB migrations clean and versioned | ☐ |
| Connection pool tested with multiple tenants | ☐ |
| RBAC guards cover all Phase 1 routes | ☐ |
| Feature gates enforce plan limits | ☐ |
| Onboarding shell deployed to staging | ☐ |
| Zero secrets hardcoded | ☐ |
| CI pipeline green on main branch | ☐ |
| Tenant isolation verified (no cross-tenant leakage) | ☐ |
| Structured logging on all requests + jobs | ☐ |
| README + contributing docs written | ☐ |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `CREATE DATABASE` requires superuser — unexpected in managed DB (RDS, Cloud SQL) | Use provisioned DB pool pattern: pre-create DBs, assign to tenants. Plan for managed DB provider early. |
| Prisma dual-client package naming conflicts | Use separate `output` paths + distinct package names. Test import resolution early (Week 1). |
| BullMQ Redis single point of failure | Use Redis Sentinel or cluster in staging. Graceful degradation: API returns 202 + jobId even if queue is temporarily degraded. |
| Email provider cold start blocking invite flow | Pre-configure and smoke-test email provider in Week 2. Fallback: log invite link in dev. |
| Encryption key rotation not planned | Document `MASTER_ENCRYPTION_KEY` rotation procedure before going to production. Use envelope encryption (Phase 5). |
