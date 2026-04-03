/**
 * Backfill script: recompute qaScore / verifierScore / finalScore / passFail
 * for evaluations that are LOCKED or QA_COMPLETED but have qaScore = NULL
 * because scoringStrategy was missing `scale`.
 *
 * Usage:
 *   node scripts/backfill-scores.mjs
 */

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { Client } = require(resolve(ROOT, 'apps/api/node_modules/pg'));

// ─── AES-256-GCM decrypt (matches /packages/config/src/env.ts) ──────────────
const ENC_KEY = Buffer.from(
  '2b6efb8fe03454be1208cf76ca5f1a241a0b3089af947f1bd87246207914aa83',
  'hex',
);
function decrypt(enc) {
  if (!enc) return '';
  if (enc.startsWith('PLAINTEXT:')) return enc.slice(10);
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const data = buf.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ─── Scoring logic (mirrors ScoringService) ──────────────────────────────────
function scaleValue(value, min, max, scale) {
  if (max <= min) return Math.min(Math.max(value, 0), scale);
  const clamped = Math.min(Math.max(value, min), max);
  return ((clamped - min) / (max - min)) * scale;
}

function applyRounding(value, policy) {
  switch (policy) {
    case 'floor': return Math.floor(value * 100) / 100;
    case 'ceil': return Math.ceil(value * 100) / 100;
    default: return Math.round(value * 100) / 100;
  }
}

function normalizeAnswer(value, q, scale) {
  switch (q.type) {
    case 'boolean':
      return (value === true || value === 1 || value === 'yes' || value === 'true') ? scale : 0;
    case 'rating': {
      if (typeof value !== 'number') return 0;
      const min = q.validation?.min ?? 0;
      const max = q.validation?.max ?? 5;
      return scaleValue(value, min, max, scale);
    }
    default:
      if (typeof value === 'number') return value;
      return 0;
  }
}

function computeScore(answers, questions, sections, strategy) {
  const scale = strategy.scale ?? 100;
  const passMark = strategy.passMark ?? 70;
  const roundingPolicy = strategy.roundingPolicy;

  const questionsBySection = new Map();
  for (const q of questions) {
    if (!questionsBySection.has(q.sectionId)) questionsBySection.set(q.sectionId, []);
    questionsBySection.get(q.sectionId).push(q);
  }

  const sectionScores = {};
  let totalWeight = 0;
  let weightedTotal = 0;

  for (const section of sections) {
    const qs = questionsBySection.get(section.id) ?? [];
    if (!qs.length) continue;

    const totalQWeight = qs.reduce((sum, q) => sum + (q.weight ?? 0), 0);
    let sectionRaw = 0;

    for (const q of qs) {
      const answer = answers[q.key];
      if (!answer) continue;
      const normalized = normalizeAnswer(answer.value, q, scale);
      sectionRaw += (normalized / scale) * (q.weight ?? 0);
    }

    const sectionScore = totalQWeight > 0 ? (sectionRaw / totalQWeight) * scale : 0;
    const rounded = applyRounding(sectionScore, roundingPolicy);
    sectionScores[section.id] = rounded;
    totalWeight += section.weight ?? 0;
    weightedTotal += rounded * (section.weight ?? 0);
  }

  const overallRaw = totalWeight > 0 ? weightedTotal / totalWeight : 0;
  const overallScore = applyRounding(overallRaw, roundingPolicy);
  const passFail = overallScore >= passMark;

  return { sectionScores, overallScore, passFail };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  // Get tenant credentials from master DB
  const master = new Client({
    host: 'localhost', port: 5432,
    user: 'qa_master', password: 'masterpass',
    database: 'qa_master',
  });
  await master.connect();
  const { rows: tenants } = await master.query(
    `SELECT "dbName", "dbUser", "dbPasswordEnc" FROM tenants`,
  );
  await master.end();

  for (const tenant of tenants) {
    const password = decrypt(tenant.dbPasswordEnc);
    if (!password) continue;

    console.log(`\n=== ${tenant.dbName} ===`);
    const c = new Client({ host: 'localhost', port: 5432, user: tenant.dbUser, password, database: tenant.dbName });
    try {
      await c.connect();

      // Find evals that need backfill: LOCKED or QA_COMPLETED with null qaScore
      const { rows: evals } = await c.query(`
        SELECT e.id, e."workflowState"::text, e."qaAdjustedData",
               f.questions, f.sections, f."scoringStrategy"
        FROM evaluations e
        JOIN form_definitions f ON e."formDefinitionId" = f.id
        WHERE e."workflowState"::text IN ('LOCKED', 'QA_COMPLETED')
          AND e."qaScore" IS NULL
          AND e."qaAdjustedData" IS NOT NULL
      `);

      if (!evals.length) {
        console.log('  No evals need backfill.');
        continue;
      }

      console.log(`  Found ${evals.length} eval(s) needing backfill.`);

      for (const ev of evals) {
        const qaLayer = ev.qaAdjustedData;
        const answers = qaLayer?.answers;
        if (!answers || !Object.keys(answers).length) {
          console.log(`  [${ev.id}] skipping — no answers in qaAdjustedData`);
          continue;
        }

        const questions = Array.isArray(ev.questions) ? ev.questions.filter(q => q && typeof q === 'object' && q.key) : [];
        const sections = Array.isArray(ev.sections) ? ev.sections.filter(s => s && typeof s === 'object' && s.id) : [];
        const strategy = ev.scoringStrategy ?? {};

        if (!questions.length || !sections.length) {
          console.log(`  [${ev.id}] skipping — form has no valid questions/sections`);
          continue;
        }

        const { sectionScores, overallScore, passFail } = computeScore(answers, questions, sections, strategy);
        console.log(`  [${ev.id}] workflowState=${ev.workflowState} -> qaScore=${overallScore} passFail=${passFail}`);

        // Build updated qaAdjustedData
        const updatedQaLayer = { ...qaLayer, sectionScores, overallScore, passFail };

        const isLocked = ev.workflowState === 'LOCKED';
        await c.query(
          `UPDATE evaluations
             SET "qaScore" = $1,
                 "verifierScore" = CASE WHEN $2 THEN $1 ELSE "verifierScore" END,
                 "finalScore" = CASE WHEN $2 THEN $1 ELSE "finalScore" END,
                 "passFail" = $3,
                 "qaAdjustedData" = $4::jsonb,
                 "verifierFinalData" = CASE WHEN $2 THEN $4::jsonb ELSE "verifierFinalData" END,
                 "finalResponseData" = CASE WHEN $2 THEN $4::jsonb ELSE "finalResponseData" END
           WHERE id = $5`,
          [overallScore, isLocked, passFail, JSON.stringify(updatedQaLayer), ev.id],
        );

        console.log(`  [${ev.id}] Updated OK.`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    } finally {
      await c.end();
    }
  }

  console.log('\nDone.');
}

run().catch(e => { console.error(e); process.exit(1); });
