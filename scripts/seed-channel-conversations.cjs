'use strict';
/**
 * Seed sample conversations for all channels (CHAT, EMAIL, CALL, SOCIAL)
 * in a tenant database.
 *
 * Usage:
 *   node scripts/seed-channel-conversations.cjs
 *   node scripts/seed-channel-conversations.cjs --tenant=dev-tenant
 *   node scripts/seed-channel-conversations.cjs --tenant=dev-tenant --count=2
 */

const { readFileSync } = require('fs');
const { resolve } = require('path');
const { createDecipheriv } = require('crypto');

const ROOT = resolve(__dirname, '..');

// Load apps/api/.env (same pattern as existing scripts)
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
const MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY;

if (!MASTER_DATABASE_URL) {
  console.error('ERROR: MASTER_DATABASE_URL is missing in apps/api/.env');
  process.exit(1);
}

if (!MASTER_ENCRYPTION_KEY || MASTER_ENCRYPTION_KEY.length !== 64) {
  console.error('ERROR: MASTER_ENCRYPTION_KEY must be 64 hex chars in apps/api/.env');
  process.exit(1);
}

const { PrismaClient } = require(resolve(ROOT, 'packages/prisma-master/generated/master-client'));
const { PrismaClient: TenantPrismaClient } = require(resolve(ROOT, 'packages/prisma-tenant/generated/tenant-client'));

function parseArgs(argv) {
  const opts = {
    tenant: null,
    count: 1,
  };

  for (const raw of argv) {
    if (raw.startsWith('--tenant=')) {
      opts.tenant = raw.slice('--tenant='.length);
    } else if (raw.startsWith('--count=')) {
      const n = Number(raw.slice('--count='.length));
      if (!Number.isInteger(n) || n < 1 || n > 25) {
        throw new Error('--count must be an integer between 1 and 25');
      }
      opts.count = n;
    }
  }

  return opts;
}

function decrypt(ciphertextB64) {
  // Plaintext placeholder written by seed.ts before dev:provision runs
  if (ciphertextB64.startsWith('PLAINTEXT:')) {
    return ciphertextB64.slice('PLAINTEXT:'.length);
  }

  const key = Buffer.from(MASTER_ENCRYPTION_KEY, 'hex');
  const data = Buffer.from(ciphertextB64, 'base64');

  const iv = data.subarray(0, 12);
  const tag = data.subarray(12, 28);
  const encrypted = data.subarray(28);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

function buildSampleContent(channel, i) {
  const now = Date.now();

  if (channel === 'CHAT') {
    return [
      { role: 'customer', text: `Hi, I need help with order #10${i}.`, ts: new Date(now - 180000).toISOString() },
      { role: 'agent', text: 'Sure, I can help you with that order right away.', ts: new Date(now - 140000).toISOString() },
      { role: 'customer', text: 'I want to change the delivery address.', ts: new Date(now - 100000).toISOString() },
      { role: 'agent', text: 'Done. The new address is now updated for dispatch.', ts: new Date(now - 60000).toISOString() },
    ];
  }

  if (channel === 'EMAIL') {
    return [
      { role: 'customer', text: 'Subject: Billing discrepancy\nI was charged twice this month.', ts: new Date(now - 7200000).toISOString() },
      { role: 'agent', text: 'We reviewed your account and processed a refund for the duplicate charge.', ts: new Date(now - 3600000).toISOString() },
      { role: 'customer', text: 'Thanks for resolving this quickly.', ts: new Date(now - 1800000).toISOString() },
    ];
  }

  if (channel === 'CALL') {
    return [
      { speaker: 'agent', text: 'Thank you for calling support, how may I assist?', ts: new Date(now - 300000).toISOString() },
      { speaker: 'customer', text: 'My internet drops every evening around 9 PM.', ts: new Date(now - 240000).toISOString() },
      { speaker: 'agent', text: 'I ran diagnostics and adjusted your line profile.', ts: new Date(now - 180000).toISOString() },
      { speaker: 'customer', text: 'Great, I will monitor it tonight.', ts: new Date(now - 120000).toISOString() },
    ];
  }

  return [
    { author: 'customer', text: '@brand My package has not arrived yet.', ts: new Date(now - 5400000).toISOString() },
    { author: 'agent', text: 'Sorry for the delay. Please DM your order ID and we will check.', ts: new Date(now - 5100000).toISOString() },
    { author: 'customer', text: 'Sent. Thank you!', ts: new Date(now - 4800000).toISOString() },
  ];
}

function buildMetadata(channel) {
  if (channel === 'CHAT') return { topic: 'order_update', source: 'web_chat' };
  if (channel === 'EMAIL') return { topic: 'billing', source: 'email_inbox' };
  if (channel === 'CALL') return { topic: 'connectivity', source: 'contact_center' };
  return { topic: 'delivery_status', source: 'social_media' };
}

async function resolveTenant(masterDb, tenantSlug) {
  if (tenantSlug) {
    return masterDb.tenant.findUnique({ where: { slug: tenantSlug } });
  }

  return masterDb.tenant.findFirst({
    where: {
      dbName: { not: '' },
      dbUser: { not: '' },
      dbPasswordEnc: { not: '' },
    },
    orderBy: { createdAt: 'asc' },
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const masterDb = new PrismaClient({ datasources: { db: { url: MASTER_DATABASE_URL } } });

  try {
    const tenant = await resolveTenant(masterDb, opts.tenant);
    if (!tenant) {
      console.error(
        opts.tenant
          ? `ERROR: tenant not found: ${opts.tenant}`
          : 'ERROR: no tenant with DB credentials found. Pass --tenant=<slug>.'
      );
      process.exit(1);
    }

    if (!tenant.dbHost || !tenant.dbName || !tenant.dbUser || !tenant.dbPasswordEnc) {
      console.error(`ERROR: tenant ${tenant.slug} does not have DB credentials provisioned yet.`);
      process.exit(1);
    }

    const plainPassword = decrypt(tenant.dbPasswordEnc);
    const tenantDbUrl = `postgresql://${tenant.dbUser}:${encodeURIComponent(plainPassword)}@${tenant.dbHost}:${tenant.dbPort}/${tenant.dbName}`;

    const tenantDb = new TenantPrismaClient({ datasources: { db: { url: tenantDbUrl } } });

    try {
      const channels = ['CHAT', 'EMAIL', 'CALL', 'SOCIAL'];
      const rows = [];
      const stamp = Date.now();

      for (const channel of channels) {
        for (let i = 1; i <= opts.count; i += 1) {
          const ext = `SAMPLE-${channel}-${stamp}-${i}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
          rows.push({
            externalId: ext,
            channel,
            agentId: `agent-sample-${channel.toLowerCase()}`,
            agentName: 'QA Sample Agent',
            customerRef: `sample-customer-${channel.toLowerCase()}-${i}`,
            content: buildSampleContent(channel, i),
            metadata: buildMetadata(channel),
            status: 'PENDING',
            receivedAt: new Date(Date.now() - i * 60000),
          });
        }
      }

      await tenantDb.conversation.createMany({ data: rows, skipDuplicates: true });

      console.log(`Seeded ${rows.length} sample conversations for tenant: ${tenant.slug}`);
      console.log(`Channels: CHAT, EMAIL, CALL, SOCIAL (count per channel: ${opts.count})`);
    } finally {
      await tenantDb.$disconnect();
    }
  } finally {
    await masterDb.$disconnect();
  }
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
