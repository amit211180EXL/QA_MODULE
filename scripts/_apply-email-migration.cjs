'use strict';
// One-shot script: applies migration 0004_tenant_email_settings if not already present.
const { resolve } = require('path');
const ROOT = resolve(__dirname, '..');
const { Client } = require(resolve(ROOT, 'apps/api/node_modules/pg'));
const path = require('path');
const fs = require('fs');

const connStr = process.env.MASTER_DATABASE_URL;
if (!connStr) {
  console.error('MASTER_DATABASE_URL is not set');
  process.exit(1);
}

const sqlFile = path.join(
  __dirname,
  '../packages/prisma-master/prisma/migrations/0004_tenant_email_settings/migration.sql',
);
const sql = fs.readFileSync(sqlFile, 'utf8');

async function main() {
  const client = new Client({ connectionString: connStr });
  await client.connect();
  try {
    await client.query(sql);
    console.log('Migration 0004_tenant_email_settings applied successfully.');
  } catch (err) {
    // 42P07 = relation already exists, 42710 = type already exists
    if (['42P07', '42710'].includes(err.code)) {
      console.log('Objects already exist — migration was likely already applied.');
    } else {
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
