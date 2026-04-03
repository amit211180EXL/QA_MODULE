'use strict';
// Inserts any missing migration records into _prisma_migrations so that
// `prisma migrate deploy` knows the baseline is already applied.
const { resolve } = require('path');
const ROOT = resolve(__dirname, '..');
const { Client } = require(resolve(ROOT, 'apps/api/node_modules/pg'));
const fs = require('fs');
const path = require('path');

const connStr = process.env.MASTER_DATABASE_URL;
if (!connStr) { console.error('MASTER_DATABASE_URL not set'); process.exit(1); }

const MIGRATIONS_DIR = path.join(ROOT, 'packages/prisma-master/prisma/migrations');

async function main() {
  const client = new Client({ connectionString: connStr });
  await client.connect();

  try {
    // Ensure the table exists (Prisma creates it on first migrate resolve/deploy).
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        id                          VARCHAR(36)  NOT NULL PRIMARY KEY,
        checksum                    VARCHAR(64)  NOT NULL,
        finished_at                 TIMESTAMPTZ,
        migration_name              VARCHAR(255) NOT NULL,
        logs                        TEXT,
        rolled_back_at              TIMESTAMPTZ,
        started_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
        applied_steps_count         INTEGER      NOT NULL DEFAULT 0
      )
    `);

    const migrations = fs.readdirSync(MIGRATIONS_DIR)
      .filter(d => fs.statSync(path.join(MIGRATIONS_DIR, d)).isDirectory())
      .sort();

    for (const name of migrations) {
      const { rows } = await client.query(
        'SELECT 1 FROM "_prisma_migrations" WHERE migration_name = $1',
        [name],
      );
      if (rows.length > 0) {
        console.log(`  already recorded: ${name}`);
        continue;
      }
      // Compute a simple checksum (sha256 of the SQL content).
      const sqlPath = path.join(MIGRATIONS_DIR, name, 'migration.sql');
      const sql = fs.readFileSync(sqlPath, 'utf8');
      const { createHash } = require('crypto');
      const checksum = createHash('sha256').update(sql).digest('hex');

      await client.query(
        `INSERT INTO "_prisma_migrations"
           (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, NULL, NULL, now(), 1)`,
        [require('crypto').randomUUID(), checksum, name],
      );
      console.log(`  baselined: ${name}`);
    }

    console.log('Done.');
  } finally {
    await client.end();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
