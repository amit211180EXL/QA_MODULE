import { Worker, Job } from 'bullmq';
import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import { Client as PgClient } from 'pg';
import { getMasterClient } from '@qa/prisma-master';
import { createTenantClient } from '@qa/prisma-tenant';
import { getEnv, loadEnv } from '@qa/config';
import { encrypt } from '../common/utils/encryption.util';
import { renderTemplate } from '../notify/notify.service';
import { TenantProvisionJobPayload, QUEUE_NAMES } from '@qa/shared';
import { resolve } from 'path';

loadEnv();

const TENANT_MIGRATIONS_PATH = resolve(__dirname, '../../../../packages/prisma-tenant/prisma');

async function handleProvision(job: Job<TenantProvisionJobPayload>) {
  const { tenantId, adminUserId } = job.data;
  const env = getEnv();
  const masterDb = getMasterClient();

  console.log(`[provision] Starting tenant ${tenantId}`);

  // 1. Generate unique DB credentials
  const dbName = `qa_tenant_${tenantId.replace(/-/g, '_').slice(0, 24)}`;
  const dbUser = `qa_user_${tenantId.replace(/-/g, '_').slice(0, 24)}`;
  const dbPassword = randomBytes(24).toString('base64url');

  // 2. Create database and user
  const superuserClient = new PgClient({
    host: env.TENANT_DB_HOST,
    port: env.TENANT_DB_PORT,
    user: env.TENANT_DB_SUPERUSER,
    password: env.TENANT_DB_SUPERUSER_PASSWORD,
    database: 'postgres',
    ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  });

  await superuserClient.connect();

  try {
    await superuserClient.query(
      `CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword.replace(/'/g, "''")}'`,
    );
    await superuserClient.query(`CREATE DATABASE "${dbName}" OWNER "${dbUser}"`);
    await superuserClient.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbUser}"`);
  } finally {
    await superuserClient.end();
  }

  console.log(`[provision] DB created: ${dbName}`);

  // 3. Encrypt password and store credentials
  const dbPasswordEnc = encrypt(dbPassword);

  await masterDb.tenant.update({
    where: { id: tenantId },
    data: {
      dbHost: env.TENANT_DB_HOST,
      dbPort: env.TENANT_DB_PORT,
      dbName,
      dbUser,
      dbPasswordEnc,
    },
  });

  // 4. Run Prisma migrations against new tenant DB
  const tenantDbUrl = `postgresql://${dbUser}:${encodeURIComponent(dbPassword)}@${env.TENANT_DB_HOST}:${env.TENANT_DB_PORT}/${dbName}`;

  execSync(`pnpm prisma migrate deploy --schema=${TENANT_MIGRATIONS_PATH}/schema.prisma`, {
    env: { ...process.env, TENANT_DATABASE_URL: tenantDbUrl },
    stdio: 'pipe',
  });

  console.log(`[provision] Migrations applied for tenant ${tenantId}`);

  // 5. Seed tenant defaults
  const tenantClient = createTenantClient(tenantDbUrl);
  try {
    await tenantClient.$connect();

    // Starter form template (DRAFT)
    await tenantClient.formDefinition.create({
      data: {
        formKey: 'starter_template',
        version: 1,
        name: 'Starter QA Template',
        description: 'Default template — customize before publishing',
        status: 'DRAFT',
        channels: ['CHAT', 'EMAIL'],
        scoringStrategy: {
          type: 'weighted_sections',
          passMark: 70,
          scale: 100,
          roundingPolicy: 'round',
        },
        sections: [
          { id: 'sec_1', title: 'Communication', weight: 50, order: 1 },
          { id: 'sec_2', title: 'Resolution', weight: 50, order: 2 },
        ],
        questions: [
          {
            id: 'q_1',
            sectionId: 'sec_1',
            key: 'greeting',
            label: 'Did the agent greet the customer?',
            type: 'boolean',
            required: true,
            weight: 50,
            order: 1,
            rubric: { goal: 'Professional greeting', anchors: [] },
          },
          {
            id: 'q_2',
            sectionId: 'sec_1',
            key: 'tone',
            label: "Rate the agent's tone",
            type: 'rating',
            required: true,
            weight: 50,
            order: 2,
            validation: { min: 1, max: 5 },
            rubric: {
              goal: 'Empathetic and professional',
              anchors: [
                { value: 1, label: 'Very poor' },
                { value: 5, label: 'Excellent' },
              ],
            },
          },
          {
            id: 'q_3',
            sectionId: 'sec_2',
            key: 'issue_resolved',
            label: 'Was the issue resolved?',
            type: 'boolean',
            required: true,
            weight: 60,
            order: 1,
          },
          {
            id: 'q_4',
            sectionId: 'sec_2',
            key: 'resolution_time',
            label: 'How would you rate the resolution speed?',
            type: 'rating',
            required: true,
            weight: 40,
            order: 2,
            validation: { min: 1, max: 5 },
          },
        ],
        createdById: adminUserId,
      },
    });
  } finally {
    await tenantClient.$disconnect();
  }

  // 6. Activate admin user + tenant
  await masterDb.user.update({
    where: { id: adminUserId },
    data: { status: 'ACTIVE' },
  });

  await masterDb.escalationRule.create({
    data: {
      tenantId,
      qaDeviationThreshold: 15,
      verifierDeviationThreshold: 10,
      staleQueueHours: 24,
    },
  });

  await masterDb.blindReviewSettings.create({
    data: { tenantId, hideAgentFromQA: false, hideQAFromVerifier: false },
  });

  await masterDb.tenant.update({
    where: { id: tenantId },
    data: { status: 'ACTIVE' },
  });

  console.log(`[provision] Tenant ${tenantId} is now ACTIVE`);

  // Notify admin that the workspace is ready (best-effort — non-fatal)
  const adminUser = await masterDb.user.findUnique({
    where: { id: adminUserId },
    select: { email: true, name: true, tenant: { select: { name: true } } },
  });
  if (adminUser) {
    const { text } = renderTemplate('tenant_ready', {
      adminName: adminUser.name,
      tenantName: adminUser.tenant?.name ?? '',
      loginUrl: `${env.API_URL.replace('/api', '')}/login`,
    });
    // Log the notification in all environments (SMTP send would go here)
    console.log(`[provision] tenant_ready notification for ${adminUser.email}:\n${text}`);
  }
}

export function startProvisionWorker() {
  const env = getEnv();
  const concurrency = Math.max(1, env.TENANT_PROVISION_WORKER_CONCURRENCY);

  const worker = new Worker<TenantProvisionJobPayload>(
    QUEUE_NAMES.TENANT_PROVISION,
    handleProvision,
    {
      connection: { host: env.REDIS_HOST, port: env.REDIS_PORT, password: env.REDIS_PASSWORD },
      concurrency,
    },
  );

  worker.on('completed', (job) => {
    console.log(`[provision] Job ${job.id} completed`);
  });

  worker.on('failed', (job, err) => {
    console.error(`[provision] Job ${job?.id} failed: ${err.message}`);
    // On exhaustion, tenant stays PROVISIONING — ops alert would fire here
  });

  return worker;
}
