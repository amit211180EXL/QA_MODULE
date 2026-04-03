import { Worker, Job } from 'bullmq';
import { createHmac } from 'crypto';
import { getMasterClient } from '@qa/prisma-master';
import { createTenantClient } from '@qa/prisma-tenant';
import { getEnv, loadEnv } from '@qa/config';
import { decrypt } from '../common/utils/encryption.util';
import { ScoringService } from './scoring.service';
import { estimateCostCents } from './llm-cost.util';
import {
  EvalProcessJobPayload,
  FormQuestion,
  FormSection,
  ScoringStrategy,
  AnswerRecord,
  QUEUE_NAMES,
  WorkflowState,
} from '@qa/shared';

loadEnv();

const scoringService = new ScoringService();
const masterDb = getMasterClient();

type LlmProvider = 'OPENAI' | 'AZURE_OPENAI' | 'CUSTOM';

type LlmResponse = {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
};

type LlmAttemptResult = {
  data: LlmResponse;
  provider: LlmProvider;
  model: string;
  usedBackup: boolean;
};

async function callLlm(
  provider: LlmProvider,
  model: string,
  endpoint: string | null,
  apiKey: string,
  prompt: string,
  maxTokens: number,
  temperature: number,
): Promise<LlmResponse> {
  const baseUrl = provider === 'OPENAI' ? 'https://api.openai.com' : (endpoint ?? 'https://api.openai.com');
  const path =
    provider === 'AZURE_OPENAI'
      ? `/openai/deployments/${model}/chat/completions?api-version=2024-02-01`
      : '/v1/chat/completions';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(provider === 'AZURE_OPENAI' ? { 'api-key': apiKey } : { Authorization: `Bearer ${apiKey}` }),
  };

  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    throw new Error(`LLM API error ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as LlmResponse;
}

async function callLlmWithFailover(
  llmConfig: {
    provider: LlmProvider;
    model: string;
    endpoint: string | null;
    apiKeyEnc: string;
    backupProvider: LlmProvider | null;
    backupModel: string | null;
    backupApiKeyEnc: string | null;
    maxTokens: number;
    temperature: number;
  },
  prompt: string,
): Promise<LlmAttemptResult> {
  const primaryKey = decrypt(llmConfig.apiKeyEnc);
  try {
    const data = await callLlm(
      llmConfig.provider,
      llmConfig.model,
      llmConfig.endpoint,
      primaryKey,
      prompt,
      llmConfig.maxTokens,
      llmConfig.temperature,
    );
    return { data, provider: llmConfig.provider, model: llmConfig.model, usedBackup: false };
  } catch (primaryErr) {
    if (!llmConfig.backupProvider || !llmConfig.backupModel || !llmConfig.backupApiKeyEnc) {
      throw primaryErr;
    }

    const backupKey = decrypt(llmConfig.backupApiKeyEnc);
    const data = await callLlm(
      llmConfig.backupProvider,
      llmConfig.backupModel,
      llmConfig.endpoint,
      backupKey,
      prompt,
      llmConfig.maxTokens,
      llmConfig.temperature,
    );
    return {
      data,
      provider: llmConfig.backupProvider,
      model: llmConfig.backupModel,
      usedBackup: true,
    };
  }
}

function routeByConfidence(answers: Record<string, { confidence?: number }>) {
  const confidences = Object.values(answers)
    .map((a) => (typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : null))
    .filter((c): c is number => c !== null)
    .map((c) => Math.max(0, Math.min(1, c)));

  if (confidences.length === 0) {
    return {
      confidenceScore: null as number | null,
      queuePriority: 5,
      routeLabel: 'NO_CONFIDENCE',
    };
  }

  const confidenceScore = Math.min(...confidences);
  if (confidenceScore < 0.6) {
    return { confidenceScore, queuePriority: 1, routeLabel: 'LOW_CONFIDENCE_MANDATORY_REVIEW' };
  }
  if (confidenceScore < 0.9) {
    return { confidenceScore, queuePriority: 5, routeLabel: 'NORMAL_CONFIDENCE' };
  }
  return { confidenceScore, queuePriority: 6, routeLabel: 'HIGH_CONFIDENCE' };
}

function validateLlmAnswers(
  raw: Record<string, { value: unknown; reasoning?: string; confidence?: number }>,
  questions: FormQuestion[],
) {
  const validKeys = new Set(questions.map((q) => q.key));

  for (const [key, val] of Object.entries(raw)) {
    if (!validKeys.has(key)) {
      throw new Error(`LLM output contains unknown question key: ${key}`);
    }
    if (val === null || typeof val !== 'object') {
      throw new Error(`LLM output for ${key} must be an object`);
    }
    if (!('value' in val)) {
      throw new Error(`LLM output for ${key} missing required field: value`);
    }
    if (val.reasoning !== undefined && typeof val.reasoning !== 'string') {
      throw new Error(`LLM output for ${key} has invalid reasoning type`);
    }
    if (
      val.confidence !== undefined &&
      (typeof val.confidence !== 'number' || !Number.isFinite(val.confidence) || val.confidence < 0 || val.confidence > 1)
    ) {
      throw new Error(`LLM output for ${key} has invalid confidence value`);
    }
  }

  // Ensure every form question has an answer entry.
  for (const q of questions) {
    if (!(q.key in raw)) {
      throw new Error(`LLM output missing question key: ${q.key}`);
    }
  }
}

// ─── Standalone outbound webhook delivery (no NestJS DI) ─────────────────────

async function deliverFailedWebhook(
  tenantId: string,
  evaluationId: string,
  conversationId: string,
): Promise<void> {
  try {
    const hooks = await masterDb.outboundWebhook.findMany({
      where: { tenantId, status: 'ACTIVE' },
    });
    const matching = hooks.filter((h) => h.events.includes('evaluation.failed'));
    if (matching.length === 0) return;

    const payload = JSON.stringify({
      event: 'evaluation.failed',
      tenantId,
      evaluationId,
      conversationId,
      workflowState: WorkflowState.AI_FAILED,
      finalScore: null,
      passFail: null,
      timestamp: new Date().toISOString(),
    });

    await Promise.allSettled(
      matching.map(async (hook) => {
        const secret = decrypt(hook.secretEnc);
        const sig = `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
        await fetch(hook.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-QA-Signature': sig,
            'X-QA-Event': 'evaluation.failed',
            'User-Agent': 'QA-Platform/1.0',
          },
          body: payload,
          signal: AbortSignal.timeout(5_000),
        });
      }),
    );
  } catch {
    // Never let webhook delivery break the worker's error handling
  }
}

// ─── Build prompt from form + conversation ────────────────────────────────────

function buildPrompt(
  conversation: { content: unknown },
  questions: FormQuestion[],
  sections: FormSection[],
): string {
  const sectionMap = new Map(sections.map((s) => [s.id, s.title]));

  const questionBlock = questions
    .sort((a, b) => a.order - b.order)
    .map((q) => {
      const rubricText = q.rubric
        ? `  Rubric: ${q.rubric.goal}\n  ${q.rubric.anchors.map((a) => `${a.value}: ${a.label}`).join(' | ')}`
        : '';
      const optionsText = q.options
        ? `  Options: ${q.options.map((o) => `${o.value}=${o.label}`).join(', ')}`
        : '';
      return [
        `[${sectionMap.get(q.sectionId) ?? q.sectionId}] Q:${q.key} (type=${q.type}, weight=${q.weight})`,
        `  Label: ${q.label}`,
        rubricText,
        optionsText,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');

  return `You are a QA evaluation AI. Evaluate the following customer support conversation against the QA form criteria below.

For each question, respond with a JSON object where each key is the questionKey and each value is:
{ "value": <answer>, "reasoning": <one sentence>, "confidence": <0..1> }

Only output valid JSON. No markdown. No explanation outside the JSON.

=== CONVERSATION ===
${JSON.stringify(conversation.content, null, 2)}

=== QA FORM QUESTIONS ===
${questionBlock}

=== RESPONSE (JSON only) ===`;
}

// ─── Worker ───────────────────────────────────────────────────────────────────

async function processEval(job: Job<EvalProcessJobPayload>) {
  const { tenantId, conversationId, evaluationId, formDefinitionId } = job.data;

  // 1. Get tenant DB connection URL
  const tenant = await masterDb.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const dbPassword = decrypt(tenant.dbPasswordEnc);
  const tenantDbUrl = `postgresql://${tenant.dbUser}:${encodeURIComponent(dbPassword)}@${tenant.dbHost}:${tenant.dbPort}/${tenant.dbName}`;
  const tenantDb = createTenantClient(tenantDbUrl);

  // 2. Get LLM config
  const llmConfig = await masterDb.llmConfig.findUnique({ where: { tenantId } });
  if (!llmConfig || !llmConfig.enabled) {
    // No LLM config — skip AI, go straight to QA queue
    await tenantDb.$transaction([
      tenantDb.evaluation.update({
        where: { id: evaluationId },
        data: { workflowState: WorkflowState.QA_PENDING },
      }),
      tenantDb.workflowQueue.upsert({
        where: { evaluationId },
        create: { evaluationId, queueType: 'QA_QUEUE', priority: 5 },
        update: { queueType: 'QA_QUEUE', assignedTo: null, priority: 5 },
      }),
      tenantDb.conversation.update({
        where: { id: conversationId },
        data: { status: 'QA_REVIEW' },
      }),
    ]);
    await tenantDb.$disconnect();
    return { skipped: true, reason: llmConfig ? 'llm_disabled' : 'no_llm_config' };
  }

  // 3. Load conversation + form
  const [conversation, form] = await Promise.all([
    tenantDb.conversation.findUniqueOrThrow({ where: { id: conversationId } }),
    tenantDb.formDefinition.findUniqueOrThrow({ where: { id: formDefinitionId } }),
  ]);

  // 4. Update state to AI_IN_PROGRESS
  await tenantDb.evaluation.update({
    where: { id: evaluationId },
    data: { workflowState: WorkflowState.AI_IN_PROGRESS },
  });
  await tenantDb.conversation.update({
    where: { id: conversationId },
    data: { status: 'EVALUATING' },
  });

  // 5. Build + call LLM
  const questions = form.questions as unknown as FormQuestion[];
  const sections = form.sections as unknown as FormSection[];
  const prompt = buildPrompt(conversation, questions, sections);

  const reqStart = Date.now();
  let rawAnswers: Record<string, { value: unknown; reasoning?: string; confidence?: number }> = {};

  try {
    const llmResult = await callLlmWithFailover(
      {
        provider: llmConfig.provider as LlmProvider,
        model: llmConfig.model,
        endpoint: llmConfig.endpoint,
        apiKeyEnc: llmConfig.apiKeyEnc,
        backupProvider: (llmConfig.backupProvider as LlmProvider | null) ?? null,
        backupModel: llmConfig.backupModel,
        backupApiKeyEnc: llmConfig.backupApiKeyEnc,
        maxTokens: llmConfig.maxTokens,
        temperature: llmConfig.temperature,
      },
      prompt,
    );
    const data = llmResult.data;

    const content = data.choices[0]?.message?.content ?? '{}';
    rawAnswers = JSON.parse(content);

    validateLlmAnswers(rawAnswers, questions);

    const durationMs = Date.now() - reqStart;

    // 6. Score AI layer
    const answers: Record<string, AnswerRecord> = {};
    for (const [key, val] of Object.entries(rawAnswers)) {
      answers[key] = {
        value: (val as { value: unknown }).value,
        reasoning: (val as { reasoning?: string }).reasoning,
        confidence: (val as { confidence?: number }).confidence,
      };
    }

    const scoreResult = scoringService.score(
      answers,
      questions,
      sections,
      form.scoringStrategy as unknown as ScoringStrategy,
    );

    const aiLayer = {
      answers: scoreResult.answers,
      sectionScores: scoreResult.sectionScores,
      overallScore: scoreResult.overallScore,
      passFail: scoreResult.passFail,
    };

    const promptTokens = data.usage?.prompt_tokens ?? 0;
    const completionTokens = data.usage?.completion_tokens ?? 0;
    const costCents = estimateCostCents(
      llmConfig.provider,
      llmConfig.model,
      promptTokens,
      completionTokens,
    );

    const routing = routeByConfidence(rawAnswers);

    const aiMetadata = {
      provider: llmResult.provider,
      model: llmResult.model,
      promptTokens,
      completionTokens,
      costCents,
      durationMs,
      usedBackupProvider: llmResult.usedBackup,
      confidenceRoute: routing.routeLabel,
    };

    // 7. Persist + move to QA queue
    await tenantDb.$transaction([
      tenantDb.evaluation.update({
        where: { id: evaluationId },
        data: {
          workflowState: WorkflowState.QA_PENDING,
          aiResponseData: aiLayer as never,
          aiScore: scoreResult.overallScore,
          aiMetadata: aiMetadata as never,
          confidenceScore: routing.confidenceScore,
          aiCompletedAt: new Date(),
        },
      }),
      tenantDb.workflowQueue.upsert({
        where: { evaluationId },
        create: { evaluationId, queueType: 'QA_QUEUE', priority: routing.queuePriority },
        update: { queueType: 'QA_QUEUE', assignedTo: null, priority: routing.queuePriority },
      }),
      tenantDb.conversation.update({
        where: { id: conversationId },
        data: { status: 'QA_REVIEW' },
      }),
    ]);

    // 8. Record AI token + cost usage in master DB (fire-and-forget)
    const totalTokens = promptTokens + completionTokens;
    if (totalTokens > 0) {
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
      masterDb.usageMetric
        .upsert({
          where: {
            tenantId_periodStart_periodEnd: { tenantId, periodStart, periodEnd },
          },
          create: {
            tenantId,
            periodStart,
            periodEnd,
            conversationsProcessed: 0,
            aiTokensUsed: BigInt(totalTokens),
            aiCostCents: costCents,
            activeUsers: 0,
          },
          update: {
            aiTokensUsed: { increment: BigInt(totalTokens) },
            aiCostCents: { increment: costCents },
          },
        })
        .catch(() => null);
    }

    return { aiScore: scoreResult.overallScore, durationMs };
  } catch (err: unknown) {
    // Mark evaluation as AI_FAILED
    await tenantDb.evaluation
      .update({
        where: { id: evaluationId },
        data: { workflowState: WorkflowState.AI_FAILED },
      })
      .catch(() => {});
    await tenantDb.conversation
      .update({
        where: { id: conversationId },
        data: { status: 'FAILED' },
      })
      .catch(() => {});

    // Deliver evaluation.failed outbound webhooks (fire-and-forget)
    deliverFailedWebhook(tenantId, evaluationId, conversationId);

    throw err;
  } finally {
    await tenantDb.$disconnect();
  }
}

// ─── Start worker ─────────────────────────────────────────────────────────────

export function startEvalWorker() {
  const env = getEnv();
  const concurrency = Math.max(1, env.EVAL_WORKER_CONCURRENCY);

  const worker = new Worker<EvalProcessJobPayload>(QUEUE_NAMES.EVAL_PROCESS, processEval, {
    connection: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
    },
    concurrency,
  });

  worker.on('completed', (job, result) => {
    console.log(`[eval-worker] Job ${job.id} completed`, result);
  });
  worker.on('failed', (job, err) => {
    console.error(`[eval-worker] Job ${job?.id} failed`, err.message);
  });

  return worker;
}
