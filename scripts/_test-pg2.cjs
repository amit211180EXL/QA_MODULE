const {resolve}=require('path');
const ROOT=resolve(__dirname,'..');
const {Client}=require(resolve(ROOT,'apps/api/node_modules/pg'));

async function test() {
  const c1 = new Client({host:'localhost',port:5432,user:'qa_superuser',password:'superpass',database:'postgres'});
  await c1.connect();
  try {
    await c1.query('DROP DATABASE IF EXISTS qa_test_provision');
    await c1.query('DROP USER IF EXISTS qa_test_user');
    await c1.query("CREATE USER qa_test_user WITH PASSWORD 'testpass'");
    await c1.query('CREATE DATABASE qa_test_provision');
    await c1.query('GRANT ALL PRIVILEGES ON DATABASE qa_test_provision TO qa_test_user');
    console.log('DB created OK');
  } finally { await c1.end(); }

  const c2 = new Client({host:'localhost',port:5432,user:'qa_superuser',password:'superpass',database:'qa_test_provision'});
  await c2.connect();
  try {
    await c2.query('GRANT ALL ON SCHEMA public TO qa_test_user');
    await c2.query('ALTER SCHEMA public OWNER TO qa_test_user');
    console.log('Schema granted OK');
  } finally { await c2.end(); }

  const c3 = new Client({host:'localhost',port:5432,user:'qa_superuser',password:'superpass',database:'postgres'});
  await c3.connect();
  try {
    await c3.query('DROP DATABASE qa_test_provision');
    await c3.query('DROP USER qa_test_user');
    console.log('Cleanup OK');
  } finally { await c3.end(); }

  console.log('ALL DONE');
}
test().catch(e=>{console.error('ERR:',e.message);process.exit(1)});
