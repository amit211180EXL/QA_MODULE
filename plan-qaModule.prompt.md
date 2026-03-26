# PRODUCT VISION

Build a multi-tenant SaaS QA platform that evaluates customer interactions (chat, email, calls, social media) using 3 levels:

1. Level 1: AI Evaluation (auto baseline)
2. Level 2: QA Review (human correction)
3. Level 3: Verifier Review (final authority)

Final score is locked after verifier approval/modification.

Core goals:
- reduce bias using AI baseline + verifier checks
- enforce consistency across reviewers
- support tenant-specific QA standards through dynamic forms
- support optional LLM usage (QA-direct mode if LLM disabled)

---

# CORE WORKFLOW

Conversation received
  ↓
Fetch tenant LLM config
  ↓
Fetch tenant published QA form
  ↓
AI fills tenant form (or skip AI if disabled)
  ↓
Store evaluation
  ↓
QA review queue
  ↓
Verifier review
  ↓
Final score locked
  ↓
Reports & analytics
  ↓
Continuous learning loop

If LLM disabled:
- skip AI
- QA evaluates directly
- verifier flow remains unchanged

---

# MULTI-TENANT ARCHITECTURE

## Pattern
- Master DB (shared)
- Tenant DB (one per customer)

## Master DB stores
- tenants
- users
- subscriptions/plans
- LLM configs
- escalation rules
- blind review settings
- usage/billing metrics

## Tenant DB stores
- conversations
- form_definitions (versioned)
- form_responses
- evaluations
- ai/qa/verifier records
- workflow states
- audit logs

Strict isolation:
- every request resolves tenant first
- no cross-tenant query path
- tenant-aware logging and metrics

---

# USER & ROLE SYSTEM

Tenant admin manages roles and users.

Roles:
1. Admin
- manage users
- configure LLM
- create/publish QA forms
- configure escalation/blind-review settings
- view all analytics

2. QA
- review AI evaluations
- accept/modify answers
- add feedback/flags
- submit to verifier

3. Verifier
- final decision
- approve QA
- modify final score
- reject and send back with reason

RBAC enforced at API middleware + UI visibility.

---

# DYNAMIC QA FORMS (MOST IMPORTANT)

Each tenant has custom QA scorecards.
AI must fill tenant-defined form schema (not generic scoring).

## Form builder requirements
- draft → publish workflow
- published versions immutable
- versioning with audit safety
- question-level rubric and validation
- weighted sections
- conditional logic support

## Supported question types
- rating
- boolean
- text
- select
- multiselect
- weighted section

## Form ownership
- tenant-local in tenant DB
- each evaluation references exact form version used

## Layered response model
- ai_response_data (immutable baseline)
- qa_adjusted_data (delta changes)
- verifier_final_data
- final_response_data (resolved)

---

# QA FORM JSON CONTRACT (CANONICAL)

FormDefinition shape must include:
- formId, tenantId, name, version, status
- channels
- scoring strategy (weighted sections)
- sections[] with weights/order
- questions[] with:
  - id, key, type, required, weight
  - validation rules
  - rubric goal/anchors
  - options for select/multiselect
- metadata (createdBy, publishedAt, etc.)

Evaluation response shape must include:
- evaluationId, formId, formVersion, tenantId, conversationId
- answers keyed by question key
- reasoning + confidence per question
- section scores + overall score
- flags, feedback
- ai metadata (provider/model/tokens/cost)

---

# FORM SCORING ALGORITHM (DETERMINISTIC)

1. Normalize each question to 0..100
2. Compute section score using question weights
3. Compute overall score using section weights
4. Apply scale and rounding policy
5. Determine pass/fail by threshold
6. Persist intermediate computations for audit

Rules:
- published form + same answers = same score always
- no hidden non-deterministic scoring paths

---

# VERSIONING LIFECYCLE

States:
- draft
- published
- deprecated
- archived

Rules:
- only drafts editable
- publish creates immutable version
- evaluations use published versions only
- historical evaluations remain pinned to original formVersion
- no in-place mutation of published schema

---

# SMART LOGIC

## Deviation tracking
- AI vs QA
- QA vs Verifier

Use for:
- weak reviewer detection
- strict verifier detection
- AI gap discovery by category/form

## Auto escalation
- QA deviation > 15 points → high priority to verifier
- Verifier deviation > 10 points → create audit case
- timeout escalations for stale queues

## Confidence routing
- confidence < 0.6 → mandatory QA + verifier
- 0.6–0.9 → normal flow
- > 0.9 → optional QA skip (feature flag, future)

## Blind review
- hide agent identity/history from QA (optional)
- hide QA identity from verifier (optional)
- API-layer anonymization using deterministic hash

---

# LLM INTEGRATION (BYO + MULTI PROVIDER)

LLM router supports:
- OpenAI
- Azure OpenAI
- custom endpoints (Enterprise)

Flow:
- select provider by tenant config + availability + cost + rate limits
- failover to backup provider on errors/rate limits
- track token usage + cost per tenant

LLM optional:
- if disabled at tenant level, QA-direct evaluation path is used

---

# DATA INGESTION

Support:
1. Upload (CSV/JSON)
2. API integrations (CRM/chat tools, webhooks)
3. Call transcripts (upload/STT integrations)

All ingestion paths normalize into unified conversation schema.

---

# WEBSITE → SIGNUP → PLAN → PAYMENT FLOW

Funnel:
Website → Sign Up → Choose Plan → Payment → Tenant Created

After payment success:
1. create tenant DB
2. run migrations
3. store encrypted DB credentials
4. activate subscription
5. seed defaults (admin user + default form + sample template)

First login onboarding:
- configure LLM
- create/edit QA forms
- invite QA + verifier users
- upload first conversation

---

# SAAS LICENSING MODEL

## Basic
- limited conversations/month
- fixed AI model
- limited forms/users
- no advanced verifier/analytics

## Pro
- custom forms
- QA + verifier roles
- analytics dashboards
- higher usage limits

## Enterprise
- BYO-LLM
- dedicated infrastructure
- advanced reporting
- enterprise controls (SSO/compliance/private networking)

Feature gates enforced in API middleware and UI.

Tracked usage:
- conversations processed
- AI usage (tokens/cost)
- active user count

---

# BILLING LIFECYCLE

Trial starts
  ↓
Usage tracked continuously
  ↓
Upgrade / downgrade
  ↓
Renew / expire

Include:
- metered usage tracking
- plan limits + overage handling
- dunning/retry for failed payments
- subscription events timeline

---

# SCALABILITY REQUIREMENTS

Must scale by:
- tenants
- conversation volume
- concurrent users
- AI throughput
- reporting load

Architecture requirements:
- stateless horizontally scaled API
- queue-based workers with autoscaling
- per-tenant DB connection pooling
- Redis caching for hot configs/schemas
- read scaling for analytics
- backpressure + graceful degradation

SLO baselines:
- non-AI API p95 < 300ms
- evaluation completion p95 < 60s
- high availability per plan tier

---

# TENANT DB CONNECTION OPTIMIZATION

Problem:
- opening DB connections per request is slow and expensive

Solution:
- per-tenant connection pooling

Optimization strategy:
- cache tenant DB config in Redis
- lazy-load pool on first tenant request
- reuse pools
- close inactive pools via reaper job
- plan-based pool sizing
- pool health metrics + alerts

---

# SECURITY & COMPLIANCE

- strict tenant isolation
- encrypted secrets/API keys
- TLS in transit + encryption at rest
- RBAC and audit trails
- SOC2/GDPR readiness
- optional HIPAA path

---

# ANALYTICS & REPORTING

Admin dashboard must show:
- agent performance
- QA accuracy
- verifier overrides
- AI vs human deviation
- score trends by form/channel/team
- AI usage/cost trends

Exports:
- CSV
- PDF
- audit log exports

---

# CONTINUOUS IMPROVEMENT LOOP

Verifier decisions
  ↓
QA coaching + rubric refinements
  ↓
prompt tuning/model routing changes
  ↓
improved AI quality over time

Track:
- top overridden questions
- common rejection reasons
- high-deviation sections
- confidence calibration quality

---

# PHASED EXECUTION PLAN

## Phase 1 (Foundation)
- monorepo
- auth + RBAC
- tenant provisioning
- base schemas
- onboarding shell

## Phase 2 (Evaluation Core)
- form engine + versioning
- AI form filling
- queue workers + retries
- LLM routing/failover
- confidence routing

## Phase 3 (QA Layer)
- QA dashboard
- dynamic form edits
- deviation tracking
- escalation engine
- blind review

## Phase 4 (Verifier + Analytics)
- verifier workflow and final lock
- audit cases
- analytics dashboards
- exports

## Phase 5 (Hardening + SaaS)
- billing automation
- multi-channel integrations
- scalability hardening
- dedicated enterprise infra
- advanced compliance/reporting

---

# IMPLEMENTATION STYLE (IMPORTANT)

When generating code/specs from this prompt:
1. prioritize production-grade patterns
2. keep API contracts explicit
3. include validation and error handling
4. include migration-safe database design
5. include observability hooks
6. never break tenant isolation
7. keep AI output schema-validated and deterministic
8. provide development sequence in incremental milestones

---

# IMMEDIATE NEXT OUTPUT NEEDED

Generate:
1. final technical architecture diagram (text + Mermaid)
2. master DB + tenant DB Prisma schemas
3. API contract list (auth, forms, evaluations, workflow, billing)
4. queue job contracts
5. Phase 1 task breakdown by week (week 1–4)
