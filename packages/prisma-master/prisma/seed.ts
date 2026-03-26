import { getMasterClient } from '../src';
import * as bcrypt from 'bcrypt';

async function seed() {
  const prisma = getMasterClient();

  // Dev tenant
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'dev-tenant' },
    create: {
      slug: 'dev-tenant',
      name: 'Dev Tenant',
      plan: 'PRO',
      status: 'ACTIVE',
      dbHost: 'localhost',
      dbPort: 5433,
      dbName: 'qa_tenant_dev',
      dbUser: 'qa_tenant_dev',
      dbPasswordEnc: 'PLAINTEXT:devpassword', // placeholder — real encryption in provisioning worker
    },
    update: {},
  });

  const passwordHash = await bcrypt.hash('DevAdmin123!', 12);

  await prisma.user.upsert({
    where: {
      tenantId_email: { tenantId: tenant.id, email: 'admin@dev.local' },
    },
    create: {
      tenantId: tenant.id,
      email: 'admin@dev.local',
      passwordHash,
      name: 'Dev Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    },
    update: {},
  });

  // Dev subscription
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await prisma.subscription.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      plan: 'PRO',
      status: 'TRIALING',
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      trialEndsAt: periodEnd,
    },
    update: {},
  });

  // Default escalation rules
  await prisma.escalationRule.upsert({
    where: { id: `esc_${tenant.id}` },
    create: {
      id: `esc_${tenant.id}`,
      tenantId: tenant.id,
      qaDeviationThreshold: 15,
      verifierDeviationThreshold: 10,
      staleQueueHours: 24,
    },
    update: {},
  });

  // Default blind review settings
  await prisma.blindReviewSettings.upsert({
    where: { tenantId: tenant.id },
    create: {
      tenantId: tenant.id,
      hideAgentFromQA: false,
      hideQAFromVerifier: false,
    },
    update: {},
  });

  console.log(`✅ Master DB seeded — tenant: ${tenant.id}, admin: admin@dev.local`);
  await prisma.$disconnect();
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
