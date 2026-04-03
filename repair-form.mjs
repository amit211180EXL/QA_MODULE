/**
 * One-shot repair script: fixes a FormDefinition whose sections/questions
 * were stored as empty-array items ([[],[]] instead of [{id,...},...]).
 *
 * Run from repo root:
 *   node repair-form.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

process.env.MASTER_DATABASE_URL = 'postgresql://qa_master:masterpass@localhost:5432/qa_master';

const { PrismaClient: MasterClient } = require(
  './packages/prisma-master/generated/master-client/index.js',
);

// ── load encrypt/decrypt from built dist ──────────────────────────────────────
const { decrypt } = require('./apps/api/dist/common/utils/encryption.util.js');

// ── load tenant client factory ────────────────────────────────────────────────
const { PrismaClient: TenantClient } = require(
  './packages/prisma-tenant/generated/tenant-client/index.js',
);

const TENANT_SLUG = 'demo-corp';

const SECTIONS = [
  { id: 'sec_1', title: 'Communication', weight: 50, order: 0 },
  { id: 'sec_2', title: 'Resolution', weight: 50, order: 1 },
];

const QUESTIONS = [
  {
    id: 'q_1',
    sectionId: 'sec_1',
    key: 'greeting',
    label: 'Did the agent greet the customer professionally?',
    type: 'boolean',
    required: true,
    weight: 50,
    order: 0,
    rubric: { goal: 'Professional greeting', anchors: [] },
  },
  {
    id: 'q_2',
    sectionId: 'sec_1',
    key: 'tone',
    label: "Rate the agent's tone and empathy",
    type: 'rating',
    required: true,
    weight: 50,
    order: 1,
    validation: { min: 1, max: 5 },
    rubric: {
      goal: 'Empathetic and professional',
      anchors: [
        { value: 1, label: 'Very poor' },
        { value: 3, label: 'Acceptable' },
        { value: 5, label: 'Excellent' },
      ],
    },
  },
  {
    id: 'q_3',
    sectionId: 'sec_2',
    key: 'issue_resolved',
    label: 'Was the customer issue fully resolved?',
    type: 'boolean',
    required: true,
    weight: 60,
    order: 0,
    rubric: { goal: 'Issue fully resolved without escalation', anchors: [] },
  },
  {
    id: 'q_4',
    sectionId: 'sec_2',
    key: 'resolution_time',
    label: 'How would you rate the resolution speed?',
    type: 'rating',
    required: true,
    weight: 40,
    order: 1,
    validation: { min: 1, max: 5 },
    rubric: {
      goal: 'Resolved within expected SLA',
      anchors: [
        { value: 1, label: 'Very slow' },
        { value: 3, label: 'Acceptable' },
        { value: 5, label: 'Very fast' },
      ],
    },
  },
];

async function main() {
  const masterDb = new MasterClient();
  await masterDb.$connect();

  const tenant = await masterDb.tenant.findFirst({
    where: { slug: TENANT_SLUG },
    select: { dbHost: true, dbPort: true, dbName: true, dbUser: true, dbPasswordEnc: true },
  });

  if (!tenant) throw new Error(`Tenant ${TENANT_SLUG} not found`);

  const dbPassword = decrypt(tenant.dbPasswordEnc);
  const tenantDbUrl = `postgresql://${tenant.dbUser}:${encodeURIComponent(dbPassword)}@${tenant.dbHost}:${tenant.dbPort}/${tenant.dbName}`;

  const tenantDb = new TenantClient({ datasources: { db: { url: tenantDbUrl } } });
  await tenantDb.$connect();

  // Find all forms with corrupted sections (array-of-arrays)
  const allForms = await tenantDb.formDefinition.findMany({
    select: { id: true, formKey: true, version: true, sections: true, questions: true },
  });

  for (const form of allForms) {
    const sections = form.sections;
    const questions = form.questions;

    // Check if sections are corrupted (items are arrays, not objects)
    const isCorrupted =
      Array.isArray(sections) &&
      sections.length > 0 &&
      Array.isArray(sections[0]);

    if (isCorrupted) {
      console.log(`Fixing form: ${form.formKey} v${form.version} (${form.id})`);

      await tenantDb.formDefinition.update({
        where: { id: form.id },
        data: {
          sections: SECTIONS,
          questions: QUESTIONS,
        },
      });

      console.log(`  ✓ Repaired with ${SECTIONS.length} sections, ${QUESTIONS.length} questions`);
    } else {
      console.log(`Form OK: ${form.formKey} v${form.version}`);
    }
  }

  await tenantDb.$disconnect();
  await masterDb.$disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
