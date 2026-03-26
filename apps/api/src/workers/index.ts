import { loadEnv } from '@qa/config';
import { startProvisionWorker } from './tenant-provision.worker';
import { startEvalWorker } from '../evaluations/eval-process.worker';

loadEnv();

const workers = [startProvisionWorker(), startEvalWorker()];

console.log(`Workers started: ${workers.length} active`);

process.on('SIGTERM', async () => {
  console.log('SIGTERM received — closing workers');
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
});
