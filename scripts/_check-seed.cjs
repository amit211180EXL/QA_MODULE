const { resolve } = require('path');
const ROOT = resolve(__dirname, '..');
const { Client } = require(resolve(ROOT, 'apps/api/node_modules/pg'));
require(resolve(ROOT, 'node_modules/.pnpm/dotenv@16.4.5/node_modules/dotenv/lib/main.js')).config({ path: resolve(ROOT, 'apps/api/.env') });

const url = process.env.MASTER_DATABASE_URL || process.env.DATABASE_URL;
console.log('DB URL type:', url?.split('@')[0]?.split(':')[0]);

const client = new Client({ connectionString: url });

async function main() {
  await client.connect();
  const users = await client.query(
    "SELECT id, email, name, role, status, \"passwordHash\" FROM users WHERE email = 'admin@dev.local'"
  );
  console.log('Users:', JSON.stringify(users.rows.map(u => ({ ...u, passwordHash: u.passwordHash?.substring(0, 10) + '...' })), null, 2));

  const tenants = await client.query("SELECT id, slug, name, plan, status FROM tenants WHERE slug = 'dev-tenant'");
  console.log('Tenants:', JSON.stringify(tenants.rows, null, 2));
  await client.end();
}

main().catch(e => { console.error(e.message); client.end(); });
