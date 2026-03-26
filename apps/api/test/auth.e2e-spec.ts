import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { RequestIdInterceptor } from '../src/common/interceptors/request-id.interceptor';

describe('Auth (e2e)', () => {
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
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    app.useGlobalInterceptors(new RequestIdInterceptor());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health — liveness', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
      });
  });

  it('POST /api/v1/auth/login — rejects invalid credentials', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@nowhere.com', password: 'wrongpassword12!' })
      .expect(401)
      .expect((res) => {
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      });
  });

  it('POST /api/v1/auth/login — rejects missing body fields', () => {
    return request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email' })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      });
  });

  it('GET /api/v1/auth/me — rejects unauthenticated', () => {
    return request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('GET /api/v1/users — rejects unauthenticated', () => {
    return request(app.getHttpServer()).get('/api/v1/users').expect(401);
  });

  describe('Full signup → login flow', () => {
    const slug = `test-tenant-${Date.now()}`;
    let accessToken: string;

    it('POST /api/v1/auth/signup — creates tenant', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          tenantName: 'Test Tenant',
          tenantSlug: slug,
          adminEmail: `admin@${slug}.com`,
          adminName: 'Test Admin',
          password: 'TestPassword123!',
          plan: 'BASIC',
        })
        .expect(201);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.tenant.slug).toBe(slug);
      accessToken = res.body.data.accessToken;
    });

    it('POST /api/v1/auth/signup — rejects duplicate slug', () => {
      return request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({
          tenantName: 'Test Tenant 2',
          tenantSlug: slug,
          adminEmail: `admin2@${slug}.com`,
          adminName: 'Another Admin',
          password: 'TestPassword123!',
          plan: 'BASIC',
        })
        .expect(409)
        .expect((res) => {
          expect(res.body.error.code).toBe('TENANT_SLUG_TAKEN');
        });
    });

    it('GET /api/v1/auth/me — returns current user with valid token', () => {
      return request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.data.email).toBeDefined();
          expect(res.body.data.role).toBe('ADMIN');
        });
    });

    it('POST /api/v1/auth/login — returns tokens for valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('x-tenant-slug', slug)
        .send({ email: `admin@${slug}.com`, password: 'TestPassword123!' })
        .expect(200);

      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
    });
  });
});
