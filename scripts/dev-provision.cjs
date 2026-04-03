'use strict';
/**
 * Dev provisioning script — runs tenant provisioning without Redis/BullMQ.
 * Usage: node scripts/dev-provision.cjs [tenantSlug]
 *
 * Provisions ALL PROVISIONING tenants (or just slug if provided) by:
 *   1. Creating PostgreSQL DB + user per tenant
 *   2. Running Prisma migrations on tenant DB
 *   3. Seeding starter form template
 *   4. Marking tenant + admin ACTIVE
 */
const { readFileSync } = require('fs');
const { resolve } = require('path');
const { execSync } = require('child_process');
const { randomBytes, createCipheriv } = require('crypto');

const ROOT = resolve(__dirname, '..');

// ── Load .env from apps/api ────────────────────────────────────────────────
const envLines = readFileSync(resolve(ROOT, 'apps/api/.env'), 'utf8').split('\n');
for (const line of envLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
  const idx = trimmed.indexOf('=');
  const key = trimmed.slice(0, idx).trim();
  const val = trimmed.slice(idx + 1).trim();
  if (!process.env[key]) process.env[key] = val;
}

const MASTER_DATABASE_URL = process.env.MASTER_DATABASE_URL;
const ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY;
const TENANT_DB_HOST = process.env.TENANT_DB_HOST || 'localhost';
const TENANT_DB_PORT = parseInt(process.env.TENANT_DB_PORT || '5432', 10);
const SUPERUSER = process.env.TENANT_DB_SUPERUSER || 'postgres';
const SUPERUSER_PASS = process.env.TENANT_DB_SUPERUSER_PASSWORD || '';
const TENANT_MIGRATIONS_PATH = resolve(ROOT, 'packages/prisma-tenant/prisma');

const { Client: PgClient } = require(resolve(ROOT, 'apps/api/node_modules/pg'));
const { PrismaClient } = require(resolve(ROOT, 'packages/prisma-master/generated/master-client'));
const { PrismaClient: TenantPrismaClient } = require(resolve(ROOT, 'packages/prisma-tenant/generated/tenant-client'));

function encrypt(text) {
  // Must match apps/api/src/common/utils/encryption.util.ts format:
  // base64(iv[12] + tag[16] + ciphertext)
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag(); // 16 bytes
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

async function provisionTenant(tenant, adminUserId) {
  const { id: tenantId, slug } = tenant;
  const masterDb = new PrismaClient({ datasources: { db: { url: MASTER_DATABASE_URL } } });

  const safeId = tenantId.replace(/[^a-z0-9]/gi, '_').slice(0, 24);
  const dbName = `qa_tenant_${safeId}`;
  const dbUser = `qa_user_${safeId}`;
  const dbPassword = randomBytes(24).toString('base64url');

  console.log(`\n[provision] ${slug} (${tenantId})`);
  console.log(`  DB: ${dbName}   User: ${dbUser}`);

  // 1. Create PG DB and user
  const pgClient = new PgClient({
    host: TENANT_DB_HOST,
    port: TENANT_DB_PORT,
    user: SUPERUSER,
    password: SUPERUSER_PASS,
    database: 'postgres',
  });
  await pgClient.connect();
  try {
    await pgClient.query(`DROP DATABASE IF EXISTS "${dbName}"`);
    await pgClient.query(`DROP USER IF EXISTS "${dbUser}"`);
    await pgClient.query(`CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword.replace(/'/g, "''")}'`);
    await pgClient.query(`CREATE DATABASE "${dbName}"`);
    await pgClient.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbUser}"`);
    console.log('  [OK] PostgreSQL DB created');
  } finally {
    await pgClient.end();
  }

  // Grant schema access in the new database
  const schemaClient = new PgClient({
    host: TENANT_DB_HOST,
    port: TENANT_DB_PORT,
    user: SUPERUSER,
    password: SUPERUSER_PASS,
    database: dbName,
  });
  await schemaClient.connect();
  try {
    await schemaClient.query(`GRANT USAGE, CREATE ON SCHEMA public TO "${dbUser}"`);
    await schemaClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "${dbUser}"`);
    await schemaClient.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "${dbUser}"`);
    console.log('  [OK] Schema permissions granted');
  } finally {
    await schemaClient.end();
  }

  // 2. Store credentials in master DB
  const dbPasswordEnc = encrypt(dbPassword);
  await masterDb.tenant.update({
    where: { id: tenantId },
    data: { dbHost: TENANT_DB_HOST, dbPort: TENANT_DB_PORT, dbName, dbUser, dbPasswordEnc },
  });

  // 3. Run Prisma migrations on tenant DB
  const tenantDbUrl = `postgresql://${dbUser}:${encodeURIComponent(dbPassword)}@${TENANT_DB_HOST}:${TENANT_DB_PORT}/${dbName}`;
  console.log('  Applying Prisma migrations...');
  const prismaBin = resolve(ROOT, 'packages/prisma-tenant/node_modules/.bin/prisma.cmd');
  execSync(
    `"${prismaBin}" migrate deploy --schema="${TENANT_MIGRATIONS_PATH}/schema.prisma"`,
    {
      cwd: resolve(ROOT, 'packages/prisma-tenant'),
      env: { ...process.env, TENANT_DATABASE_URL: tenantDbUrl },
      stdio: 'pipe',
      shell: true,
    }
  );
  console.log('  [OK] Migrations applied');

  // 4. Seed starter form
  const tenantDb = new TenantPrismaClient({ datasources: { db: { url: tenantDbUrl } } });
  await tenantDb.$connect();
  try {
    const existing = await tenantDb.formDefinition.findFirst({ where: { formKey: 'starter_template' } });
    if (!existing) {
      await tenantDb.formDefinition.create({
        data: {
          formKey: 'starter_template',
          version: 1,
          name: 'Starter QA Template',
          description: 'Default template — customize before publishing',
          status: 'DRAFT',
          channels: ['CHAT', 'EMAIL'],
          scoringStrategy: { type: 'weighted_sections', passMark: 70, scale: 100 },
          sections: [
            { id: 'sec_1', title: 'Communication', weight: 50, order: 1 },
            { id: 'sec_2', title: 'Resolution', weight: 50, order: 2 },
          ],
          questions: [
            { id: 'q_1', sectionId: 'sec_1', key: 'greeting', label: 'Did the agent greet professionally?', type: 'boolean', required: true, weight: 50, order: 1 },
            { id: 'q_2', sectionId: 'sec_1', key: 'tone', label: "Rate the agent's tone", type: 'rating', required: true, weight: 50, order: 2, validation: { min: 1, max: 5 } },
            { id: 'q_3', sectionId: 'sec_2', key: 'issue_resolved', label: 'Was the issue resolved?', type: 'boolean', required: true, weight: 60, order: 1 },
            { id: 'q_4', sectionId: 'sec_2', key: 'resolution_time', label: 'Rate the resolution speed', type: 'rating', required: true, weight: 40, order: 2, validation: { min: 1, max: 5 } },
          ],
          ...(adminUserId ? { createdById: adminUserId } : {}),
        },
      });
      console.log('  [OK] Starter form seeded');
    } else {
      console.log('  [SKIP] Starter form already exists');
    }

    // Seed 3 sample conversations for demo
    await tenantDb.conversation.createMany({
      data: [
        {
          externalId: 'DEMO-001',
          channel: 'CHAT',
          agentId: 'agent-demo-1',
          agentName: 'Sarah Johnson',
          customerRef: 'cust-001',
          content: [
            { role: 'agent', text: 'Hello! How can I help you today?', ts: new Date(Date.now() - 3600000).toISOString() },
            { role: 'customer', text: 'Hi, I have a question about my bill.', ts: new Date(Date.now() - 3580000).toISOString() },
            { role: 'agent', text: 'Of course! I can see your account. Your last invoice was $125.50 for March.', ts: new Date(Date.now() - 3560000).toISOString() },
            { role: 'customer', text: 'That seems higher than usual.', ts: new Date(Date.now() - 3540000).toISOString() },
            { role: 'agent', text: 'I\'ll apply a courtesy adjustment of $15 for you. Is there anything else?', ts: new Date(Date.now() - 3520000).toISOString() },
            { role: 'customer', text: 'That is great, thank you!', ts: new Date(Date.now() - 3500000).toISOString() },
          ],
          metadata: { topic: 'billing_inquiry', duration_seconds: 342 },
          status: 'PENDING',
          receivedAt: new Date(Date.now() - 3600000),
        },
        {
          externalId: 'DEMO-002',
          channel: 'EMAIL',
          agentId: 'agent-demo-2',
          agentName: 'Mike Chen',
          customerRef: 'cust-002',
          content: [
            { role: 'customer', text: 'My device keeps disconnecting from wifi.', ts: new Date(Date.now() - 86400000).toISOString() },
            { role: 'agent', text: 'Please try Settings > General > Reset Network Settings.', ts: new Date(Date.now() - 82800000).toISOString() },
            { role: 'customer', text: 'That worked! Thank you.', ts: new Date(Date.now() - 79200000).toISOString() },
          ],
          metadata: { topic: 'technical_support' },
          status: 'QA_REVIEW',
          receivedAt: new Date(Date.now() - 86400000),
        },
        {
          externalId: 'DEMO-003',
          channel: 'CHAT',
          agentId: 'agent-demo-1',
          agentName: 'Sarah Johnson',
          customerRef: 'cust-003',
          content: [
            { role: 'customer', text: 'I want to return a product I ordered last week.', ts: new Date(Date.now() - 7200000).toISOString() },
            { role: 'agent', text: 'I\'ll help you with that. What is the order number?', ts: new Date(Date.now() - 7180000).toISOString() },
            { role: 'customer', text: 'Order #98765.', ts: new Date(Date.now() - 7160000).toISOString() },
            { role: 'agent', text: 'I\'ve initiated the return. You\'ll receive a prepaid label by email within 24 hours.', ts: new Date(Date.now() - 7140000).toISOString() },
          ],
          metadata: { topic: 'returns' },
          status: 'COMPLETED',
          receivedAt: new Date(Date.now() - 7200000),
        },
      ],
    });
    console.log('  [OK] Demo conversations seeded (3)');
  } finally {
    await tenantDb.$disconnect();
  }

  // 5. Ensure master-DB support records exist
  const noEscalation = !(await masterDb.escalationRule.findFirst({ where: { tenantId } }));
  if (noEscalation) {
    await masterDb.escalationRule.create({
      data: { tenantId, qaDeviationThreshold: 15, verifierDeviationThreshold: 10, staleQueueHours: 24 },
    });
  }
  const noBlindReview = !(await masterDb.blindReviewSettings.findFirst({ where: { tenantId } }));
  if (noBlindReview) {
    await masterDb.blindReviewSettings.create({
      data: { tenantId, hideAgentFromQA: false, hideQAFromVerifier: false },
    });
  }

  // 6. Activate tenant and all non-INACTIVE users
  await masterDb.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
  await masterDb.user.updateMany({ where: { tenantId, status: { not: 'INACTIVE' } }, data: { status: 'ACTIVE' } });
  await masterDb.$disconnect();

  console.log(`  [DONE] Tenant "${slug}" is now ACTIVE`);
}

async function main() {
  const targetSlug = process.argv[2];
  const masterDb = new PrismaClient({ datasources: { db: { url: MASTER_DATABASE_URL } } });

  const tenants = await masterDb.tenant.findMany({
    where: targetSlug ? { slug: targetSlug } : { status: 'PROVISIONING' },
    include: { users: { where: { role: 'ADMIN' }, take: 1 } },
  });
  await masterDb.$disconnect();

  if (tenants.length === 0) {
    console.log(targetSlug ? `Tenant "${targetSlug}" not found or already ACTIVE.` : 'No PROVISIONING tenants found.');
    process.exit(0);
  }

  console.log(`Provisioning ${tenants.length} tenant(s): ${tenants.map(t => t.slug).join(', ')}`);

  for (const tenant of tenants) {
    await provisionTenant(tenant, tenant.users[0]?.id);
  }

  console.log('\nAll done!');
}

main().catch(err => {
  console.error('\n[FATAL]', err.message);
  console.error(err.stack);
  process.exit(1);
});
