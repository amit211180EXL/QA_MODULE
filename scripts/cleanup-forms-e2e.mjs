import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const { Client } = require(resolve(ROOT, 'apps/api/node_modules/pg'));

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

async function main() {
  const master = new Client({
    host: 'localhost',
    port: 5432,
    user: 'qa_master',
    password: 'masterpass',
    database: 'qa_master',
  });
  await master.connect();

  const tenant = await master.query(
    `SELECT id, slug, "dbName", "dbUser", "dbPasswordEnc" FROM tenants WHERE slug = 'dev-tenant' LIMIT 1`,
  );

  await master.end();

  if (!tenant.rows.length) {
    console.log('dev-tenant not found');
    return;
  }

  const t = tenant.rows[0];
  const tenantDb = new Client({
    host: 'localhost',
    port: 5432,
    user: t.dbUser,
    password: decrypt(t.dbPasswordEnc),
    database: t.dbName,
  });

  await tenantDb.connect();

  const list = await tenantDb.query(
    `SELECT id, "formKey", status FROM form_definitions
     WHERE "formKey" LIKE 'e2e_%' OR "formKey" LIKE 'single-%' OR "formKey" LIKE 'multi-%' OR "formKey" LIKE 'forms-e2e-%'`,
  );

  if (!list.rows.length) {
    console.log('No e2e forms to clean');
    await tenantDb.end();
    return;
  }

  const ids = list.rows.map((r) => r.id);

  const refs = await tenantDb.query(
    `SELECT COUNT(*)::int AS cnt FROM evaluations WHERE "formDefinitionId" = ANY($1::text[])`,
    [ids],
  );

  if ((refs.rows[0]?.cnt ?? 0) > 0) {
    const archived = await tenantDb.query(
      `UPDATE form_definitions
       SET status = 'ARCHIVED', "archivedAt" = NOW()
       WHERE id = ANY($1::text[]) AND status <> 'ARCHIVED'`,
      [ids],
    );
    console.log(
      `Archived ${archived.rowCount} e2e form(s) in ${t.dbName} (kept due to ${refs.rows[0].cnt} evaluation reference(s))`,
    );
    await tenantDb.end();
    return;
  }

  const deleted = await tenantDb.query(`DELETE FROM form_definitions WHERE id = ANY($1::text[])`, [ids]);

  console.log(`Deleted ${deleted.rowCount} e2e form(s) from ${t.dbName}`);
  await tenantDb.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
