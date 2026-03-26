const {resolve}=require('path');
const ROOT=resolve(__dirname,'..');
const {Client}=require(resolve(ROOT,'apps/api/node_modules/pg'));
const c=new Client({host:'localhost',port:5432,user:'qa_superuser',password:'superpass',database:'postgres'});
c.connect().then(async ()=>{
  await c.query('DROP DATABASE IF EXISTS qa_tenant_test123');
  await c.query('DROP USER IF EXISTS qa_user_test123');
  await c.query('CREATE USER qa_user_test123 WITH PASSWORD \'testpass\'');
  await c.query('CREATE DATABASE qa_tenant_test123 OWNER qa_user_test123');
  await c.query('DROP DATABASE qa_tenant_test123');
  await c.query('DROP USER qa_user_test123');
  console.log('CREATE/DROP OK');
  return c.end();
}).catch(e=>{console.error('ERR:',e.message);process.exit(1)});
