# API Contract List

All routes are prefixed with `/api/v1`.
All authenticated routes require `Authorization: Bearer <access_token>`.
Tenant is resolved from the JWT `tenantId` claim — never from a URL parameter.

**Standard response envelope:**
```json
{
  "data": { ... },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

**Standard error envelope:**
```json
{
  "error": {
    "code": "FORM_NOT_FOUND",
    "message": "Form definition not found",
    "details": []
  },
  "meta": { "requestId": "...", "timestamp": "..." }
}
```

---

## AUTH

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/auth/signup` | None | — | Register new tenant + admin user (triggers provisioning) |
| POST | `/auth/login` | None | — | Email/password login → access + refresh tokens |
| POST | `/auth/refresh` | Refresh token | — | Rotate access token using refresh token |
| POST | `/auth/logout` | Bearer | Any | Revoke current refresh token |
| POST | `/auth/forgot-password` | None | — | Send password reset email |
| POST | `/auth/reset-password` | None | — | Consume reset token + set new password |
| GET | `/auth/me` | Bearer | Any | Return current user profile |

### POST /auth/signup
```
Request:
  tenantName: string (required)
  tenantSlug: string (required, URL-safe, unique)
  adminEmail:  string (required)
  adminName:   string (required)
  password:    string (required, min 12 chars)
  plan:        "BASIC" | "PRO" | "ENTERPRISE" (required)

Response 201:
  { accessToken, refreshToken, tenant: { id, slug, name, plan } }

Errors: 409 TENANT_SLUG_TAKEN, 422 VALIDATION_ERROR
```

### POST /auth/login
```
Request:
  email:    string
  password: string

Response 200:
  { accessToken, refreshToken, user: { id, name, email, role } }

Errors: 401 INVALID_CREDENTIALS, 403 ACCOUNT_SUSPENDED
```

### POST /auth/refresh
```
Request (body or httpOnly cookie):
  refreshToken: string

Response 200:
  { accessToken, refreshToken }

Errors: 401 TOKEN_EXPIRED, 401 TOKEN_REVOKED
```

---

## USERS

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/users` | Bearer | ADMIN | List all users in tenant |
| POST | `/users/invite` | Bearer | ADMIN | Invite user by email (sends invite link) |
| GET | `/users/:id` | Bearer | ADMIN | Get user details |
| PATCH | `/users/:id` | Bearer | ADMIN | Update name / role / status |
| DELETE | `/users/:id` | Bearer | ADMIN | Deactivate user (soft delete) |

### POST /users/invite
```
Request:
  email: string
  name:  string
  role:  "QA" | "VERIFIER" | "ADMIN"

Response 201:
  { user: { id, email, role, status: "INVITED" } }

Errors: 409 USER_ALREADY_EXISTS, 403 PLAN_USER_LIMIT_REACHED
```

### PATCH /users/:id
```
Request (all optional):
  name:   string
  role:   UserRole
  status: "ACTIVE" | "INACTIVE"

Response 200:
  { user }

Errors: 404 USER_NOT_FOUND, 403 CANNOT_DEMOTE_LAST_ADMIN
```

---

## LLM CONFIG

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/llm-config` | Bearer | ADMIN | Get tenant LLM config (API key masked) |
| PUT | `/llm-config` | Bearer | ADMIN | Set or update LLM config |
| POST | `/llm-config/test` | Bearer | ADMIN | Test connectivity to configured LLM |

### PUT /llm-config
```
Request:
  enabled:         boolean
  provider:        "OPENAI" | "AZURE_OPENAI" | "CUSTOM"
  model:           string
  endpoint:        string? (required if CUSTOM)
  apiKey:          string  (plaintext — encrypted server-side)
  backupProvider:  LlmProvider?
  backupModel:     string?
  backupApiKey:    string?
  maxTokens:       number?
  temperature:     number?

Response 200:
  { llmConfig: { id, enabled, provider, model, endpoint } } // apiKey never returned

Errors: 422 VALIDATION_ERROR, 403 PLAN_DOES_NOT_SUPPORT_BYO_LLM
```

---

## FORMS

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/forms` | Bearer | ADMIN | List form definitions (latest version per formKey) |
| POST | `/forms` | Bearer | ADMIN | Create new draft form |
| GET | `/forms/:id` | Bearer | ADMIN, QA, VERIFIER | Get single form definition |
| PATCH | `/forms/:id` | Bearer | ADMIN | Update draft form (DRAFT status only) |
| POST | `/forms/:id/publish` | Bearer | ADMIN | Publish form (creates immutable version) |
| POST | `/forms/:id/deprecate` | Bearer | ADMIN | Mark published form as deprecated |
| GET | `/forms/:formKey/versions` | Bearer | ADMIN | List all versions for a formKey |
| POST | `/forms/:id/clone` | Bearer | ADMIN | Clone published form as new draft |
| POST | `/forms/preview-score` | Bearer | ADMIN | Dry-run scoring computation for a form + sample answers |

### POST /forms
```
Request:
  formKey:         string  (stable business key)
  name:            string
  description:     string?
  channels:        Channel[]
  scoringStrategy: ScoringStrategyConfig
  sections:        FormSection[]
  questions:       FormQuestion[]

Response 201:
  { form: { id, formKey, version: 1, status: "DRAFT", ... } }

Errors: 422 VALIDATION_ERROR, 403 PLAN_FORM_LIMIT_REACHED
```

### POST /forms/:id/publish
```
Request: {} (no body — publish is a state transition)

Response 200:
  { form: { id, status: "PUBLISHED", publishedAt, version } }

Errors: 409 ALREADY_PUBLISHED, 422 FORM_HAS_NO_QUESTIONS
```

### POST /forms/preview-score
```
Request:
  formId:  string
  answers: { [questionKey]: any }

Response 200:
  {
    sectionScores: { [sectionId]: number },
    overallScore:  number,
    passFail:      boolean,
    computation:   { ... }  // full audit trace of scoring steps
  }
```

---

## CONVERSATIONS

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/conversations` | Bearer | ADMIN | Ingest single conversation |
| POST | `/conversations/bulk` | Bearer | ADMIN | Bulk ingest (CSV/JSON upload) |
| GET | `/conversations` | Bearer | ADMIN, QA, VERIFIER | List conversations (paginated, filtered) |
| GET | `/conversations/:id` | Bearer | Any | Get single conversation |

### POST /conversations
```
Request:
  channel:     Channel
  agentId:     string?
  agentName:   string?
  customerRef: string?
  externalId:  string?   (for dedup)
  content:     object    (normalized conversation body)
  metadata:    object?
  receivedAt:  datetime?

Response 201:
  { conversation: { id, status: "PENDING" } }
  // Automatically enqueues eval:process job

Errors: 409 DUPLICATE_EXTERNAL_ID, 422 VALIDATION_ERROR
```

### GET /conversations
```
Query params:
  page:        number (default 1)
  limit:       number (default 20, max 100)
  channel:     Channel?
  status:      ConvStatus?
  agentId:     string?
  from:        datetime?
  to:          datetime?

Response 200:
  { data: Conversation[], meta: { total, page, limit } }
```

---

## EVALUATIONS

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/evaluations` | Bearer | ADMIN, QA, VERIFIER | List evaluations (paginated + filtered) |
| GET | `/evaluations/:id` | Bearer | Any | Get evaluation with full layered data |
| GET | `/evaluations/queue/qa` | Bearer | QA, ADMIN | QA work queue (pending + in-progress) |
| GET | `/evaluations/queue/verifier` | Bearer | VERIFIER, ADMIN | Verifier work queue |
| POST | `/evaluations/:id/qa-start` | Bearer | QA | Claim evaluation for QA review |
| POST | `/evaluations/:id/qa-submit` | Bearer | QA | Submit QA adjustments |
| POST | `/evaluations/:id/verifier-start` | Bearer | VERIFIER | Claim evaluation for verifier review |
| POST | `/evaluations/:id/verifier-approve` | Bearer | VERIFIER | Approve QA result (lock evaluation) |
| POST | `/evaluations/:id/verifier-modify` | Bearer | VERIFIER | Modify + approve (locks evaluation) |
| POST | `/evaluations/:id/verifier-reject` | Bearer | VERIFIER | Reject back to QA with reason |
| GET | `/evaluations/:id/audit` | Bearer | ADMIN, VERIFIER | Full audit log for evaluation |

### GET /evaluations/queue/qa
```
Query params:
  priority:     number?
  channel:      Channel?
  formKey:      string?
  page, limit

Response 200:
  {
    data: [{
      evaluationId, conversationId, channel, agentHash (if blind),
      formName, formVersion, aiScore, confidenceScore, priority, dueBy
    }],
    meta: { total, page, limit }
  }
```

### POST /evaluations/:id/qa-submit
```
Request:
  adjustedAnswers: {
    [questionKey]: {
      value:          any
      overrideReason: string  (required when changing AI answer)
    }
  }
  feedback: string?
  flags:    string[]?

Response 200:
  {
    evaluation: {
      id, workflowState: "QA_COMPLETED",
      qaScore, deviations: DeviationRecord[]
    }
  }

Errors:
  409 ALREADY_SUBMITTED
  409 NOT_CLAIMED_BY_YOU
  422 MISSING_OVERRIDE_REASON   (changed answer without reason)
```

### POST /evaluations/:id/verifier-modify
```
Request:
  modifiedAnswers: {
    [questionKey]: {
      value:          any
      overrideReason: string (required)
    }
  }
  feedback: string?

Response 200:
  {
    evaluation: {
      id, workflowState: "LOCKED",
      finalScore, passFail, lockedAt
    }
  }
```

### POST /evaluations/:id/verifier-reject
```
Request:
  reason: string (required)

Response 200:
  { evaluation: { id, workflowState: "QA_PENDING" } }
  // Returns to QA queue with rejection reason attached
```

---

## ANALYTICS

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/analytics/overview` | Bearer | ADMIN | High-level KPI summary |
| GET | `/analytics/agent-performance` | Bearer | ADMIN | Agent scores + pass rates + trends |
| GET | `/analytics/qa-accuracy` | Bearer | ADMIN | QA reviewer deviation analytics |
| GET | `/analytics/verifier-overrides` | Bearer | ADMIN | Verifier override patterns |
| GET | `/analytics/deviation-trends` | Bearer | ADMIN | AI vs QA vs Verifier deviation over time |
| GET | `/analytics/ai-costs` | Bearer | ADMIN | Token usage + cost by model/period |
| GET | `/analytics/form-performance` | Bearer | ADMIN | Per-question + per-section failure rates |
| POST | `/analytics/export` | Bearer | ADMIN | Enqueue export job (CSV or PDF) |

### GET /analytics/overview
```
Query params:
  from:    datetime (required)
  to:      datetime (required)
  channel: Channel?

Response 200:
  {
    totalConversations, completedEvaluations, pendingQA, pendingVerifier,
    avgFinalScore, passRate, avgAiQaDeviation, avgQaVerifierDeviation,
    aiCostCents, aiTokensUsed
  }
```

### POST /analytics/export
```
Request:
  type:    "csv" | "pdf"
  report:  "agent_performance" | "qa_accuracy" | "deviation_trends" | "audit_log"
  from:    datetime
  to:      datetime
  filters: object?

Response 202:
  { jobId: string }
  // Poll GET /jobs/:jobId for status + download URL
```

---

## BILLING

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/billing/plans` | None | — | List available plans + feature matrix |
| GET | `/billing/subscription` | Bearer | ADMIN | Current subscription details |
| POST | `/billing/subscribe` | Bearer | ADMIN | Subscribe to a plan (create Stripe checkout session) |
| POST | `/billing/upgrade` | Bearer | ADMIN | Upgrade plan |
| POST | `/billing/cancel` | Bearer | ADMIN | Cancel subscription (at period end) |
| GET | `/billing/invoices` | Bearer | ADMIN | List invoices |
| GET | `/billing/usage` | Bearer | ADMIN | Current period usage vs limits |
| POST | `/billing/webhook` | None (Stripe sig) | — | Stripe webhook endpoint |

### POST /billing/subscribe
```
Request:
  planType:    PlanType
  successUrl:  string
  cancelUrl:   string

Response 201:
  { checkoutUrl: string }  // Stripe hosted checkout

Errors: 409 ALREADY_SUBSCRIBED
```

### POST /billing/webhook
```
Headers:
  stripe-signature: string (verified server-side with STRIPE_WEBHOOK_SECRET)

Handled events:
  checkout.session.completed    → activate subscription
  invoice.paid                   → record invoice + reset usage
  invoice.payment_failed         → set PAST_DUE
  customer.subscription.deleted  → set CANCELLED
  customer.subscription.updated  → plan change

Response: 200 always (Stripe requires 2xx to stop retrying)
```

---

## TENANT PROVISIONING (Internal / Platform Admin)

> These routes are NOT exposed to tenant users.
> Protected by platform admin token, used by provisioning worker.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/internal/tenants/:id/provision` | Create tenant DB, run migrations, seed defaults |
| POST | `/internal/tenants/:id/suspend` | Suspend tenant access |
| POST | `/internal/tenants/:id/reactivate` | Reactivate suspended tenant |
| GET | `/internal/tenants/:id/health` | Check tenant DB connectivity + pool status |

---

## JOBS (Async Results Polling)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/jobs/:jobId` | Bearer | Poll async job status (exports, provisioning, etc.) |

```
Response 200:
  {
    jobId, type, status: "pending" | "processing" | "completed" | "failed",
    result: { downloadUrl? },
    error:  string?,
    createdAt, completedAt
  }
```

---

## Common HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 201 | Created |
| 202 | Accepted (async started) |
| 400 | Bad request |
| 401 | Unauthenticated |
| 403 | Forbidden (RBAC or feature gate) |
| 404 | Not found |
| 409 | Conflict (duplicate, wrong state) |
| 422 | Validation error |
| 429 | Rate limited |
| 500 | Internal server error |
| 503 | Service unavailable (LLM down, DB pool exhausted) |
