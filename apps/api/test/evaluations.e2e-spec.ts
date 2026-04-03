import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';

import { randomBytes } from 'crypto';
const makeSlug = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex')}`;
jest.setTimeout(120000);

const unwrap = <T>(body: { data?: T } | T): T =>
  ((body as { data?: T }).data ?? (body as T));

const DEV_ADMIN_EMAIL = 'admin@dev.local';
const DEV_ADMIN_PASSWORD = 'DevAdmin123!';
const DEV_TENANT_SLUG = 'dev-tenant';

describe('Conversations + Evaluations + QA/Verifier — e2e', () => {
  let app: INestApplication;
  const slug = makeSlug('eval-e2e');
  const qaEmail = `qa@${slug}.local`;
  const verifierEmail = `verifier@${slug}.local`;
  const qaPassword = 'E2eQaPass123!';
  const evalFormKey = `e2e_eval_form_${slug}`;

  let adminToken: string;
  let qaToken: string;
  let verifierToken: string;
  let formId: string;
  let conversationId: string;
  let evaluationId: string;

  // ─── Bootstrap ─────────────────────────────────────────────────────────────

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new RequestIdInterceptor(), new LoggingInterceptor());
    await app.init();

    // Sign up tenant
    // Login as pre-provisioned dev tenant admin
    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('x-tenant-slug', DEV_TENANT_SLUG)
      .send({ email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD })
      .expect(200);
    adminToken = loginRes.body.data.accessToken;

    // Invite + activate QA user (unique email per run)
    const qaInvite = await request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: qaEmail, name: 'QA Reviewer', role: 'QA' })
      .expect(201);
    const qaAccept = await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .send({ token: qaInvite.body.data.inviteToken, password: qaPassword })
      .expect(200);
    qaToken = qaAccept.body.data.accessToken;

    // Invite + activate Verifier user (unique email per run)
    const vInvite = await request(app.getHttpServer())
      .post('/api/v1/users/invite')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: verifierEmail, name: 'Verifier', role: 'VERIFIER' })
      .expect(201);
    const vAccept = await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .send({ token: vInvite.body.data.inviteToken, password: qaPassword })
      .expect(200);
    verifierToken = vAccept.body.data.accessToken;

    // Create and publish a form for CHAT channel
    const formRes = await request(app.getHttpServer())
      .post('/api/v1/forms')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        formKey: evalFormKey,
        name: 'Eval E2E Form',
        channels: ['CHAT'],
        scoringStrategy: { type: 'WEIGHTED_AVERAGE', passMark: 70, scale: 100 },
        sections: [{ id: 'sec_1', title: 'Quality', weight: 100, order: 1 }],
        questions: [
          {
            id: 'q_1',
            sectionId: 'sec_1',
            key: 'greeting',
            label: 'Did agent greet?',
            type: 'boolean',
            required: true,
            weight: 50,
            order: 1,
          },
          {
            id: 'q_2',
            sectionId: 'sec_1',
            key: 'resolution',
            label: 'Issue resolved?',
            type: 'boolean',
            required: true,
            weight: 50,
            order: 2,
          },
        ],
      })
      .expect(201);
    formId = formRes.body.data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/forms/${formId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ action: 'publish' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Conversations upload ───────────────────────────────────────────────────

  describe('Conversations upload', () => {
    it('POST /conversations/upload — uploads a conversation and queues eval', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/conversations/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          channel: 'CHAT',
          conversations: [
            {
              externalId: `e2e-conv-${Date.now()}`,
              agentId: 'agent-001',
              agentName: 'Test Agent',
              customerRef: 'cust-001',
              content: {
                messages: [
                  { role: 'agent', text: 'Hello, how can I help?' },
                  { role: 'customer', text: 'I have an issue.' },
                  { role: 'agent', text: 'Resolved! Have a great day.' },
                ],
              },
              receivedAt: new Date().toISOString(),
            },
          ],
        })
        .expect(201);

      expect(res.body.data.uploaded).toBe(1);
    });

    it('POST /conversations/upload — rejects when over plan limit', async () => {
      // 501 conversations exceeds BASIC/PRO upload cap
      const conversations = Array.from({ length: 501 }, (_, i) => ({
        externalId: `bulk-${i}`,
        agentName: 'Agent',
        content: { text: 'hello' },
      }));

      await request(app.getHttpServer())
        .post('/api/v1/conversations/upload')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ channel: 'CHAT', conversations })
        .expect(400);
    });

    it('GET /conversations — lists uploaded conversation', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/conversations')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
      conversationId = res.body.data.items[0].id;
    });

    it('GET /conversations/:id — returns conversation detail', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/conversations/${conversationId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(conversationId);
      expect(res.body.data.channel).toBe('CHAT');
    });
  });

  // ─── Evaluation discovery ───────────────────────────────────────────────────

  describe('Evaluation discovery', () => {
    it('GET /evaluations — returns evaluations for the tenant', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/evaluations')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const data = unwrap<{ items?: unknown[] } | unknown[]>(res.body);
      expect(Array.isArray((data as { items?: unknown[] }).items ?? data)).toBe(true);
    });

    it('GET /evaluations/queue/qa — returns QA queue (accessible by ADMIN and QA)', async () => {
      const adminRes = await request(app.getHttpServer())
        .get('/api/v1/evaluations/queue/qa')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const adminQueue = unwrap<{ items?: Array<{ id: string }> } | Array<{ id: string }>>(
        adminRes.body,
      );
      expect(adminQueue).toBeDefined();

      const qaRes = await request(app.getHttpServer())
        .get('/api/v1/evaluations/queue/qa')
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(200);
      const qaQueue = unwrap<{ items?: Array<{ id: string }> } | Array<{ id: string }>>(
        qaRes.body,
      );
      expect(qaQueue).toBeDefined();

      // Find an evaluation to work on
      const items: Array<{ id: string }> =
        (qaQueue as { items?: Array<{ id: string }> }).items ??
        (Array.isArray(qaQueue) ? qaQueue : []);
      if (items.length > 0) {
        evaluationId = items[0].id;
      }
    });

    it('GET /evaluations/queue/qa — returns 403 for VERIFIER role', () => {
      return request(app.getHttpServer())
        .get('/api/v1/evaluations/queue/qa')
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(403);
    });

    it('GET /evaluations/queue/verifier — accessible by VERIFIER and ADMIN', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/evaluations/queue/verifier')
        .set('Authorization', `Bearer ${verifierToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/evaluations/queue/verifier')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    it('GET /evaluations/queue/verifier — returns 403 for QA role', () => {
      return request(app.getHttpServer())
        .get('/api/v1/evaluations/queue/verifier')
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(403);
    });
  });

  // ─── Preview score (dry run) ────────────────────────────────────────────────

  describe('Preview score', () => {
    it('POST /evaluations/preview-score — returns score without persisting', async () => {
      const formRes = await request(app.getHttpServer())
        .get(`/api/v1/forms/${formId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const form = formRes.body.data;
      const answers = Object.fromEntries(
        (form.questions as Array<{ key: string; type: string }>).map((q) => [
          q.key,
          q.type === 'boolean' ? true : 3,
        ]),
      );

      const res = await request(app.getHttpServer())
        .post('/api/v1/evaluations/preview-score')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ formId, answers })
        .expect(200);

      const data = unwrap<{ overallScore: number; passFail: boolean }>(res.body);
      expect(data.overallScore).toBeDefined();
      expect(typeof data.overallScore).toBe('number');
      expect(data).toHaveProperty('passFail');
    });
  });

  // ─── QA workflow ───────────────────────────────────────────────────────────

  describe('QA workflow', () => {
    it('POST /evaluations/:id/qa-start — QA claims evaluation', async () => {
      if (!evaluationId) {
        console.warn('Skipping QA workflow — no evaluation in QA queue (LLM not configured)');
        return;
      }

      const res = await request(app.getHttpServer())
        .post(`/api/v1/evaluations/${evaluationId}/qa-start`)
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(200);

      expect(['QA_IN_PROGRESS', 'QA_PENDING']).toContain(
        res.body.data?.workflowState ?? res.body.data?.status,
      );
    });

    it('POST /evaluations/:id/qa-submit — QA submits answers', async () => {
      if (!evaluationId) return;

      const evalRes = await request(app.getHttpServer())
        .get(`/api/v1/evaluations/${evaluationId}`)
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(200);

      const evaluation = evalRes.body.data;
      const form = await request(app.getHttpServer())
        .get(`/api/v1/forms/${formId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const adjustedAnswers = Object.fromEntries(
        (form.body.data.questions as Array<{ key: string; type: string }>).map((q) => [
          q.key,
          { value: q.type === 'boolean' ? true : 4, overrideReason: 'QA review adjustment' },
        ]),
      );

      const res = await request(app.getHttpServer())
        .post(`/api/v1/evaluations/${evaluationId}/qa-submit`)
        .set('Authorization', `Bearer ${qaToken}`)
        .send({ adjustedAnswers, feedback: 'Good call handling.' })
        .expect(200);

      const state: string = res.body.data?.workflowState ?? res.body.data?.status ?? '';
      expect([
        'QA_COMPLETED',
        'VERIFIER_PENDING',
        'ESCALATION_PENDING',
        'LOCKED',
      ]).toContain(state);
    });
  });

  // ─── Analytics accessible ──────────────────────────────────────────────────

  describe('Analytics access', () => {
    it('GET /analytics/overview — ADMIN can access', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/overview')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const data = unwrap<{ totalConversations: number; avgFinalScore: number | null }>(res.body);
      expect(data.totalConversations).toBeDefined();
      expect(data).toHaveProperty('avgFinalScore');
    });

    it('GET /analytics/agent-performance — returns array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/agent-performance')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const data = unwrap<unknown[]>(res.body);
      expect(Array.isArray(data)).toBe(true);
    });

    it('GET /analytics/score-trends — returns array', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/analytics/score-trends')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const data = unwrap<{ byDay: unknown[]; byChannel: unknown[] }>(res.body);
      expect(Array.isArray(data.byDay)).toBe(true);
      expect(Array.isArray(data.byChannel)).toBe(true);
    });

    it('GET /analytics/overview — returns 403 for QA role', () => {
      return request(app.getHttpServer())
        .get('/api/v1/analytics/overview')
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(403);
    });
  });

  // ─── Settings ─────────────────────────────────────────────────────────────

  describe('Tenant settings', () => {
    it('GET /settings — ADMIN can retrieve settings', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const data = unwrap<{ tenant: unknown; escalation: unknown }>(res.body);
      expect(data.tenant).toBeDefined();
      expect(data.escalation).toBeDefined();
    });

    it('PATCH /settings/escalation — ADMIN can update escalation rules', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/settings/escalation')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ qaDeviationThreshold: 20, staleQueueHours: 12 })
        .expect(200);

      const data = unwrap<{ qaDeviationThreshold: number; staleQueueHours: number }>(res.body);
      expect(data.qaDeviationThreshold).toBe(20);
      expect(data.staleQueueHours).toBe(12);
    });

    it('PATCH /settings/blind-review — ADMIN can enable blind review', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/settings/blind-review')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ hideAgentFromQA: true, hideQAFromVerifier: true })
        .expect(200);

      const data = unwrap<{ hideAgentFromQA: boolean }>(res.body);
      expect(data.hideAgentFromQA).toBe(true);
    });
  });

  // ─── Billing info ─────────────────────────────────────────────────────────

  describe('Billing', () => {
    it('GET /billing — ADMIN can retrieve subscription', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/billing')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.tenant).toBeDefined();
      expect(res.body.data.subscription).toBeDefined();
    });

    it('GET /billing/usage — ADMIN can retrieve usage metrics', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/billing/usage')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.conversations).toBeDefined();
      expect(res.body.data.plan).toBeDefined();
    });

    it('GET /billing — returns 403 for QA role', () => {
      return request(app.getHttpServer())
        .get('/api/v1/billing')
        .set('Authorization', `Bearer ${qaToken}`)
        .expect(403);
    });
  });
});
