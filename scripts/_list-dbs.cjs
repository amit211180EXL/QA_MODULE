const { resolve } = require("path");
const ROOT = resolve(__dirname, "..");
const { Client } = require(resolve(ROOT, "apps/api/node_modules/pg"));
async function run() {
  const c = new Client({ host: "localhost", port: 5432, user: "qa_superuser", password: "superpass", database: "postgres" });
  await c.connect();
  const r = await c.query("SELECT datname FROM pg_database WHERE datname LIKE '%qa%' OR datname LIKE '%tenant%'");
  console.log(JSON.stringify(r.rows));
  await c.end();
}
run().catch(e => console.error(e.message));
