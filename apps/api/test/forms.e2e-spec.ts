import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';

import { randomBytes } from 'crypto';
const makeSlug = (prefix: string) =>
  `${prefix}-${randomBytes(4).toString('hex')}`;

// ─── Dev-tenant credentials (created by seed.ts + dev-provision.cjs) ─────────
const DEV_ADMIN_EMAIL = 'admin@dev.local';
const DEV_ADMIN_PASSWORD = 'DevAdmin123!';
const DEV_TENANT_SLUG = 'dev-tenant';

// ─── Shared app bootstrap helper ──────────────────────────────────────────────
let app: INestApplication;
let adminToken: string;
let qaToken: string;

async function bootstrapApp() {
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
}

async function loginDevAdmin() {
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .set('x-tenant-slug', DEV_TENANT_SLUG)
    .send({ email: DEV_ADMIN_EMAIL, password: DEV_ADMIN_PASSWORD })
    .expect(200);
  return res.body.data.accessToken as string;
}

// ─── Test suite ───────────────────────────────────────────────────────────────
describe('Forms — lifecycle e2e', () => {
  const slug = makeSlug('forms-e2e');
  const formKey = `e2e_qa_form_${slug}`;
  const uniqueChannel = `E2E_${slug.replace(/-/g, '_').toUpperCase()}`;
  let formId: string;

  beforeAll(async () => {
    await bootstrapApp();
    adminToken = await loginDevAdmin();
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Create ──────────────────────────────────────────────────────────────

  describe('Create form', () => {
    it('POST /forms — ADMIN creates a draft form', async () => {
    const res = await request(app.getHttpServer())
        .post('/api/v1/forms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          formKey,
          name: 'E2E QA Form',
          description: 'Integration test form',
          channels: [uniqueChannel],
          scoringStrategy: { type: 'WEIGHTED_AVERAGE', passMark: 70, scale: 100 },
          sections: [
            { id: 'sec_1', title: 'Communication', weight: 60, order: 1 },
            { id: 'sec_2', title: 'Resolution', weight: 40, order: 2 },
          ],
          questions: [
            {
              id: 'q_1',
              sectionId: 'sec_1',
              key: 'greeting',
              label: 'Did the agent greet professionally?',
              type: 'boolean',
              required: true,
              weight: 50,
              order: 1,
            },
            {
              id: 'q_2',
              sectionId: 'sec_1',
              key: 'tone',
              label: "Rate agent's tone",
              type: 'rating',
              required: true,
              weight: 50,
              order: 2,
              validation: { min: 1, max: 5 },
            },
            {
              id: 'q_3',
              sectionId: 'sec_2',
              key: 'issue_resolved',
              label: 'Was the issue resolved?',
              type: 'boolean',
              required: true,
              weight: 100,
              order: 1,
            },
          ],
        })
        .expect(201);

      formId = res.body.data.id;
      expect(formId).toBeDefined();
      expect(res.body.data.formKey).toBe(formKey);
      expect(res.body.data.status).toBe('DRAFT');
    });

    it('GET /forms/:id — returns the created form with sections and questions', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/forms/${formId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(formId);
      expect(res.body.data.sections).toHaveLength(2);
      const questionCount = res.body.data.questions.length;
      expect(questionCount).toBe(3);
    });

    it('GET /forms — lists the new form', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/forms')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const found = res.body.data.find((f: { id: string }) => f.id === formId);
      expect(found).toBeDefined();
      expect(found.status).toBe('DRAFT');
    });
  });

  // ─── Update ──────────────────────────────────────────────────────────────

  describe('Update form', () => {
    it('PATCH /forms/:id — updates name and description', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/forms/${formId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'E2E QA Form – Updated', description: 'Updated description' })
        .expect(200);

      expect(res.body.data.name).toBe('E2E QA Form – Updated');
    });
  });

  // ─── Publish lifecycle ────────────────────────────────────────────────────

  describe('Publish → Deprecate → Archive lifecycle', () => {
    it('POST /forms/:id/status — DRAFT → PUBLISHED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/forms/${formId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'publish' })
        .expect(200);

      expect(res.body.data.status).toBe('PUBLISHED');
      expect(res.body.data.publishedAt).toBeDefined();
    });

    it('PATCH /forms/:id — rejects content update after publish', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/forms/${formId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Should be rejected' })
        .expect(409);
    });

    it('POST /forms/:id/status — PUBLISHED → DEPRECATED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/forms/${formId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'deprecate' })
        .expect(200);

      expect(res.body.data.status).toBe('DEPRECATED');
    });

    it('POST /forms/:id/status — DEPRECATED → ARCHIVED', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/forms/${formId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'archive' })
        .expect(200);

      expect(res.body.data.status).toBe('ARCHIVED');
    });

    it('GET /forms/:id — archived form is still retrievable', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/forms/${formId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data.status).toBe('ARCHIVED');
    });
  });

  // ─── RBAC ─────────────────────────────────────────────────────────────────

  describe('RBAC — QA user cannot mutate forms', () => {
    let qaUserToken: string;

    beforeAll(async () => {
      // Create a QA user via invite
      const inviteRes = await request(app.getHttpServer())
        .post('/api/v1/users/invite')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ email: `qa-forms@${slug}.local`, name: 'QA User', role: 'QA' })
        .expect(201);

      const inviteToken = inviteRes.body.data.inviteToken;

      const acceptRes = await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .send({ token: inviteToken, password: 'QaPass12345!' })
        .expect(200);

      qaUserToken = acceptRes.body.data.accessToken;
    });

    it('POST /forms — QA user receives 403', () => {
      return request(app.getHttpServer())
        .post('/api/v1/forms')
        .set('Authorization', `Bearer ${qaUserToken}`)
        .send({ formKey: 'qa_attempt', name: 'QA attempt', channels: ['CHAT'] })
        .expect(403);
    });

    it('GET /forms — QA user can list forms', () => {
      return request(app.getHttpServer())
        .get('/api/v1/forms')
        .set('Authorization', `Bearer ${qaUserToken}`)
        .expect(200);
    });
  });

  // ─── Duplicate form key ───────────────────────────────────────────────────

  describe('Form key uniqueness', () => {
    it('POST /forms — duplicate formKey creates new version (v2)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/forms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          formKey,
          name: 'Duplicate Key Form',
          channels: ['CHAT'],
          scoringStrategy: { type: 'WEIGHTED_AVERAGE', passMark: 70, scale: 100 },
          sections: [],
          questions: [],
        })
        .expect(201);

      expect(res.body.data.version).toBe(2);
    });

    it('POST /forms/:id/status — blocks publishing when another form is already published for the same channel', async () => {
      const keyV1 = `single-channel-v1-${slug}`;
      const keyV2 = `single-channel-v2-${slug}`;

      const createV1 = await request(app.getHttpServer())
        .post('/api/v1/forms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          formKey: keyV1,
          name: 'Single Published V1',
          channels: [uniqueChannel],
          scoringStrategy: { type: 'WEIGHTED_AVERAGE', passMark: 70, scale: 100 },
          sections: [],
          questions: [],
        })
        .expect(201);

      const createV2 = await request(app.getHttpServer())
        .post('/api/v1/forms')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          formKey: keyV2,
          name: 'Single Published V2',
          channels: [uniqueChannel],
          scoringStrategy: { type: 'WEIGHTED_AVERAGE', passMark: 70, scale: 100 },
          sections: [],
          questions: [],
        })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/forms/${createV1.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'publish' })
        .expect(200);

      const publishV2 = await request(app.getHttpServer())
        .post(`/api/v1/forms/${createV2.body.data.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'publish' })
        .expect(409);

      expect(publishV2.body.error.code).toBe('PUBLISHED_FORM_ALREADY_EXISTS_FOR_CHANNEL');
    });

  });
});
