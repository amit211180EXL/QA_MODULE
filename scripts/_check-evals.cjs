const { resolve } = require('path');
const ROOT = resolve(__dirname, '..');
const { Client } = require(resolve(ROOT, 'apps/api/node_modules/pg'));

const crypto = require('crypto');
// Dev encryption key from .env
const ENC_KEY = Buffer.from('2b6efb8fe03454be1208cf76ca5f1a241a0b3089af947f1bd87246207914aa83', 'hex');

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

async function run() {
  const master = new Client({ host: 'localhost', port: 5432, user: 'qa_master', password: 'masterpass', database: 'qa_master' });
  await master.connect();
  const tenants = await master.query(`SELECT "dbName", "dbUser", "dbPasswordEnc" FROM tenants`);
  await master.end();
  
  for (const t of tenants.rows) {
    const password = decrypt(t.dbPasswordEnc);
    console.log('\n=== ' + t.dbName + ' (user: ' + t.dbUser + ') ===');
    const c = new Client({ host: 'localhost', port: 5432, user: t.dbUser, password, database: t.dbName });
    try {
      await c.connect();
      const r = await c.query(`SELECT id, "workflowState"::text, "aiScore", "qaScore", "verifierScore", "finalScore", "passFail" FROM evaluations ORDER BY "updatedAt" DESC LIMIT 5`);
      console.log(JSON.stringify(r.rows, null, 2));
      console.log(JSON.stringify(r.rows, null, 2));
    } catch(e) { console.log('  Error:', e.message); }
    finally { await c.end(); }
  }
}
run().catch(e => console.error(e.message));
