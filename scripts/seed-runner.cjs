/**
 * Loads MASTER_DATABASE_URL from apps/api/.env and runs the prisma-master seed.
 * Usage: pnpm db:seed  OR  node scripts/seed-runner.cjs
 */
const { resolve } = require('path');
const { execSync } = require('child_process');
const ROOT = resolve(__dirname, '..');

// Load env from apps/api/.env
const dotenv = require(resolve(ROOT, 'node_modules/.pnpm/dotenv@16.4.5/node_modules/dotenv/lib/main.js'));
dotenv.config({ path: resolve(ROOT, 'apps/api/.env') });

const url = process.env.MASTER_DATABASE_URL;
if (!url) {
  console.error('ERROR: MASTER_DATABASE_URL not found in apps/api/.env');
  process.exit(1);
}

console.log('Seeding master DB...');
execSync('pnpm --filter @qa/prisma-master db:seed', {
  stdio: 'inherit',
  cwd: ROOT,
  env: { ...process.env, MASTER_DATABASE_URL: url },
});
