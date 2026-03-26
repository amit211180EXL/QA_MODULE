import { z } from 'zod';

const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_URL: z.string().url().default('http://localhost:3000'),

  // Master Database
  MASTER_DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

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
