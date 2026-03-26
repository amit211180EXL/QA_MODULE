# Queue Job Contracts

Queue layer: **BullMQ** backed by Redis.

## Design Rules
- Every job payload is a typed JSON object (TypeScript interface shown).
- Every job defines `attempts`, `backoff`, and `timeout`.
- Idempotency: job handlers check current state before acting (safe to retry).
- Failed jobs persist in the "failed" BullMQ set for inspection/replay.
- `tenantId` is always present so the worker can resolve the correct tenant DB connection.

---

## Queues Overview

| Queue Name | Worker Concurrency | Priority Support | Purpose |
|---|---|---|---|
| `eval:process` | 10 | No | AI evaluation of a conversation |
| `eval:escalate` | 5 | No | Escalation rule evaluation |
| `queue:stale-check` | 2 | No | Detect stale QA/verifier queue items |
| `tenant:provision` | 2 | No | Provision new tenant DB |
| `tenant:deactivate` | 2 | No | Suspend/cancel tenant cleanup |
| `billing:usage-sync` | 2 | No | Sync usage counters to master DB |
| `notify:send` | 20 | No | Email / in-app notifications |
| `report:export` | 3 | No | Async export generation |
| `pool:reap` | 1 (cron) | No | Reap idle tenant DB connections |

---

## JOB: `eval:process`

**Enqueued by:** `POST /conversations` (after conversation stored)
**Worker responsibility:** fetch LLM config → fetch form → call LLM (or skip) → store aiResponseData → transition to `QA_PENDING`

```typescript
interface EvalProcessJobPayload {
  tenantId:       string;   // for tenant DB + LLM config lookup
  conversationId: string;
  evaluationId:   string;
  formDefinitionId: string;
  formVersion:    number;
}

// Job options
{
  attempts: 3,
  backoff: { type: "exponential", delay: 5000 },
  timeout: 120_000,          // 120s — generous for LLM latency
  removeOnComplete: { count: 500 },
  removeOnFail: false        // retain for debug
}
```

**Workflow steps:**
1. Load tenant LLM config from Redis (or master DB).
2. Load form definition from tenant DB (by `formDefinitionId + formVersion`).
3. If `llmEnabled = false` → set `workflowState = QA_PENDING`, enqueue `WorkflowQueue` entry, emit `notify:send[qa_pending]`, exit.
4. Build schema-validated LLM prompt from form + conversation content.
5. Call LLM via router. On rate limit → use backup provider. On hard failure → retry.
6. Validate LLM response against form schema (reject malformed outputs).
7. Compute `aiScore`, `confidenceScore`, `sectionScores` using scoring algorithm.
8. Store `aiResponseData` (immutable), `aiMetadata`, `aiScore`, `confidenceScore`, `workflowState = AI_COMPLETED`.
9. Evaluate confidence routing:
   - `< 0.6` → `isEscalated = true`, `priority = 1`
   - else → `priority = 5`
10. Insert `WorkflowQueue` entry (`QA_QUEUE`).
11. Emit `notify:send[qa_pending]`.
12. Increment `UsageMetric` (tokens + cost) via `billing:usage-sync`.

**On permanent failure (attempts exhausted):**
- Set `workflowState = AI_FAILED`, `ConvStatus = FAILED`.
- Enqueue `notify:send[eval_failed]`.
- Log structured error to observability.

---

## JOB: `eval:escalate`

**Enqueued by:** `eval:process` worker or `POST /evaluations/:id/qa-submit`
**Worker responsibility:** evaluate deviation against tenant escalation rules → escalate if threshold breached → create audit case

```typescript
interface EvalEscalateJobPayload {
  tenantId:       string;
  evaluationId:   string;
  deviationType:  "AI_VS_QA" | "QA_VS_VERIFIER";
  deviation:      number;
  triggeredBy:    string;   // userId
}

// Job options
{
  attempts: 3,
  backoff: { type: "fixed", delay: 2000 },
  timeout: 30_000
}
```

**Workflow steps:**
1. Fetch `EscalationRule` for tenant from Redis/master.
2. Compare `deviation` against rule threshold.
3. If threshold breached:
   - Set `isEscalated = true`, `escalationReason`.
   - Set `WorkflowQueue.priority = 1` (high priority).
   - Emit `notify:send[escalation_triggered]` to ADMIN + assigned VERIFIER.
   - Write `AuditLog` entry with action `"escalation.triggered"`.
4. If `deviationType = QA_VS_VERIFIER` and deviation > `verifierDeviationThreshold`:
   - Create `AuditLog` entry with action `"audit_case.created"`.
   - Emit `notify:send[audit_case_created]` to ADMIN.

---

## JOB: `queue:stale-check` (cron, every hour)

**Enqueued by:** Cron scheduler
**Worker responsibility:** detect WorkflowQueue entries past their `dueBy` SLO deadline

```typescript
interface StaleCheckJobPayload {
  tenantId: string;   // one job per tenant, or batch
}

// Job options
{
  attempts: 2,
  timeout: 60_000,
  repeat: { cron: "0 * * * *" }   // every hour
}
```

**Workflow steps:**
1. Query `WorkflowQueue` where `dueBy < now()` and queue is active.
2. For each stale entry:
   - Bump priority to 1.
   - Emit `notify:send[queue_stale]` to ADMIN.
   - Write `AuditLog` entry with action `"queue.stale_escalated"`.

---

## JOB: `tenant:provision`

**Enqueued by:** `POST /auth/signup` (after payment success or trial start)
**Worker responsibility:** create tenant DB, run migrations, seed defaults

```typescript
interface TenantProvisionJobPayload {
  tenantId:    string;
  tenantSlug:  string;
  adminUserId: string;
  plan:        "BASIC" | "PRO" | "ENTERPRISE";
}

// Job options
{
  attempts: 2,
  backoff: { type: "fixed", delay: 10_000 },
  timeout: 300_000           // 5 min for DB creation
}
```

**Workflow steps:**
1. Generate secure DB name, user, and password.
2. Run `CREATE DATABASE` + `CREATE USER` + privilege grants on DB host.
3. Encrypt DB password using platform master key (AES-256-GCM).
4. Store `dbHost, dbPort, dbName, dbUser, dbPasswordEnc` on `Tenant` record.
5. Run Prisma tenant migrations against new DB (`prisma migrate deploy`).
6. Seed defaults:
   - Mark admin user as `ACTIVE` (was `INVITED` at signup).
   - Insert default `EscalationRule`.
   - Insert default `BlindReviewSettings`.
   - Insert starter form template (DRAFT status).
7. Set `Tenant.status = ACTIVE`.
8. Emit `notify:send[tenant_ready]` to admin email.

**On permanent failure:**
- Set `Tenant.status = PROVISIONING` (stays stuck — ops alert triggered).
- Emit `notify:send[provision_failed]` to platform ops.

---

## JOB: `billing:usage-sync`

**Enqueued by:** `eval:process` worker after each successful evaluation
**Worker responsibility:** increment usage counters in master DB

```typescript
interface BillingUsageSyncJobPayload {
  tenantId:      string;
  periodStart:   string;   // ISO date — start of current billing period
  periodEnd:     string;   // ISO date — end of current billing period
  delta: {
    conversationsProcessed: number;
    aiTokensUsed:           number;
    aiCostCents:            number;
  };
}

// Job options
{
  attempts: 5,
  backoff: { type: "exponential", delay: 1000 },
  timeout: 15_000
}
```

**Workflow steps:**
1. Upsert `UsageMetric` for `(tenantId, periodStart, periodEnd)` using atomic increment.
2. Read updated totals.
3. Compare against plan limits.
4. If limit reached within 20%: emit `notify:send[usage_warning]`.
5. If limit exceeded: emit `notify:send[usage_limit_reached]` + optionally set feature gate.

---

## JOB: `notify:send`

**Enqueued by:** any worker or API layer
**Worker responsibility:** deliver email and/or in-app notification

```typescript
interface NotifySendJobPayload {
  tenantId:    string;
  type:        NotificationType;
  recipientIds: string[];         // user IDs from master DB
  data:        Record<string, unknown>;  // template variables
}

type NotificationType =
  | "qa_pending"
  | "verifier_pending"
  | "escalation_triggered"
  | "audit_case_created"
  | "queue_stale"
  | "eval_failed"
  | "tenant_ready"
  | "provision_failed"
  | "usage_warning"
  | "usage_limit_reached"
  | "export_ready"
  | "password_reset"
  | "user_invited";

// Job options
{
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
  timeout: 30_000
}
```

**Workflow steps:**
1. Resolve recipient user records from master DB.
2. Render template using `type` + `data` variables.
3. Send via email provider (SES / SendGrid / SMTP).
4. Optionally write in-app notification record to tenant DB.

---

## JOB: `report:export`

**Enqueued by:** `POST /analytics/export`
**Worker responsibility:** generate CSV or PDF report and store in object storage

```typescript
interface ReportExportJobPayload {
  tenantId:    string;
  jobId:       string;         // for polling via GET /jobs/:jobId
  requesterId: string;
  type:        "csv" | "pdf";
  report:      "agent_performance" | "qa_accuracy" | "deviation_trends" | "audit_log";
  from:        string;
  to:          string;
  filters:     Record<string, unknown>;
}

// Job options
{
  attempts: 2,
  timeout: 300_000             // 5 min for large exports
}
```

**Workflow steps:**
1. Mark job status = `processing` in Redis.
2. Query tenant DB for report data (use read replica if available).
3. Render report (CSV: stream rows; PDF: use headless render or template engine).
4. Upload to S3/GCS with time-limited signed URL (TTL 1 hour).
5. Mark job status = `completed`, store `downloadUrl`.
6. Emit `notify:send[export_ready]` to requester.

---

## JOB: `pool:reap` (cron, every 15 minutes)

**Enqueued by:** Cron scheduler
**Worker responsibility:** disconnect and evict idle tenant DB connection pools

```typescript
interface PoolReapJobPayload {}   // no payload — internal-only

// Job options
{
  attempts: 1,
  timeout: 30_000,
  repeat: { cron: "*/15 * * * *" }
}
```

**Workflow steps:**
1. Iterate all cached pool entries in Redis.
2. For each pool with `lastUsed < now() - 30 min`:
   - Call `prismaClient.$disconnect()`.
   - Delete entry from Redis pool cache.
3. Emit metrics: `pools_reaped_count`, `active_pools_count`.

---

## Job Error Taxonomy

| Error Class | Retry | Action |
|---|---|---|
| `LLMRateLimitError` | Yes, with backoff | Failover to backup provider first |
| `LLMResponseSchemaError` | No | Mark AI_FAILED, log for prompt tuning |
| `TenantDbConnectionError` | Yes (3x) | Alert ops if exhausted |
| `TenantNotFoundError` | No | Hard fail — log security alert |
| `PlanLimitExceededError` | No | Reject job, notify tenant |
| `TransientNetworkError` | Yes | Standard exponential backoff |
| `ProvisioningError` | Yes (2x) | Alert platform ops on exhaustion |
