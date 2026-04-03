# QA Module — Project Status
**Last updated:** April 1, 2026  
**Test suite:** 168 unit tests passing · 78 e2e tests passing  
**TypeScript:** API ✅ clean · Web ✅ clean

---

## Architecture Overview

| Layer | Technology | Port |
|---|---|---|
| API | NestJS + TypeScript + BullMQ | 3000 |
| Web | Next.js 14 + Tailwind CSS | 3001 |
| Master DB | PostgreSQL (`qa_master`) | 5432 |
| Tenant DBs | PostgreSQL (one per tenant, provisioned on signup) | 5432 |
| Queue / Cache | Redis | 6379 |

**Monorepo layout (pnpm workspaces):**
```
apps/api          — NestJS REST API
apps/web          — Next.js frontend
packages/config   — Zod env schema (shared)
packages/shared   — Shared types, enums, constants
packages/prisma-master  — Master DB Prisma client
packages/prisma-tenant  — Tenant DB Prisma client
```

**Dev credentials (seeded):**
- Email: `admin@dev.local`
- Password: `DevAdmin123!`
- Tenant slug: `dev-tenant`

**Seed command:** `pnpm db:seed` (from repo root)

---

## ✅ Implemented

### Backend — NestJS API (`apps/api/src/`)

#### Authentication & Security
- [x] **Signup** → creates tenant + admin user + enqueues provisioning job
- [x] **Login** — tenant-slug-scoped, bcrypt password verify, last-login timestamp
- [x] **JWT access tokens** (15 min) + **refresh tokens** (30 days, rotated on use, revoked on logout)
- [x] **Forgot password** → HMAC token stored in Redis (15 min TTL) → `NotifyService` sends reset email
- [x] **Reset password** — validates Redis token, re-hashes password, revokes all refresh tokens
- [x] **Global guards** — `JwtAuthGuard`, `RolesGuard` (ADMIN / QA / VERIFIER), `FeatureGateGuard` (plan gating), `ThrottlerGuard` (120 req/min)

#### Tenant Provisioning
- [x] **BullMQ worker** (`tenant-provision.worker.ts`) — creates isolated PostgreSQL database per tenant, runs Prisma migrations, seeds default escalation rules + blind review settings, stores AES-256-GCM encrypted DB password
- [x] **Tenant connection pool** — LRU pool with idle reaping, plan-based pool sizing (BASIC: 3, PRO: 5, ENTERPRISE: 10)

#### Users
- [x] List users (paginated), create user (returns plaintext password once, user immediately ACTIVE), deactivate user

#### Forms
- [x] Full CRUD — create, list, get, update sections + questions (all types: BOOLEAN, SCALE, TEXT, SELECT, MULTI_SELECT)
- [x] Publish / Deprecate / Archive lifecycle
- [x] Rubric support (anchors with score values), options, conditional logic, question ordering
- [x] Scoring strategies (WEIGHTED_AVERAGE, SECTION_WEIGHTED, SIMPLE_AVERAGE)

#### Conversations
- [x] CSV/JSON bulk upload — plan limit enforcement, 500-row batch cap, upsert (idempotent on `externalId`)
- [x] Finds active published form for channel, creates evaluations, enqueues `eval-process` jobs
- [x] Usage meter records monthly conversation count

#### Evaluations — AI Pipeline
- [x] **`eval-process` BullMQ worker** — tenant DB connect → LLM config → load conversation + form → build prompt → LLM call (OpenAI / Azure OpenAI / Custom) → JSON parse → score AI layer → persist results → move to `QA_PENDING`
- [x] **Real LLM cost calculation** (`llm-cost.util.ts`) — prefix-matched pricing for GPT-4o, GPT-4o-mini, GPT-4-Turbo, GPT-4, GPT-3.5-Turbo, Claude 3 / 3.5 families
- [x] AI token + cost usage recorded in `UsageMetric` (monthly, per tenant) after each eval
- [x] No-LLM-config fallback — skips AI, goes straight to QA queue
- [x] `AI_FAILED` on error → conversation marked FAILED, `evaluation.failed` outbound webhook fired

#### Evaluations — QA / Verifier Workflow
- [x] **`qaStart`** — claim evaluation, move to `QA_IN_PROGRESS`, assign to QA user
- [x] **`qaSubmit`** — score QA layer, per-question deviation records (`AI_VS_QA`), AI↔QA deviation calc, auto-escalation when deviation ≥ configured threshold, route to VERIFIER or ESCALATION queue
- [x] **`verifierStart`** — claim from VERIFIER_PENDING / QA_COMPLETED
- [x] **`verifierApprove`** — adopt QA answers as final, move to LOCKED
- [x] **`verifierModify`** — override answers, re-score, create `QA_VS_VERIFIER` deviation records, move to LOCKED
- [x] **`verifierReject`** — return to `QA_PENDING` with reason
- [x] **Blind review enforcement** in `getEvaluation` — masks `agentId/agentName` for QA reviewers; masks `qaUserId` for verifiers (controlled per tenant via `BlindReviewSettings`)
- [x] Full pagination for QA queue, VERIFIER queue, ESCALATION queue
- [x] Preview-score endpoint (dry-run scoring for form + sample answers)

#### Escalation
- [x] **Auto-escalation** on `qaSubmit` when AI↔QA deviation ≥ `qaDeviationThreshold`
- [x] **Stale queue escalation** cron (`StaleQueueEscalationService`) — runs every 30 min, escalates items overdue by more than `staleQueueHours` across all active tenants, fires `evaluation.escalated` outbound webhook

#### Audit Log
- [x] Every state transition written to `AuditLog` with: action, actorId, actorRole, metadata diff

#### Analytics (8 endpoints)
- [x] Overview KPIs (total conversations, completed evals, pending queues, avg score, pass rate, avg AI↔QA deviation)
- [x] Agent performance (per-agent avg score + pass rate)
- [x] Deviation trends (daily AI↔QA and QA↔Verifier averages)
- [x] Question deviations (most-overridden questions by QA)
- [x] Escalation stats (escalated count + pending escalation count)
- [x] Verifier overrides (most-overridden questions by verifiers)
- [x] Rejection reasons (grouped verifier rejection reasons with rates)
- [x] Score trends (daily avg + pass rate, plus breakdown by channel)
- [x] AI usage trends (monthly token count, cost in cents/dollars, active users)

#### LLM Config
- [x] Encrypted API key storage (AES-256-GCM), provider routing (OpenAI / Azure OpenAI / Custom), temperature + max tokens

#### Tenant Settings
- [x] Escalation rules (qaDeviationThreshold, verifierDeviationThreshold, staleQueueHours)
- [x] Blind review settings (hideAgentFromQA, hideQAFromVerifier)
- [x] API key management (rotate webhook ingestion API key)

#### Billing
- [x] Subscription info with plan + status, current period, trial end date
- [x] Invoice history
- [x] Usage metrics (conversations processed, AI tokens used, AI cost, active users — per month)
- [x] Stripe checkout session creation endpoint + billing page checkout redirects
- [x] Stripe webhook processing (signature verification, subscription/invoice sync)
- [x] Webhook idempotency persistence (`StripeWebhookEvent` with PROCESSING/PROCESSED/FAILED states)
- [x] Cancel/resume controls (API endpoints + billing page actions)
- [x] Plan change controls with proration behavior (`create_prorations` / `always_invoice` / `none`)
- [x] Post-checkout billing UX refresh (success/cancel banner + auto-refresh of billing/usage data)
- [x] Past-due payment recovery via Stripe customer portal session + billing-page "Retry Payment" action

#### Notifications
- [x] `NotifyService` — SMTP delivery when `SMTP_HOST` set; dev-log fallback when not
- [x] Templates: `tenant_ready`, `user_invited`, `password_reset`
- [x] `WEB_URL` env var for building reset links

#### Inbound Webhooks
- [x] `POST /webhooks/ingest` — public endpoint authenticated with `X-Api-Key` (tenant API key, HMAC-SHA256 in Redis)
- [x] Mirrors full conversations upload pipeline (plan limits, form matching, eval queue)

#### Outbound Webhooks
- [x] Register endpoint with URL + event subscriptions, AES-256-GCM encrypted signing secret
- [x] Signing secret returned **once** on creation/rotation — never stored in plaintext
- [x] HMAC-SHA256 `X-QA-Signature` header on every delivery
- [x] Events: `evaluation.completed`, `evaluation.escalated`, `evaluation.failed`
- [x] Fire-and-forget delivery (5s timeout, errors logged but never surfaced to user)
- [x] Enable / disable / delete endpoints, rotate signing secret
- [x] `evaluation.failed` fired from standalone `deliverFailedWebhook()` in eval worker
- [x] `evaluation.escalated` fired from both `qaSubmit` (threshold breach) and stale escalation cron

---

### Frontend — Next.js Web App (`apps/web/src/`)

| Route | Page |
|---|---|
| `/login` | Email + password login with tenant slug |
| `/signup` | Self-service workspace creation (name, slug, plan selection) |
| `/forgot-password` | Email form → triggers reset email |
| `/reset-password` | Token-based password update |
| `/onboarding` | First-run wizard: LLM config → add team → create form |
| `/dashboard` | KPI overview cards |
| `/upload` | CSV/JSON bulk upload — drag-drop, quoted-field CSV parser, flexible header mapping, preview table, template download |
| `/conversations/[id]` | Conversation detail view |
| `/qa-queue` | QA work queue list with AI score + state badges |
| `/qa-queue/[id]` | Full QA review — per-question answer editor, conditional logic, blind review support, feedback/flags, submit → auto-routes to verifier or escalation |
| `/verifier-queue/[id]` | Verifier review (approve / modify / reject) |
| `/escalation-queue` | Escalation queue with priority badges |
| `/forms` | Form list |
| `/forms/new` | Create form (key, name, description, channels) |
| `/forms/[id]` | Full form builder — sections, questions (all types), rubric anchors, options, conditional logic, drag-to-reorder, autosave, publish / deprecate / archive |
| `/users` | User list + create user modal (shows credentials once with copy button) |
| `/analytics` | Charts (Recharts): score trends, agent performance, deviation trends, AI usage, date range filter, client-side CSV export |
| `/settings` | Settings hub |
| `/settings/llm` | LLM provider configuration (provider, model, API key, temperature, max tokens) |
| `/settings/blind-review` | Blind review toggles |
| `/settings/escalation` | Escalation rule configuration |
| `/settings/webhooks` | Outbound webhook management — register endpoint, event checkboxes, one-time secret display, enable/disable toggle, rotate secret, delete |
| `/billing` | Subscription info, usage progress bars, invoice history |

---

### Test Coverage

| Spec file | Tests | Scope |
|---|---|---|
| `auth.service.spec.ts` | ~35 | Login, refresh, logout, acceptInvite |
| `tenant-connection-pool.service.spec.ts` | ~30 | Pool lifecycle, LRU eviction, reaping |
| `tenant-provision.worker.spec.ts` | ~25 | DB creation, encryption, migrations, seed |
| `scoring.service.spec.ts` | ~25 | All scoring strategies, pass/fail, edge cases |
| `notify.service.spec.ts` | ~20 | All templates, SMTP mode, dev-log mode |
| `feature-gate.guard.spec.ts` | ~12 | Plan-based feature access |
| `outbound-webhooks.service.spec.ts` | ~18 | CRUD, delivery, signature, fire-and-forget |
| `llm-cost.util.spec.ts` | ~13 | All model families, prefix priority, rounding |
| **Total** | **168** | |

**E2E tests** (`test/auth.e2e-spec.ts`): 29 tests covering full auth flow end-to-end.

---

## Gap Analysis: Plan vs. Built

> Sourced from `plan-qaModule.prompt.md`

---

### Phase 1 — Foundation ✅ COMPLETE

| Planned | Status |
|---|---|
| Monorepo (pnpm workspaces) | ✅ Done |
| Auth + RBAC (Admin / QA / Verifier) | ✅ Done |
| Tenant provisioning (isolated Postgres DB per tenant) | ✅ Done |
| Base Prisma schemas (master + tenant) | ✅ Done |
| Onboarding shell | ✅ Done |

---

### Phase 2 — Evaluation Core ✅ COMPLETE

| Planned | Status |
|---|---|
| Form engine with draft → published → deprecated → archived versioning | ✅ Done |
| Immutable published versions (evaluations pinned to form version) | ✅ Done |
| AI form filling (LLM call → tenants JSON form → score) | ✅ Done |
| BullMQ queue workers with retries (3 attempts, exponential backoff) | ✅ Done |
| LLM routing — OpenAI / Azure OpenAI / Custom | ✅ Done |
| LLM failover to backup provider on error | ✅ Done — worker now retries with `backupProvider/backupModel/backupApiKeyEnc` when primary call fails |
| Confidence routing (< 0.6 → mandatory verifier, 0.6–0.9 → normal, > 0.9 → optional QA skip) | ✅ Done (phase-1 implementation) — worker computes min-confidence score, stores `confidenceScore`, sets confidence route metadata, and adjusts QA queue priority |
| No-LLM QA-direct path | ✅ Done |

---

### Phase 3 — QA Layer ✅ COMPLETE

| Planned | Status |
|---|---|
| QA dashboard (queue list + review page) | ✅ Done |
| Dynamic form editing support in QA review | ✅ Done |
| Per-question deviation records (AI vs QA, QA vs Verifier) | ✅ Done |
| Deviation-based auto-escalation | ✅ Done |
| Stale queue timeout escalation | ✅ Done |
| Blind review (hide agent from QA, hide QA from verifier) | ✅ Done — deterministic hash anonymization implemented |

---

### Phase 4 — Verifier + Analytics ✅ LARGELY COMPLETE

| Planned | Status |
|---|---|
| Verifier approve / modify / reject workflow | ✅ Done |
| Final score locked (LOCKED state) | ✅ Done |
| Audit cases for high verifier deviation | ✅ Done — `AuditCase` entity, automatic case creation on threshold breach, `AUDIT_QUEUE`, and resolve/dismiss workflow are implemented |
| Analytics dashboards (agent performance, QA accuracy, deviation, score trends, AI cost) | ✅ Done |
| CSV export of analytics | ✅ Done (client-side) |
| PDF export | ✅ Done (client-side) — analytics page exports a multi-section PDF report |
| Audit log export | ✅ Done (API) — CSV export endpoint added at `GET /evaluations/audit/export` with date and evaluation filters |

---

### Phase 5 — Hardening + SaaS ⚠️ PARTIALLY STARTED

| Planned | Status |
|---|---|
| Stripe billing — checkout flow (Website → Signup → Plan → Payment → Tenant Created) | ✅ Done — Stripe checkout-session API, billing UI checkout redirects, and webhook activation path now update subscription/invoice records |
| Dunning / retry for failed payments | ⚠️ Partial — webhook handler marks subscriptions `PAST_DUE` on `invoice.payment_failed` and billing UI now supports Stripe portal payment recovery; automated retry orchestration/reporting still pending |
| Plan upgrade / downgrade flow | ✅ Done — billing UI supports direct Stripe subscription plan changes with selectable proration behavior and post-checkout refresh UX; checkout remains available for first-time subscription creation |
| Metered usage + overage handling | ⚠️ Partial — conversations + tokens tracked, but no overage billing logic |
| Active-user count tracking in UsageMetric | ✅ Done — incremented once per user per month on login |
| Multi-channel data ingestion (CRM / chat tool webhooks) | ⚠️ Partial — inbound webhook endpoint (`POST /webhooks/ingest`) done; call transcripts / STT not planned yet |
| Scalability hardening (read replicas, Redis analytics cache, autoscaling workers) | ✅ Done (phase-1) — Redis analytics response cache, read-replica analytics hook, env-configurable worker concurrency, queue backlog metrics, and autoscaling recommendation gauges are implemented |
| SSO (Enterprise plan feature gate reserved) | ❌ **NOT DONE** — feature flag exists in `PLAN_FEATURES` but no SAML/OIDC implementation |
| HIPAA / SOC2 / GDPR compliance controls | ❌ **NOT DONE** |
| Continuous learning loop (top overrides → rubric refinements → prompt tuning) | ❌ **NOT DONE** — data is captured but no tooling to drive feedback loop |

---

### Cross-Cutting Gaps from the Plan

| Planned | Status |
|---|---|
| DB migration files (`prisma migrate dev`) | ✅ Done — migration folders + lockfiles are in repo, tenant provisioning now uses `migrate deploy` (no `db push` in active dev path) |
| Observability hooks (metrics, tracing, alerting) | ✅ Done (metrics) — Prometheus-compatible endpoint at `GET /health/metrics` with default process metrics + HTTP request counters/latency histograms |
| API rate limiting per tenant | ✅ Done — global throttler now tenant-keyed (`tenantId` / API key) with endpoint-specific ingestion caps |
| Security: encrypted secrets at rest | ✅ Done — AES-256-GCM for LLM API keys, DB passwords, webhook signing secrets |
| Security: tenant isolation enforced | ✅ Done — all queries tenant-scoped, no cross-tenant path |
| Deterministic scoring (same form + same answers = same score) | ✅ Done — `ScoringService` is pure/deterministic |
| AI output schema validation | ✅ Done — worker validates question keys, required value, and confidence/reasoning types before scoring |
| Confidence score as routing signal | ✅ Done — min-confidence is persisted and queue priority is adjusted |
| E2E tests beyond auth | ✅ Done — forms, evaluations, and webhooks e2e coverage added |

---

## 🔲 Prioritized Remaining Work

### 🔴 Phase 5 Critical (before production launch)

| # | Item | Effort |
|---|---|---|
| 2 | **Stripe integration** — checkout, webhook handler, plan activation, failed-payment dunning | Large |


### 🟡 Phase 5 Important

| # | Item | Effort |
|---|---|---|
| 6 | **Scalability hardening** (read replicas, redis analytics cache, worker autoscaling) | Large |

### Recently closed gaps

- Added LLM backup-provider failover in worker (`backupProvider`, `backupModel`, `backupApiKeyEnc`).
- Added confidence-based routing in worker (stores `confidenceScore`, tags route metadata, adjusts QA queue priority).
- Added AI output schema validation before scoring (key coverage + type checks + confidence range validation).
- Added audit log CSV export API: `GET /evaluations/audit/export?from=&to=&evaluationId=`.
- Added AI_FAILED retry API: `POST /evaluations/:id/retry-ai` (ADMIN), re-queues eval-process job and audits action.
- Added verifier-deviation audit case workflow (auto-create on threshold breach, `AUDIT_QUEUE`, resolve/dismiss API).
- Added outbound webhook delivery logs + retry support (`GET /outbound-webhooks/deliveries`, `POST /outbound-webhooks/deliveries/:id/retry`).
- Added e2e coverage for forms, evaluations, and webhooks (full suite now 78 passing e2e tests).
- Added deterministic blind-review anonymization (stable tenant-scoped hashed aliases for agent and QA identifiers).
- Added tenant-aware API throttling (tenant/API-key tracker) plus explicit ingestion limits on `/conversations/upload` and `/webhooks/ingest`.
- Replaced `db push` in dev tenant provisioning with `prisma migrate deploy` and aligned root migration scripts to migration-first workflow.
- Added observability metrics hooks via Prometheus client (`/health/metrics`, process metrics, HTTP request count + latency histogram instrumentation).
- Added Redis-backed analytics response caching (tenant/date-range keyed, safe fallback when Redis unavailable).
- Added queue worker concurrency controls via env (`EVAL_WORKER_CONCURRENCY`, `TENANT_PROVISION_WORKER_CONCURRENCY`) for scale tuning without code changes.
- Added queue backlog Prometheus gauges (`queue_jobs_waiting/active/delayed/failed`) for eval/provision queues to support autoscaling triggers.
- Added dynamic autoscaling policy gauges (`queue_autoscale_recommended_replicas`) with configurable min/max/target-backlog env knobs per queue.
- Added read-replica routing hook for analytics reads via tenant pool (`getReadClient`) with automatic fallback to primary DB.
- Added audit queue web UI page and navigation wiring.
- Added analytics PDF export (client-side report generation).
- Added reusable API smoke scripts: `pnpm smoke:auth` (login/me/conversations/logout) and `pnpm smoke:auth:queues` (adds QA + verifier queue checks).
- Added CI integration smoke stage in `.github/workflows/ci.yml` (seed + provision + API boot + deep smoke checks + failure log dump).
- Added CI integration artifact uploads (`integration-logs`) containing `e2e.log` and `api-smoke.log` for easier failure triage.
- Added CI degraded-mode smoke job (`Integration Smoke (Redis Disabled)`) to verify API + auth/business smoke flow with `REDIS_ENABLED=false`.
- Added CI web smoke job (`Web Smoke Tests`) that builds/starts Next.js and verifies public auth routes (`/login`, `/signup`, `/forgot-password`).
- Added aggregate CI `Quality Gate` job that depends on lint, type-check, unit tests, build, API integration, Redis-disabled smoke, and web smoke checks.
- Added workflow-level CI concurrency control to auto-cancel superseded runs on the same branch/PR.
- Documented canonical evaluation workflow (including LLM-disabled branch and continuous learning loop) in architecture docs.
- Implemented LLM-disabled runtime path: evaluations now skip AI, move directly to QA queue, mark conversation `QA_REVIEW`, and keep verifier flow unchanged.
- Added Stripe checkout-session API + public Stripe webhook handler for subscription/invoice lifecycle updates.
- Added billing UI plan switch actions that redirect to Stripe checkout.

### 🟢 Phase 5 / Enterprise

| # | Item | Effort |
|---|---|---|
| 12 | **SSO (SAML / OIDC)** for Enterprise plan | Large |
| 14 | **Observability** — OpenTelemetry traces + Prometheus metrics | Large |
| 15 | **Continuous learning loop UI** — top-overridden questions → rubric refinement suggestions | Large |
| 16 | **STT integrations** for call transcript ingestion | Large |
| 17 | **HIPAA / SOC2 compliance controls** | Large |

---

## Environment Variables Reference

```env
# Application
NODE_ENV=development
PORT=3000
API_URL=http://localhost:3000
WEB_URL=http://localhost:3001

# Master DB
MASTER_DATABASE_URL=postgresql://qa_master:masterpass@localhost:5432/qa_master

# Redis
REDIS_ENABLED=true
REDIS_HOST=localhost
REDIS_PORT=6379
EVAL_WORKER_CONCURRENCY=5
TENANT_PROVISION_WORKER_CONCURRENCY=2
AUTOSCALE_EVAL_MIN_REPLICAS=1
AUTOSCALE_EVAL_MAX_REPLICAS=20
AUTOSCALE_EVAL_TARGET_BACKLOG_PER_REPLICA=25
AUTOSCALE_TENANT_PROVISION_MIN_REPLICAS=1
AUTOSCALE_TENANT_PROVISION_MAX_REPLICAS=10
AUTOSCALE_TENANT_PROVISION_TARGET_BACKLOG_PER_REPLICA=5

# JWT
JWT_SECRET=<min 32 chars>
JWT_EXPIRES_IN=15m
REFRESH_SECRET=<min 32 chars>
REFRESH_EXPIRES_IN=30d

# Encryption (AES-256-GCM)
MASTER_ENCRYPTION_KEY=<64 hex chars = 32 bytes>

# Tenant DB provisioning
TENANT_DB_HOST=localhost
TENANT_DB_PORT=5432
TENANT_DB_SUPERUSER=qa_superuser
TENANT_DB_SUPERUSER_PASSWORD=superpass
TENANT_READ_DB_HOST=
TENANT_READ_DB_PORT=5432

# Email (optional in dev — logs to console if not set)
EMAIL_FROM=noreply@qa-platform.local
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=

# Stripe (optional in dev)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=

# Platform admin (optional)
PLATFORM_ADMIN_TOKEN=
```

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Start PostgreSQL + Redis (Docker)
docker-compose up -d

# 3. Run DB setup SQL (pgAdmin or psql as superuser)
#    See db-setup.sql

# 4. Copy and fill env
cp apps/api/.env.example apps/api/.env

# 5. Run master DB migrations
pnpm --filter @qa/prisma-master migrate:dev

# 6. Seed dev data
pnpm db:seed

# 7. Start API
pnpm --filter @qa/api dev

# 8. Start Web
pnpm --filter @qa/web dev

# 9. Run tests
pnpm --filter @qa/api test
```
