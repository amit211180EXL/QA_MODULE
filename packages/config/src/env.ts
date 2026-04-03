import { z } from 'zod';
import { config as loadDotenv } from 'dotenv';
import { resolve } from 'path';

// Load .env from the app that consumes this package (walk up from cwd)
loadDotenv({ path: resolve(process.cwd(), '.env') });

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_URL: z.string().url().default('http://localhost:3000'),
  WEB_URL: z.string().url().default('http://localhost:3001'),

  // Master Database
  MASTER_DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_ENABLED: z.enum(['true', 'false']).default('true'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  // Queue worker tuning
  EVAL_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  TENANT_PROVISION_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  AUTOSCALE_EVAL_MIN_REPLICAS: z.coerce.number().int().positive().default(1),
  AUTOSCALE_EVAL_MAX_REPLICAS: z.coerce.number().int().positive().default(20),
  AUTOSCALE_EVAL_TARGET_BACKLOG_PER_REPLICA: z.coerce.number().int().positive().default(25),
  AUTOSCALE_TENANT_PROVISION_MIN_REPLICAS: z.coerce.number().int().positive().default(1),
  AUTOSCALE_TENANT_PROVISION_MAX_REPLICAS: z.coerce.number().int().positive().default(10),
  AUTOSCALE_TENANT_PROVISION_TARGET_BACKLOG_PER_REPLICA: z.coerce.number()
    .int()
    .positive()
    .default(5),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_SECRET: z.string().min(32),
  REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Encryption (AES-256-GCM): must be 64 hex chars = 32 bytes
  MASTER_ENCRYPTION_KEY: z.string().length(64),

  // Tenant DB provisioning
  TENANT_DB_HOST: z.string().default('localhost'),
  TENANT_DB_PORT: z.coerce.number().default(5432),
  TENANT_DB_SUPERUSER: z.string().min(1),
  TENANT_DB_SUPERUSER_PASSWORD: z.string().min(1),
  TENANT_READ_DB_HOST: z.string().optional(),
  TENANT_READ_DB_PORT: z.coerce.number().default(5432),

  // Email
  EMAIL_FROM: z.string().email().default('noreply@qa-platform.local'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // Stripe (optional in dev/test)
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // Platform admin token (protects internal routes)
  PLATFORM_ADMIN_TOKEN: z.string().min(32).optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let _env: AppEnv;

export function loadEnv(): AppEnv {
  if (_env) return _env;

  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.format();
    throw new Error(
      `Environment validation failed:\n${JSON.stringify(formatted, null, 2)}`,
    );
  }
  _env = result.data;
  return _env;
}

export function getEnv(): AppEnv {
  if (!_env) return loadEnv();
  return _env;
}
