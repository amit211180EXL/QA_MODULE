// ─── Enums ───────────────────────────────────────────────────────────────────

export enum PlanType {
  BASIC = 'BASIC',
  PRO = 'PRO',
  ENTERPRISE = 'ENTERPRISE',
}

export enum TenantStatus {
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  CANCELLED = 'CANCELLED',
}

export enum UserRole {
  ADMIN = 'ADMIN',
  QA = 'QA',
  VERIFIER = 'VERIFIER',
}

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  INVITED = 'INVITED',
}

export enum Channel {
  CHAT = 'CHAT',
  EMAIL = 'EMAIL',
  CALL = 'CALL',
  SOCIAL = 'SOCIAL',
}

export enum ConvStatus {
  PENDING = 'PENDING',
  EVALUATING = 'EVALUATING',
  QA_REVIEW = 'QA_REVIEW',
  VERIFIER_REVIEW = 'VERIFIER_REVIEW',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum FormStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  DEPRECATED = 'DEPRECATED',
  ARCHIVED = 'ARCHIVED',
}

export enum WorkflowState {
  AI_PENDING = 'AI_PENDING',
  AI_IN_PROGRESS = 'AI_IN_PROGRESS',
  AI_COMPLETED = 'AI_COMPLETED',
  AI_FAILED = 'AI_FAILED',
  QA_PENDING = 'QA_PENDING',
  QA_IN_PROGRESS = 'QA_IN_PROGRESS',
  QA_COMPLETED = 'QA_COMPLETED',
  VERIFIER_PENDING = 'VERIFIER_PENDING',
  VERIFIER_IN_PROGRESS = 'VERIFIER_IN_PROGRESS',
  VERIFIER_COMPLETED = 'VERIFIER_COMPLETED',
  LOCKED = 'LOCKED',
  ESCALATED = 'ESCALATED',
}

export enum LlmProvider {
  OPENAI = 'OPENAI',
  AZURE_OPENAI = 'AZURE_OPENAI',
  CUSTOM = 'CUSTOM',
}

export enum DeviationType {
  AI_VS_QA = 'AI_VS_QA',
  QA_VS_VERIFIER = 'QA_VS_VERIFIER',
}

export enum QueueType {
  QA_QUEUE = 'QA_QUEUE',
  VERIFIER_QUEUE = 'VERIFIER_QUEUE',
  ESCALATION_QUEUE = 'ESCALATION_QUEUE',
  AUDIT_QUEUE = 'AUDIT_QUEUE',
}

export enum SubscriptionStatus {
  TRIALING = 'TRIALING',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

// ─── Plan Feature Matrix ──────────────────────────────────────────────────────

export const PLAN_FEATURES: Record<PlanType, string[]> = {
  [PlanType.BASIC]: ['evaluations', 'qa_review', 'basic_analytics'],
  [PlanType.PRO]: [
    'evaluations',
    'qa_review',
    'verifier_review',
    'custom_forms',
    'advanced_analytics',
    'exports',
    'blind_review',
  ],
  [PlanType.ENTERPRISE]: [
    'evaluations',
    'qa_review',
    'verifier_review',
    'custom_forms',
    'advanced_analytics',
    'exports',
    'blind_review',
    'byo_llm',
    'sso',
    'compliance_reports',
    'dedicated_infra',
  ],
};

export const PLAN_LIMITS: Record<
  PlanType,
  { conversationsPerMonth: number; forms: number; users: number; dbPoolSize: number }
> = {
  [PlanType.BASIC]: { conversationsPerMonth: 500, forms: 3, users: 5, dbPoolSize: 2 },
  [PlanType.PRO]: { conversationsPerMonth: 5000, forms: 20, users: 25, dbPoolSize: 5 },
  [PlanType.ENTERPRISE]: {
    conversationsPerMonth: 999_999,
    forms: 999_999,
    users: 999_999,
    dbPoolSize: 10,
  },
};

// ─── Standard API Response Shapes ────────────────────────────────────────────

export interface ApiMeta {
  requestId: string;
  timestamp: string;
}

export interface ApiResponse<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown[];
  };
  meta: ApiMeta;
}

export interface PaginatedMeta extends ApiMeta {
  total: number;
  page: number;
  limit: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

// ─── Form Definition JSON Shapes ─────────────────────────────────────────────

export type QuestionType = 'rating' | 'boolean' | 'text' | 'select' | 'multiselect';

export interface RubricAnchor {
  value: number;
  label: string;
  description?: string;
}

export interface QuestionRubric {
  goal: string;
  anchors: RubricAnchor[];
}

export interface QuestionValidation {
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: string;
}

export interface QuestionOption {
  value: string;
  label: string;
}

export interface ConditionalLogic {
  showIf: {
    questionKey: string;
    operator: 'eq' | 'neq' | 'gt' | 'lt';
    value: unknown;
  };
}

export interface FormQuestion {
  id: string;
  sectionId: string;
  key: string;
  label: string;
  type: QuestionType;
  required: boolean;
  weight: number;
  order: number;
  validation?: QuestionValidation;
  rubric?: QuestionRubric;
  options?: QuestionOption[];
  conditionalLogic?: ConditionalLogic;
}

export interface FormSection {
  id: string;
  title: string;
  weight: number;
  order: number;
}

export type RoundingPolicy = 'round' | 'floor' | 'ceil';

export interface ScoringStrategy {
  type: 'weighted_sections';
  passMark: number;
  scale: number;
  roundingPolicy: RoundingPolicy;
}

// ─── Evaluation Response Layer Shapes ────────────────────────────────────────

export interface AnswerRecord {
  value: unknown;
  reasoning?: string;
  confidence?: number;       // AI only: 0..1
  overrideReason?: string;   // QA / Verifier only
}

export interface EvaluationResponseLayer {
  answers: Record<string, AnswerRecord>;
  sectionScores: Record<string, number>;
  overallScore: number;
  passFail: boolean;
}

export interface AiMetadata {
  provider: LlmProvider;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costCents: number;
  durationMs: number;
}

// ─── Queue Job Payload Types ──────────────────────────────────────────────────

export interface EvalProcessJobPayload {
  tenantId: string;
  conversationId: string;
  evaluationId: string;
  formDefinitionId: string;
  formVersion: number;
}

export interface EvalEscalateJobPayload {
  tenantId: string;
  evaluationId: string;
  deviationType: DeviationType;
  deviation: number;
  triggeredBy: string;
}

export interface TenantProvisionJobPayload {
  tenantId: string;
  tenantSlug: string;
  adminUserId: string;
  plan: PlanType;
}

export interface BillingUsageSyncPayload {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  delta: {
    conversationsProcessed: number;
    aiTokensUsed: number;
    aiCostCents: number;
  };
}

export type NotificationType =
  | 'qa_pending'
  | 'verifier_pending'
  | 'escalation_triggered'
  | 'audit_case_created'
  | 'queue_stale'
  | 'eval_failed'
  | 'tenant_ready'
  | 'provision_failed'
  | 'usage_warning'
  | 'usage_limit_reached'
  | 'export_ready'
  | 'password_reset'
  | 'user_invited';

export interface NotifySendJobPayload {
  tenantId: string;
  type: NotificationType;
  recipientIds: string[];
  data: Record<string, unknown>;
}

export interface ReportExportJobPayload {
  tenantId: string;
  jobId: string;
  requesterId: string;
  type: 'csv' | 'pdf';
  report: 'agent_performance' | 'qa_accuracy' | 'deviation_trends' | 'audit_log';
  from: string;
  to: string;
  filters: Record<string, unknown>;
}

// ─── JWT Payload ──────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;        // userId
  tenantId: string;
  role: UserRole;
  type: 'access' | 'refresh' | 'invite' | 'reset';
}

// ─── Queue Names ───────────────────────────────────────────────────────────────

export const QUEUE_NAMES = {
  EVAL_PROCESS: 'eval:process',
  EVAL_ESCALATE: 'eval:escalate',
  QUEUE_STALE_CHECK: 'queue:stale-check',
  TENANT_PROVISION: 'tenant:provision',
  BILLING_USAGE_SYNC: 'billing:usage-sync',
  NOTIFY_SEND: 'notify:send',
  REPORT_EXPORT: 'report:export',
  POOL_REAP: 'pool:reap',
} as const;
