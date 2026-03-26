/**
 * Dev provisioning script — runs tenant provisioning without Redis/BullMQ.
 * Usage: node scripts/dev-provision.cjs [tenantSlug]
 */
// NOTE: This is actually CJS despite .mjs extension; rename handled below
const { readFileSync } = require('fs');
const { resolve } = require('path');
const { execSync } = require('child_process');
const { randomBytes, createCipheriv } = require('crypto');
const { Client: PgClient } = require('../apps/api/node_modules/pg');
const { PrismaClient } = require('../packages/prisma-master/node_modules/@prisma/client');

const ROOT = resolve(__dirname, '..');

// Load .env from apps/api
const envPath = resolve(ROOT, 'apps/api/.env');
const envVars = readFileSync(envPath, 'utf8')
  .split('\n')
  .filter(l => l && !l.startsWith('#') && l.includes('='))
  .reduce((acc, line) => {
    const [k, ...rest] = line.split('=');
    acc[k.trim()] = rest.join('=').trim();
    return acc;
  }, {});

Object.entries(envVars).forEach(([k, v]) => { if (!process.env[k]) process.env[k] = v; });

const MASTER_DATABASE_URL = process.env.MASTER_DATABASE_URL;
const ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY;
const TENANT_DB_HOST = process.env.TENANT_DB_HOST || 'localhost';
const TENANT_DB_PORT = parseInt(process.env.TENANT_DB_PORT || '5432');
const SUPERUSER = process.env.TENANT_DB_SUPERUSER || 'postgres';
const SUPERUSER_PASS = process.env.TENANT_DB_SUPERUSER_PASSWORD || '';
const TENANT_MIGRATIONS_PATH = resolve(ROOT, 'packages/prisma-tenant/prisma');

function encrypt(text) {
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
}

async function provisionTenant(tenantId, adminUserId) {
  const masterDb = new PrismaClient({ datasources: { db: { url: MASTER_DATABASE_URL } } });
  const slug = tenantId.replace(/-/g, '_').slice(0, 24);
  const dbName = `qa_tenant_${slug}`;
  const dbUser = `qa_user_${slug}`;
  const dbPassword = randomBytes(24).toString('base64url');

  console.log(`\n[provision] Tenant: ${tenantId}`);
  console.log(`  DB: ${dbName}  User: ${dbUser}`);

  // 1. Create PG user + database using superuser
  const pgClient = new pg.Client({
    host: TENANT_DB_HOST,
    port: TENANT_DB_PORT,
    user: SUPERUSER,
    password: SUPERUSER_PASS,
    database: 'postgres',
  });

  await pgClient.connect();
  try {
    // Drop if exists (idempotent)
    await pgClient.query(`DROP DATABASE IF EXISTS "${dbName}"`).catch(() => {});
    await pgClient.query(`DROP USER IF EXISTS "${dbUser}"`).catch(() => {});
    await pgClient.query(`CREATE USER "${dbUser}" WITH PASSWORD '${dbPassword.replace(/'/g, "''")}'`);
    await pgClient.query(`CREATE DATABASE "${dbName}" OWNER "${dbUser}"`);
    await pgClient.query(`GRANT ALL PRIVILEGES ON DATABASE "${dbName}" TO "${dbUser}"`);
    console.log(`  [OK] PostgreSQL DB created`);
  } finally {
    await pgClient.end();
  }

  // 2. Store credentials
  const dbPasswordEnc = encrypt(dbPassword);
  await masterDb.tenant.update({
    where: { id: tenantId },
    data: {
      dbHost: TENANT_DB_HOST,
      dbPort: TENANT_DB_PORT,
      dbName,
      dbUser,
      dbPasswordEnc,
    },
  });

  // 3. Run Prisma migrations
  const tenantDbUrl = `postgresql://${dbUser}:${encodeURIComponent(dbPassword)}@${TENANT_DB_HOST}:${TENANT_DB_PORT}/${dbName}`;
  console.log(`  Running migrations...`);
  execSync(
    `node node_modules/.bin/prisma migrate deploy --schema=${TENANT_MIGRATIONS_PATH}/schema.prisma`,
    {
      cwd: resolve(ROOT, 'packages/prisma-tenant'),
      env: { ...process.env, TENANT_DATABASE_URL: tenantDbUrl },
      stdio: 'pipe',
    }
  );
  console.log(`  [OK] Migrations applied`);

  // 4. Seed starter form using raw Prisma
  const { PrismaClient: TenantPrismaClient } = await import(
    resolve(ROOT, 'packages/prisma-tenant/node_modules/@prisma/client/index.js')
  );
  const tenantClient = new TenantPrismaClient({ datasources: { db: { url: tenantDbUrl } } });
  await tenantClient.$connect();
  try {
    const existingForm = await tenantClient.formDefinition.findFirst({ where: { formKey: 'starter_template' } });
    if (!existingForm) {
      await tenantClient.formDefinition.create({
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
          createdById: adminUserId,
        },
      });
      console.log(`  [OK] Starter form seeded`);
    } else {
      console.log(`  [SKIP] Starter form already exists`);
    }
  } finally {
    await tenantClient.$disconnect();
  }

  // 5. Ensure escalation rules and blind review settings exist (master DB)
  const existingEscalation = await masterDb.escalationRule.findFirst({ where: { tenantId } });
  if (!existingEscalation) {
    await masterDb.escalationRule.create({
      data: { tenantId, qaDeviationThreshold: 15, verifierDeviationThreshold: 10, staleQueueHours: 24 },
    });
  }
  const existingBlindReview = await masterDb.blindReviewSettings.findFirst({ where: { tenantId } });
  if (!existingBlindReview) {
    await masterDb.blindReviewSettings.create({
      data: { tenantId, hideAgentFromQA: false, hideQAFromVerifier: false },
    });
  }

  // 6. Activate tenant
  await masterDb.tenant.update({ where: { id: tenantId }, data: { status: 'ACTIVE' } });
  if (adminUserId) {
    await masterDb.user.updateMany({ where: { tenantId, status: { not: 'INACTIVE' } }, data: { status: 'ACTIVE' } });
  }

  await masterDb.$disconnect();
  console.log(`  [DONE] Tenant ${tenantId} is now ACTIVE`);
}

async function main() {
  const targetSlug = process.argv[2]; // optional: provision only this slug
  const masterDb = new PrismaClient({ datasources: { db: { url: MASTER_DATABASE_URL } } });

  const where = targetSlug
    ? { slug: targetSlug }
    : { status: 'PROVISIONING' };

  const tenants = await masterDb.tenant.findMany({
    where,
    include: { users: { where: { role: 'ADMIN' }, take: 1 } },
  });

  await masterDb.$disconnect();

  if (tenants.length === 0) {
    console.log('No PROVISIONING tenants found.');
    process.exit(0);
  }

  console.log(`Found ${tenants.length} tenant(s) to provision: ${tenants.map(t => t.slug).join(', ')}`);

  for (const tenant of tenants) {
    const adminUserId = tenant.users[0]?.id;
    try {
      await provisionTenant(tenant.id, adminUserId);
    } catch (err) {
      console.error(`[ERROR] Failed to provision ${tenant.slug}:`, err.message);
      process.exit(1);
    }
  }

  console.log('\nAll tenants provisioned successfully!');
}

main().catch(err => { console.error(err); process.exit(1); });
