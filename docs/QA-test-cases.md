# QA Test Cases — Manual UI Testing Guide

**Application:** QA Module  
**Base URL:** `http://localhost:3001`  
**API Base:** `http://localhost:3000/api/v1`  
**Test Date:** April 2026  
**Prepared by:** QA Engineering  

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Dashboard](#2-dashboard)
3. [Conversation Upload](#3-conversation-upload)
4. [Conversations List](#4-conversations-list)
5. [QA Queue — Claim & Review](#5-qa-queue--claim--review)
6. [QA Queue — LLM Disabled Path](#6-qa-queue--llm-disabled-path)
7. [Verifier Queue — Claim & Approve](#7-verifier-queue--claim--approve)
8. [Escalation Flow](#8-escalation-flow)
9. [Settings — LLM Configuration](#9-settings--llm-configuration)
10. [Settings — Blind Review](#10-settings--blind-review)
11. [Settings — Escalation Rules](#11-settings--escalation-rules)
12. [Users Management](#12-users-management)
13. [Analytics](#13-analytics)
14. [Plan Limits & Billing](#14-plan-limits--billing)
15. [Error & Edge Cases](#15-error--edge-cases)

---

## Test Environment Setup

| Item | Value |
|---|---|
| Admin credentials | `admin@dev.local` / `DevAdmin123!` |
| Tenant slug | `dev-tenant` |
| QA user | Create via Users page |
| Verifier user | Create via Users page |
| Ports | API: 3000, Web: 3001 |

---

## 1. Authentication

### TC-AUTH-001 — Successful Login

**Page:** `/login`  
**Role:** Any

| Step | Action | Expected Result |
|---|---|---|
| 1 | Open `http://localhost:3001/login` | Login page loads with Email, Password, and optional Workspace Slug fields |
| 2 | Enter `admin@dev.local` in Email | Field accepts input |
| 3 | Enter `DevAdmin123!` in Password | Input is masked |
| 4 | Enter `dev-tenant` in Workspace Slug | Field accepts input |
| 5 | Click **Sign in** | Loading spinner appears on button |
| 6 | Wait for redirect | Redirected to `/dashboard`. Header shows user name |

---

### TC-AUTH-002 — Login with Wrong Password

**Page:** `/login`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Enter valid email, wrong password | — |
| 2 | Click **Sign in** | Red error alert: "Invalid credentials" or similar message appears below the form header |
| 3 | Page stays on `/login` | No redirect occurs |

---

### TC-AUTH-003 — Login with Non-Existent Email

**Page:** `/login`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Enter `nobody@example.com` as email | — |
| 2 | Enter any password and click **Sign in** | Error alert appears: invalid credentials |

---

### TC-AUTH-004 — Login with Suspended Account

**Pre-condition:** User account status set to INACTIVE in DB.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Log in with suspended user credentials | Error alert: account suspended or access denied |

---

### TC-AUTH-005 — Form Validation (Empty Fields)

**Page:** `/login`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Leave Email blank, click **Sign in** | Inline validation: "Enter a valid email" |
| 2 | Fill Email, leave Password blank, click **Sign in** | Inline validation: "Password is required" |

---

### TC-AUTH-006 — Forgot Password Link

**Page:** `/login`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Click **Forgot password?** | Navigates to `/forgot-password` |
| 2 | Enter email and submit | Confirmation message shown |

---

### TC-AUTH-007 — Session Persistence (Refresh)

| Step | Action | Expected Result |
|---|---|---|
| 1 | Log in successfully | User lands on dashboard |
| 2 | Press F5 to refresh | Page reloads; user remains logged in, not redirected to login |

---

### TC-AUTH-008 — Logout

| Step | Action | Expected Result |
|---|---|---|
| 1 | Click user avatar / name in top navigation | Dropdown or logout button visible |
| 2 | Click **Logout** | Session cleared; redirected to `/login` |
| 3 | Press browser back button | Redirected back to `/login`, not to the previous authenticated page |

---

## 2. Dashboard

### TC-DASH-001 — KPI Cards Render

**Page:** `/dashboard`  
**Role:** Admin

| Step | Action | Expected Result |
|---|---|---|
| 1 | Log in and navigate to Dashboard | 7 KPI cards visible: Conversations, Pending QA, Pending Verifier, Escalated, Avg Score, Pass Rate, AI↔QA Deviation |
| 2 | Verify values show numbers or `—` | No blank/broken cards; loading state resolves within 5 seconds |
| 3 | Verify Escalated card highlights orange | If any escalations are pending, card border and text are orange |

---

### TC-DASH-002 — Get Started Banner

| Step | Action | Expected Result |
|---|---|---|
| 1 | View dashboard on fresh tenant | "Get started" banner visible with **Configure LLM** and **Create QA Form** buttons |
| 2 | Click **Configure LLM** | Navigates to `/settings/llm` |
| 3 | Go back, click **Create QA Form** | Navigates to `/forms/new` |

---

## 3. Conversation Upload

### TC-UPLOAD-001 — Upload JSON via Conversations Page (Modal)

**Page:** `/conversations`  
**Role:** Admin

| Step | Action | Expected Result |
|---|---|---|
| 1 | Click **Upload** button | Upload modal appears with Channel selector and file drop zone |
| 2 | Select channel **CHAT** from dropdown | Channel dropdown shows CHAT, EMAIL, CALL, SOCIAL options |
| 3 | Click the drop zone | OS file picker opens |
| 4 | Select a valid JSON file containing an array of conversation objects | File name shown in the drop zone |
| 5 | Click **Upload** | Loading state on button; success notification or modal closes |
| 6 | Conversations list refreshes | Uploaded conversations visible in the table with status `PENDING` or `QA REVIEW` (LLM disabled) or `EVALUATING` (LLM enabled) |

---

### TC-UPLOAD-002 — Upload Invalid JSON File

**Page:** `/conversations` → Upload modal

| Step | Action | Expected Result |
|---|---|---|
| 1 | Open upload modal | — |
| 2 | Select a `.txt` or malformed JSON file | Parse error displayed: "Invalid JSON file — could not parse." |
| 3 | Upload button disabled | Cannot submit until valid file is selected |

---

### TC-UPLOAD-003 — Upload via Dedicated Upload Page (CSV)

**Page:** `/upload`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/upload` | Upload page loads with channel selector and file drop zone |
| 2 | Select channel | Dropdown shows: chat, email, call, social, other |
| 3 | Select a CSV file with `content` column | File name appears. Row count preview shown |
| 4 | Submit upload | Success confirmation with count of uploaded rows |
| 5 | Navigate to `/conversations` | Newly uploaded conversations appear in the list |

---

### TC-UPLOAD-004 — CSV Missing Required `content` Column

**Page:** `/upload`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Select a CSV file without a `content` column | Error displayed: "CSV must have a 'content' column. Found: …" |
| 2 | Upload button blocked | Cannot proceed |

---

### TC-UPLOAD-005 — Upload Empty Conversations Array

**Post-condition:** API should return `EMPTY_PAYLOAD` error.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Upload a JSON file containing `[]` (empty array) | Error message visible: payload cannot be empty |

---

### TC-UPLOAD-006 — Upload Exceeds 500 Conversations

| Step | Action | Expected Result |
|---|---|---|
| 1 | Attempt to upload a JSON file with 501 conversation objects | Error message: "Maximum 500 conversations per upload" |

---

### TC-UPLOAD-007 — Plan Limit Exceeded (BASIC Plan)

**Pre-condition:** Tenant on BASIC plan (500/month). 500 conversations already uploaded this month.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Attempt to upload any conversation | Error: "Monthly conversation limit of 500 reached. Upgrade your plan to continue." |

---

## 4. Conversations List

### TC-CONV-001 — List Page Renders

**Page:** `/conversations`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/conversations` | Table with columns: ID, Channel, Agent, Customer, Status, Score, Received |
| 2 | Verify status badges | Each row shows a coloured badge: PENDING (grey), QA REVIEW (yellow), VERIFIER REVIEW (purple), COMPLETED (green), FAILED (red) |
| 3 | Verify pagination | Total count shown; pagination controls visible if more than 20 rows |

---

### TC-CONV-002 — Filter by Status

| Step | Action | Expected Result |
|---|---|---|
| 1 | Select `QA REVIEW` from status filter | Only conversations with `QA_REVIEW` status shown |
| 2 | Clear filter | All conversations shown |

---

### TC-CONV-003 — Click Through to Conversation Detail

| Step | Action | Expected Result |
|---|---|---|
| 1 | Click on a conversation row or ID | Navigates to `/conversations/[id]` |
| 2 | Detail page shows conversation content + linked evaluation status | Both conversation data and evaluation workflowState visible |

---

### TC-CONV-004 — LLM-Disabled Conversation Shows QA_REVIEW Immediately

**Pre-condition:** LLM is disabled in Settings → LLM.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Upload a new conversation | Row appears in list |
| 2 | Check status badge | Badge shows `QA REVIEW` (yellow) — NOT `EVALUATING` |
| 3 | Navigate to QA Queue | Conversation's evaluation appears in QA Queue immediately |

---

## 5. QA Queue — Claim & Review

### TC-QA-001 — QA Queue Loads with Items

**Page:** `/qa-queue`  
**Role:** QA / Admin

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/qa-queue` | Page heading "QA Queue" visible. Count shows "N items awaiting review" |
| 2 | Table rows present | Columns: Conversation, Channel, Agent, AI Score, State, Action |
| 3 | Items have **Review** button | Button visible per row |

---

### TC-QA-002 — Empty Queue State

**Pre-condition:** No evaluations in QA_PENDING state.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/qa-queue` | Empty state: clipboard icon + "Queue is empty" message |
| 2 | "Go to Conversations" link visible | Clicking it navigates to `/conversations` |

---

### TC-QA-003 — Claim (Start) an Evaluation

**Page:** `/qa-queue`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Click **Review** on any queued item | Navigates to `/qa-queue/[evaluationId]` |
| 2 | Page shows evaluation form with AI-filled answers | Form questions rendered; AI answers pre-populated (if LLM enabled) |
| 3 | Evaluation state in header/badge shows `QA_IN_PROGRESS` | State badge updated |

---

### TC-QA-004 — Submit QA Review (Agree with AI)

**Page:** `/qa-queue/[id]`

| Step | Action | Expected Result |
|---|---|---|
| 1 | View AI-populated answers | All answers visible |
| 2 | Make no changes (agree with AI) | No override reason required |
| 3 | Click **Submit review** | Loading state; success redirect |
| 4 | Check Verifier Queue | Evaluation appears in Verifier Queue |
| 5 | Evaluation badge | State shows `QA_COMPLETED` |

---

### TC-QA-005 — Submit QA Review (Override AI Answer, No Reason = Error)

**Page:** `/qa-queue/[id]`  
**Pre-condition:** AI evaluated with a boolean or rating answer.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Change a question answer from AI's value | Override reason field appears |
| 2 | Do NOT fill the override reason | — |
| 3 | Click **Submit review** | Error: "Question '[key]' value changed without overrideReason" (inline or toast) |
| 4 | Submission blocked | Evaluation remains `QA_IN_PROGRESS` |

---

### TC-QA-006 — Submit QA Review (Override with Reason = Success)

**Page:** `/qa-queue/[id]`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Change a question answer | Override reason text box appears |
| 2 | Fill in the override reason | — |
| 3 | Click **Submit review** | Submission succeeds; redirect to queue |
| 4 | Deviation recorded | A deviation record is created (verifiable in analytics or audit log) |

---

### TC-QA-007 — Another User Cannot Submit Another User's Claimed Evaluation

**Pre-condition:** User A has claimed evaluation E1.  
**Role:** User B (also QA)

| Step | Action | Expected Result |
|---|---|---|
| 1 | User B opens `/qa-queue/[id for E1]` | Page may load read-only |
| 2 | User B clicks **Submit review** | Error: "This evaluation was not claimed by you" |

---

## 6. QA Queue — LLM Disabled Path

### TC-QALLM-001 — Evaluation Starts in QA_PENDING (No AI Pre-fill)

**Pre-condition:** LLM is disabled in Settings → LLM.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Upload a conversation | Evaluation created with `QA_PENDING` state immediately |
| 2 | Navigate to QA Queue | Item appears in queue without waiting for AI |
| 3 | Click **Review** | Evaluation form opens with ALL answers blank (no AI pre-fill) |

---

### TC-QALLM-002 — No Override Reason Required When LLM Disabled

**Page:** `/qa-queue/[id]`  
**Pre-condition:** LLM is disabled; evaluation has no AI data.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Fill any answer on the form | No "override reason" prompt appears (there is no AI answer to override) |
| 2 | Submit the form | Submission succeeds without providing override reasons |

---

### TC-QALLM-003 — No Escalation When LLM Disabled (No AI Score to Compare)

**Pre-condition:** LLM is disabled.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Submit QA review with any score | Evaluation moves to `QA_COMPLETED` |
| 2 | Check escalation queue | Evaluation is NOT escalated (no AI score to measure deviation against) |
| 3 | Evaluation placed in Verifier Queue | Normal verifier flow proceeds |

---

## 7. Verifier Queue — Claim & Approve

### TC-VER-001 — Verifier Queue Loads with Items

**Page:** `/verifier-queue`  
**Role:** Verifier / Admin

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/verifier-queue` | Page heading "Verifier Queue". Count: "N evaluations awaiting verifier review" |
| 2 | Table columns visible | Conversation, Channel, Agent, QA Score, AI Score, State, Submitted, Action |

---

### TC-VER-002 — Empty Verifier Queue State

**Pre-condition:** No QA-completed evaluations.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/verifier-queue` | Empty state: shield icon + "Queue is empty" message |
| 2 | Sub-text reads correctly | "Evaluations submitted by QA reviewers will appear here." |

---

### TC-VER-003 — Claim (Start) a Verifier Review

**Page:** `/verifier-queue`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Click **Review** on any item | Navigates to `/verifier-queue/[evaluationId]` |
| 2 | Page shows QA-adjusted answers + AI answers side-by-side | Both layers visible for comparison |
| 3 | State badge changes | Shows `VERIFIER_IN_PROGRESS` |

---

### TC-VER-004 — Approve Evaluation (Verifier)

**Page:** `/verifier-queue/[id]`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Review the QA-submitted answers | Answers visible, score displayed |
| 2 | Click **Approve** | Loading state; confirmation |
| 3 | Evaluation state → `LOCKED` | Redirect back to verifier queue |
| 4 | Conversation status → `COMPLETED` | Visible in `/conversations` list (green badge) |
| 5 | Final score locked | Score in conversations list reflects QA score |

---

### TC-VER-005 — Another User Cannot Approve Another Verifier's Claimed Evaluation

**Pre-condition:** Verifier A claims evaluation E2.  
**Role:** Verifier B

| Step | Action | Expected Result |
|---|---|---|
| 1 | Verifier B opens the evaluation page for E2 | Page loads read-only or error shown |
| 2 | Verifier B clicks **Approve** | Error: "Not claimed by you" |

---

### TC-VER-006 — Cannot Claim Already-Locked Evaluation

| Step | Action | Expected Result |
|---|---|---|
| 1 | Previously approved evaluation (state = `LOCKED`) | evaluation is no longer in verifier queue |
| 2 | Access `/verifier-queue/[locked-eval-id]` directly | Error state or read-only view; no Approve button visible |

---

### TC-VER-007 — Verifier Can Claim from QA_COMPLETED State

**Pre-condition:** Evaluation in `QA_COMPLETED` state (not escalated).

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to verifier queue | Item visible with state `QA COMPLETED` |
| 2 | Click **Review** | Claim succeeds; state transitions to `VERIFIER_IN_PROGRESS` |

---

## 8. Escalation Flow

### TC-ESC-001 — High AI↔QA Deviation Triggers Escalation

**Pre-condition:** LLM is enabled. Default escalation threshold: 15 points.

| Step | Action | Expected Result |
|---|---|---|
| 1 | AI evaluates a conversation with score 90 | Evaluation in `QA_PENDING` |
| 2 | QA reviewer claims and submits score 60 (deviation = 30 > 15) | Submission succeeds |
| 3 | Check escalation queue at `/escalation-queue` | Evaluation appears |
| 4 | Check evaluation badge | State badge shows `ESCALATION_QUEUE` |
| 5 | Dashboard KPI card **Escalated** | Count increments by 1 (card turns orange) |

---

### TC-ESC-002 — No Escalation When Deviation is Within Threshold

| Step | Action | Expected Result |
|---|---|---|
| 1 | AI score 90, QA score 80 (deviation = 10 ≤ 15) | Submission succeeds |
| 2 | Evaluation goes to Verifier Queue | Item NOT in escalation queue |
| 3 | Dashboard Escalated card | Count unchanged |

---

### TC-ESC-003 — Custom Escalation Threshold (Settings)

**Page:** `/settings/escalation`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/settings/escalation` | Current threshold visible (default 15) |
| 2 | Change threshold to 5 and save | Saved successfully |
| 3 | Upload a new conversation (LLM enabled) and review with AI score 90, QA score 83 (deviation = 7 > 5) | Evaluation escalated |
| 4 | Reset threshold to 15 | Normal behaviour restored |

---

## 9. Settings — LLM Configuration

### TC-LLM-001 — Configure LLM Provider

**Page:** `/settings/llm`  
**Role:** Admin

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/settings/llm` | LLM configuration form (Provider, API Key, Model, Temperature, etc.) |
| 2 | Select provider (OpenAI / Azure / Custom) | Form fields update for provider |
| 3 | Enter valid API key and model name | Input accepted |
| 4 | Enable the toggle and save | Success toast/message. LLM status: **Enabled** |

---

### TC-LLM-002 — Disable LLM

**Page:** `/settings/llm`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Toggle LLM to **Disabled** and save | Status shows **Disabled** |
| 2 | Upload a new conversation | Conversation status → `QA REVIEW` immediately (not `EVALUATING`) |
| 3 | QA Queue contains the item immediately | No eval processing delay |

---

### TC-LLM-003 — Enable LLM (Back to Enabled)

| Step | Action | Expected Result |
|---|---|---|
| 1 | Toggle LLM back to **Enabled** and save | Status shows **Enabled** |
| 2 | Upload a new conversation | Conversation status → `EVALUATING` |
| 3 | After processing, status → `QA REVIEW` | QA Queue entry appears |

---

## 10. Settings — Blind Review

### TC-BLIND-001 — Hide Agent from QA Reviewer

**Page:** `/settings/blind-review`  
**Role:** Admin

| Step | Action | Expected Result |
|---|---|---|
| 1 | Enable **Hide agent from QA** and save | Setting saved |
| 2 | Log in as a QA user | — |
| 3 | Open an evaluation in QA Queue | Agent name/ID replaced with an anonymised alias (e.g. `agent_abc123ef`) |
| 4 | Log in as Admin | Agent name/ID shows the real value |

---

### TC-BLIND-002 — Hide QA Reviewer from Verifier

**Page:** `/settings/blind-review`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Enable **Hide QA from Verifier** and save | Setting saved |
| 2 | Log in as Verifier and open an evaluation | QA reviewer ID replaced with an alias |
| 3 | Log in as Admin | Real QA user ID visible |

---

## 11. Settings — Escalation Rules

### TC-ESCALRULE-001 — Set QA Deviation Threshold

**Page:** `/settings/escalation`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/settings/escalation` | Threshold input visible with current value |
| 2 | Enter `10` and save | Success confirmation |
| 3 | Verify threshold persists on page reload | Value still shows `10` |

---

## 12. Users Management

### TC-USERS-001 — List Users

**Page:** `/users`  
**Role:** Admin

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/users` | Table with Name, Email, Role, Status columns |
| 2 | Current admin account visible | Row with role `ADMIN` shown |

---

### TC-USERS-002 — Invite a New QA User

| Step | Action | Expected Result |
|---|---|---|
| 1 | Click **Invite user** | Modal / form appears |
| 2 | Enter email, select role **QA** | — |
| 3 | Submit invitation | Success message. User appears in list with status `INVITED` |
| 4 | Check invite email (or accept invite endpoint) | User can set password and log in |

---

### TC-USERS-003 — Invite a New Verifier User

Same steps as TC-USERS-002 but select role **VERIFIER**.

---

### TC-USERS-004 — Accept Invite

**Page:** `/accept-invite?token=…`

| Step | Action | Expected Result |
|---|---|---|
| 1 | Open invitation link | Page shows Set Password form |
| 2 | Enter and confirm new password | — |
| 3 | Submit | Account activated; redirect to login |
| 4 | Log in with new credentials | Access granted with correct role |

---

### TC-USERS-005 — Deactivate a User

| Step | Action | Expected Result |
|---|---|---|
| 1 | Find an active user in the list | — |
| 2 | Click deactivate / suspend | Confirmation prompt |
| 3 | Confirm | User status changes to `INACTIVE` |
| 4 | Attempt login with that user | Error: account suspended / inactive |

---

## 13. Analytics

### TC-ANA-001 — Analytics Overview Page Loads

**Page:** `/analytics`  
**Role:** Admin

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/analytics` | Charts and KPI metrics render. No blank/error state |
| 2 | Verify metrics | Average score, pass rate, AI↔QA deviation, escalations visible |

---

### TC-ANA-002 — Pass Rate Reflects Completed Evaluations

| Step | Action | Expected Result |
|---|---|---|
| 1 | Complete several evaluations (some pass, some fail) | — |
| 2 | Navigate to Analytics | Pass rate percentage matches expected ratio |

---

## 14. Plan Limits & Billing

### TC-BILL-001 — Monthly Limit Warning (BASIC Plan, Near Limit)

**Pre-condition:** Tenant on BASIC plan; 495/500 conversations used.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Upload 7 conversations | Error: "This upload would exceed your monthly limit. You have 5 conversations remaining this month." |
| 2 | Upload 5 conversations exactly | Upload succeeds |
| 3 | Upload 1 more conversation | Error: "Monthly conversation limit of 500 reached. Upgrade your plan." |

---

### TC-BILL-002 — Enterprise Plan Has No Monthly Limit

**Pre-condition:** Tenant on ENTERPRISE plan.

| Step | Action | Expected Result |
|---|---|---|
| 1 | Upload any number of conversations (up to 500 per batch) | No limit error. Uploads succeed |

---

### TC-BILL-003 — Billing Portal Access

**Page:** `/billing`  
**Role:** Admin

| Step | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `/billing` | Current plan, status, usage visible |
| 2 | Click **Manage subscription** or **Upgrade** | Redirect to Stripe billing portal or checkout |

---

## 15. Error & Edge Cases

### TC-ERR-001 — Access Protected Page Without Login

| Step | Action | Expected Result |
|---|---|---|
| 1 | Open `http://localhost:3001/dashboard` in incognito | Redirected to `/login?next=/dashboard` |
| 2 | Log in | Redirected back to `/dashboard` after login |

---

### TC-ERR-002 — Access Evaluation Not in Queue (Direct URL)

| Step | Action | Expected Result |
|---|---|---|
| 1 | Manually type `/qa-queue/nonexistent-eval-id` | Error page or "Evaluation not found" message |

---

### TC-ERR-003 — QA Cannot Claim Evaluation Not in QA_PENDING

**Pre-condition:** Evaluation is in `AI_IN_PROGRESS` (LLM is processing).

| Step | Action | Expected Result |
|---|---|---|
| 1 | Access `/qa-queue/[eval-id]` for a non-QA_PENDING evaluation | Claim fails with error: "Cannot claim evaluation in AI_IN_PROGRESS state" |

---

### TC-ERR-004 — Duplicate Conversation Upload (Same externalId)

| Step | Action | Expected Result |
|---|---|---|
| 1 | Upload conversation with `externalId: "EXT-001"` | Accepted; conversation created |
| 2 | Upload same file again | `uploaded: 1` but existing record is returned (upsert, no duplicate). No second evaluation created |

---

### TC-ERR-005 — Auto-Refresh of Queues

| Step | Action | Expected Result |
|---|---|---|
| 1 | Open QA Queue page | Queue visible |
| 2 | In another tab, upload + process a new conversation | — |
| 3 | Wait 30 seconds without manual refresh | QA Queue auto-refreshes and new item appears (auto-poll every 30s) |

---

### TC-ERR-006 — Missing Override Reason on QA Submit

**Page:** `/qa-queue/[id]`

| Step | Action | Expected Result |
|---|---|---|
| 1 | AI pre-fills answer `resolved: true` | Visible in form |
| 2 | QA changes answer to `resolved: false` | Override reason field becomes visible/required |
| 3 | Submit without filling override reason | Error: "Question 'resolved' value changed without overrideReason" |

---

## Workflow State Reference

| Status | Displayed Badge | Colour |
|---|---|---|
| `AI_PENDING` | AI PENDING | Blue-light |
| `AI_IN_PROGRESS` | AI IN PROGRESS | Blue |
| `AI_COMPLETED` | AI COMPLETE | Indigo |
| `QA_PENDING` | QA REVIEW | Yellow |
| `QA_IN_PROGRESS` | QA REVIEW | Yellow |
| `QA_COMPLETED` | QA COMPLETE | Green |
| `VERIFIER_PENDING` | VERIFIER REVIEW | Purple |
| `VERIFIER_IN_PROGRESS` | VERIFIER REVIEW | Purple |
| `LOCKED` | VERIFIER COMPLETE | Green-dark |
| `ESCALATED` | ESCALATED | Red |

---

## Conversation Status Reference

| API Value | Badge Label | Badge Colour |
|---|---|---|
| `PENDING` | PENDING | Grey |
| `EVALUATING` | EVALUATING | Blue |
| `QA_REVIEW` | QA REVIEW | Yellow |
| `VERIFIER_REVIEW` | VERIFIER REVIEW | Purple |
| `COMPLETED` | COMPLETED | Green |
| `FAILED` | FAILED | Red |

---

## Test Traceability Matrix

| Test Case | Unit Test Coverage | Service |
|---|---|---|
| TC-AUTH-001 to 008 | `auth.service.spec.ts` — login, refresh, logout | `AuthService` |
| TC-UPLOAD-001 to 007 | `conversations.service.spec.ts` — upload validation, plan limits | `ConversationsService` |
| TC-CONV-004 | `conversations.service.spec.ts` — LLM disabled path | `ConversationsService` |
| TC-QA-003 to 004 | `evaluations.service.spec.ts` — qaStart, qaSubmit (LLM enabled) | `EvaluationsService` |
| TC-QA-005 to 006 | `evaluations.service.spec.ts` — MISSING_OVERRIDE_REASON | `EvaluationsService` |
| TC-QA-007 | `evaluations.service.spec.ts` — NOT_CLAIMED_BY_YOU | `EvaluationsService` |
| TC-QALLM-001 to 003 | `conversations.service.spec.ts` + `evaluations.service.spec.ts` — LLM disabled path | Both |
| TC-VER-003 to 006 | `evaluations.service.spec.ts` — verifierStart, verifierApprove | `EvaluationsService` |
| TC-ESC-001 to 003 | `evaluations.service.spec.ts` — escalation threshold | `EvaluationsService` |
| TC-BILL-001 to 002 | `conversations.service.spec.ts` — plan limit checks | `ConversationsService` |
