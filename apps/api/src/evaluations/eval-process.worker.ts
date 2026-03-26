import { Worker, Job } from 'bullmq';
import { getMasterClient } from '@qa/prisma-master';
import { createTenantClient } from '@qa/prisma-tenant';
import { getEnv, loadEnv } from '@qa/config';
import { decrypt } from '../common/utils/encryption.util';
import { ScoringService } from './scoring.service';
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
    await tenantDb.evaluation.update({
      where: { id: evaluationId },
      data: { workflowState: WorkflowState.QA_PENDING },
    });
    await tenantDb.workflowQueue.upsert({
      where: { evaluationId },
      create: { evaluationId, queueType: 'QA_QUEUE', priority: 5 },
      update: { queueType: 'QA_QUEUE' },
    });
    await tenantDb.$disconnect();
    return { skipped: true, reason: 'no_llm_config' };
  }

  const apiKey = decrypt(llmConfig.apiKeyEnc);

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
    const baseUrl =
      llmConfig.provider === 'OPENAI'
        ? 'https://api.openai.com'
        : (llmConfig.endpoint ?? 'https://api.openai.com');

    const path =
      llmConfig.provider === 'AZURE_OPENAI'
        ? `/openai/deployments/${llmConfig.model}/chat/completions?api-version=2024-02-01`
        : '/v1/chat/completions';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(llmConfig.provider === 'AZURE_OPENAI'
        ? { 'api-key': apiKey }
        : { Authorization: `Bearer ${apiKey}` }),
    };

    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: llmConfig.maxTokens,
        temperature: llmConfig.temperature,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`LLM API error ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };

    const content = data.choices[0]?.message?.content ?? '{}';
    rawAnswers = JSON.parse(content);

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

    const aiMetadata = {
      provider: llmConfig.provider,
      model: llmConfig.model,
      promptTokens: data.usage?.prompt_tokens ?? 0,
      completionTokens: data.usage?.completion_tokens ?? 0,
      costCents: 0,
      durationMs,
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
          aiCompletedAt: new Date(),
        },
      }),
      tenantDb.workflowQueue.upsert({
        where: { evaluationId },
        create: { evaluationId, queueType: 'QA_QUEUE', priority: 5 },
        update: { queueType: 'QA_QUEUE', assignedTo: null },
      }),
      tenantDb.conversation.update({
        where: { id: conversationId },
        data: { status: 'QA_REVIEW' },
      }),
    ]);

    return { aiScore: scoreResult.overallScore, durationMs };
  } catch (err: unknown) {
    // Mark evaluation as AI_FAILED
    await tenantDb.evaluation
      .update({
        where: { id: evaluationId },
        data: {
          workflowState: WorkflowState.AI_FAILED,
          // Fall back to QA queue anyway so humans can still review
        },
      })
      .catch(() => {});
    await tenantDb.conversation
      .update({
        where: { id: conversationId },
        data: { status: 'FAILED' },
      })
      .catch(() => {});
    throw err;
  } finally {
    await tenantDb.$disconnect();
  }
}

// ─── Start worker ─────────────────────────────────────────────────────────────

export function startEvalWorker() {
  const env = getEnv();

  const worker = new Worker<EvalProcessJobPayload>(QUEUE_NAMES.EVAL_PROCESS, processEval, {
    connection: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
    },
    concurrency: 5,
  });

  worker.on('completed', (job, result) => {
    console.log(`[eval-worker] Job ${job.id} completed`, result);
  });
  worker.on('failed', (job, err) => {
    console.error(`[eval-worker] Job ${job?.id} failed`, err.message);
  });

  return worker;
}
