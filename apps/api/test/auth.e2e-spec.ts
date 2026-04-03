import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from '../src/common/interceptors/logging.interceptor';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Unique slug per test run — avoids collisions on repeated runs. */
const makeSlug = (prefix: string) => `${prefix}-${Date.now()}`;

describe('QA Platform — Integration Tests', () => {
  let app: INestApplication;

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
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Health ────────────────────────────────────────────────────────────────

  describe('Health', () => {
    it('GET /health — liveness returns ok', () => {
      return request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe('ok');
        });
    });

    it('GET /health/ready — returns ok or degraded', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
      expect(['ok', 'degraded']).toContain(res.body.status);
      expect(res.body.checks).toBeDefined();
    });

    it('GET /health/metrics — returns Prometheus metrics text', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/health/metrics').expect(200);
      expect(typeof res.text).toBe('string');
      expect(res.text).toContain('http_requests_total');
      expect(res.text).toContain('process_cpu_user_seconds_total');
      expect(res.text).toContain('queue_jobs_waiting');
      expect(res.text).toContain('queue_jobs_active');
      expect(res.text).toContain('queue_autoscale_recommended_replicas');
    });
  });

  // ─── Auth — input validation ───────────────────────────────────────────────

  describe('Auth — input validation', () => {
    it('POST /auth/login — rejects invalid credentials', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@nowhere.com', password: 'wrongpassword12!' })
        .expect(401)
        .expect((res) => {
          expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
        });
    });

    it('POST /auth/login — rejects malformed body', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email' })
        .expect(400)
        .expect((res) => {
          expect(res.body.error.code).toBe('VALIDATION_ERROR');
        });
    });

    it('GET /auth/me — rejects unauthenticated request', () => {
      return request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('GET /users — rejects unauthenticated request', () => {
      return request(app.getHttpServer()).get('/api/v1/users').expect(401);
    });
  });

  // ─── Signup → Login ────────────────────────────────────────────────────────

  describe('Signup → Login', () => {
    const tenantSlug = makeSlug('e2e-signup');
    const adminEmail = `admin@${tenantSlug}.com`;
    const password = 'TestPassword123!';
    let accessToken: string;
    let refreshToken: string;

    it('POST /auth/signup — creates tenant + admin user', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          tenantName: 'E2E Test Tenant',
          tenantSlug,
          adminEmail,
          adminName: 'E2E Admin',
          password,
          plan: 'PRO',
        })
        .expect(201);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      expect(res.body.data.tenant.slug).toBe(tenantSlug);
      accessToken = res.body.data.accessToken;
      refreshToken = res.body.data.refreshToken;
    });

    it('POST /auth/signup — rejects duplicate slug', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          tenantName: 'Duplicate',
          tenantSlug,
          adminEmail: `other@${tenantSlug}.com`,
          adminName: 'Other Admin',
          password,
          plan: 'BASIC',
        })
        .expect(409)
        .expect((res) => {
          expect(res.body.error.code).toBe('TENANT_SLUG_TAKEN');
        });
    });

    it('GET /auth/me — returns current user profile', () => {
      return request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.email).toBe(adminEmail);
          expect(res.body.data.role).toBe('ADMIN');
        });
    });

    it('POST /auth/login — returns tokens for valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('x-tenant-slug', tenantSlug)
        .send({ email: adminEmail, password })
        .expect(200);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      accessToken = res.body.data.accessToken;
      refreshToken = res.body.data.refreshToken;
    });

    // ─── Token refresh → logout cycle ────────────────────────────────────────

    describe('Token refresh → logout cycle', () => {
      let newAccessToken: string;
      let newRefreshToken: string;

      it('POST /auth/refresh — issues new token pair', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refreshToken })
          .expect(200);

        expect(res.body.data.accessToken).toBeDefined();
        expect(res.body.data.refreshToken).toBeDefined();
        newAccessToken = res.body.data.accessToken;
        newRefreshToken = res.body.data.refreshToken;
      });

      it('POST /auth/refresh — rejects the already-rotated (stale) refresh token', () => {
        return request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refreshToken }) // stale — already rotated above
          .expect(401)
          .expect((res) => {
            expect(res.body.error.code).toBe('TOKEN_REVOKED');
          });
      });

      it('GET /auth/me — new access token is valid', () => {
        return request(app.getHttpServer())
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${newAccessToken}`)
          .expect(200);
      });

      it('POST /auth/logout — revokes the active refresh token', async () => {
        await request(app.getHttpServer())
          .post('/api/v1/auth/logout')
          .set('Authorization', `Bearer ${newAccessToken}`)
          .send({ refreshToken: newRefreshToken })
          .expect(200);
      });

      it('POST /auth/refresh — rejects revoked token after logout', () => {
        return request(app.getHttpServer())
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: newRefreshToken })
          .expect(401)
          .expect((res) => {
            expect(res.body.error.code).toBe('TOKEN_REVOKED');
          });
      });
    });

    // ─── Invite → accept invite → login ──────────────────────────────────────

    describe('Invite user → accept invite → login', () => {
      const qaEmail = `qa@${tenantSlug}.com`;
      const qaPassword = 'QaPassword123!';
      let inviteToken: string;
      let qaAccessToken: string;
      let freshAdminToken: string;

      beforeAll(async () => {
        // Re-login admin — previous session was logged out in the refresh/logout suite
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('x-tenant-slug', tenantSlug)
          .send({ email: adminEmail, password });
        freshAdminToken = res.body.data.accessToken;
      });

      it('POST /users/invite — admin creates QA user', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/users/invite')
          .set('Authorization', `Bearer ${freshAdminToken}`)
          .send({ email: qaEmail, name: 'QA Reviewer', role: 'QA' })
          .expect(201);

        expect(res.body.data.user.email).toBe(qaEmail);
        expect(res.body.data.user.status).toBe('INVITED');
        expect(res.body.data.inviteToken).toBeDefined();
        inviteToken = res.body.data.inviteToken;
      });

      it('POST /auth/accept-invite — activates user and returns tokens', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/accept-invite')
          .send({ token: inviteToken, password: qaPassword })
          .expect(200);

        expect(res.body.data.accessToken).toBeDefined();
        expect(res.body.data.user.role).toBe('QA');
        qaAccessToken = res.body.data.accessToken;
      });

      it('POST /auth/accept-invite — rejects same token a second time', () => {
        return request(app.getHttpServer())
          .post('/api/v1/auth/accept-invite')
          .send({ token: inviteToken, password: qaPassword })
          .expect(400)
          .expect((res) => {
            expect(res.body.error.code).toBe('INVITE_ALREADY_USED');
          });
      });

      it('POST /auth/login — accepted QA user can log in', async () => {
        const res = await request(app.getHttpServer())
          .post('/api/v1/auth/login')
          .set('x-tenant-slug', tenantSlug)
          .send({ email: qaEmail, password: qaPassword })
          .expect(200);

        expect(res.body.data.user.role).toBe('QA');
      });

      // ─── RBAC enforcement ─────────────────────────────────────────────────

      describe('RBAC — role × route enforcement', () => {
        it('GET /users — QA user receives 403 INSUFFICIENT_ROLE', () => {
          return request(app.getHttpServer())
            .get('/api/v1/users')
            .set('Authorization', `Bearer ${qaAccessToken}`)
            .expect(403)
            .expect((res) => {
              expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
            });
        });

        it('POST /users/invite — QA user receives 403 INSUFFICIENT_ROLE', () => {
          return request(app.getHttpServer())
            .post('/api/v1/users/invite')
            .set('Authorization', `Bearer ${qaAccessToken}`)
            .send({ email: 'other@test.com', name: 'Other', role: 'QA' })
            .expect(403)
            .expect((res) => {
              expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
            });
        });

        it('PUT /llm-config — QA user receives 403 INSUFFICIENT_ROLE', () => {
          return request(app.getHttpServer())
            .put('/api/v1/llm-config')
            .set('Authorization', `Bearer ${qaAccessToken}`)
            .send({ enabled: true, provider: 'OPENAI', model: 'gpt-4o', apiKey: 'sk-test' })
            .expect(403);
        });

        it('GET /analytics/overview — QA user receives 403 INSUFFICIENT_ROLE', () => {
          return request(app.getHttpServer())
            .get('/api/v1/analytics/overview')
            .set('Authorization', `Bearer ${qaAccessToken}`)
            .expect(403);
        });

        it('GET /users — ADMIN user can list users', () => {
          return request(app.getHttpServer())
            .get('/api/v1/users')
            .set('Authorization', `Bearer ${freshAdminToken}`)
            .expect(200)
            .expect((res) => {
              expect(Array.isArray(res.body.data)).toBe(true);
            });
        });
      });
    });
  });

  // ─── Tenant isolation ──────────────────────────────────────────────────────

  describe('Tenant isolation', () => {
    const slugA = makeSlug('e2e-iso-a');
    const slugB = makeSlug('e2e-iso-b');
    let tokenA: string;
    let tokenB: string;

    beforeAll(async () => {
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .post('/api/v1/auth/signup')
          .send({
            tenantName: 'Isolation A',
            tenantSlug: slugA,
            adminEmail: `admin@${slugA}.com`,
            adminName: 'Admin A',
            password: 'IsolationPass123!',
            plan: 'BASIC',
          }),
        request(app.getHttpServer())
          .post('/api/v1/auth/signup')
          .send({
            tenantName: 'Isolation B',
            tenantSlug: slugB,
            adminEmail: `admin@${slugB}.com`,
            adminName: 'Admin B',
            password: 'IsolationPass123!',
            plan: 'BASIC',
          }),
      ]);

      tokenA = resA.body.data.accessToken;
      tokenB = resB.body.data.accessToken;
    });

    it('Tenant A and Tenant B user lists are disjoint', async () => {
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .get('/api/v1/users')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200),
        request(app.getHttpServer())
          .get('/api/v1/users')
          .set('Authorization', `Bearer ${tokenB}`)
          .expect(200),
      ]);

      const emailsA = new Set<string>(resA.body.data.map((u: { email: string }) => u.email));
      const emailsB = new Set<string>(resB.body.data.map((u: { email: string }) => u.email));

      for (const email of emailsB) {
        expect(emailsA.has(email)).toBe(false);
      }
    });

    it('GET /auth/me — each token returns its own tenant email only', async () => {
      const [resA, resB] = await Promise.all([
        request(app.getHttpServer())
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${tokenA}`)
          .expect(200),
        request(app.getHttpServer())
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${tokenB}`)
          .expect(200),
      ]);

      expect(resA.body.data.email).toBe(`admin@${slugA}.com`);
      expect(resB.body.data.email).toBe(`admin@${slugB}.com`);
    });
  });

  // ─── Response sanitization ─────────────────────────────────────────────────

  describe('Response sanitization', () => {
    it('Sensitive fields never appear in any response body', async () => {
      const signupSlug = makeSlug('e2e-sanitize');
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          tenantName: 'Sanitize Test',
          tenantSlug: signupSlug,
          adminEmail: `admin@${signupSlug}.com`,
          adminName: 'Sanitize Admin',
          password: 'SanitizePass123!',
          plan: 'BASIC',
        })
        .expect(201);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('dbPasswordEnc');
      expect(body).not.toContain('apiKeyEnc');
    });

    it('Error responses include meta.requestId', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'x@x.com', password: 'wrongpass1234!' })
        .expect(401);

      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.requestId).toBeDefined();
    });
  });
});
