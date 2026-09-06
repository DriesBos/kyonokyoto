import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { maintainCrawlerStorage, postStatus } from './crawl-cycle-utils.mjs';

export async function runStorageMaintenance(env, fetchImpl = fetch) {
  let storage;
  try {
    storage = await maintainCrawlerStorage(env, fetchImpl);
  } catch (error) {
    await postStatus(
      env.CRAWL_ALERT_WEBHOOK_URL,
      {
        status: 'storage_maintenance_failed',
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      fetchImpl,
    ).catch((reportError) => console.error(reportError.message));
    throw error;
  }
  if (storage.warning) {
    await postStatus(
      env.CRAWL_ALERT_WEBHOOK_URL,
      {
        status: 'storage_warning',
        ...storage,
        timestamp: new Date().toISOString(),
      },
      fetchImpl,
    );
  }
  return storage;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = parseEnv(await readFile(resolve('apps/crawler/.env'), 'utf8'));
  const storage = await runStorageMaintenance(env);
  console.log(JSON.stringify(storage));
  if (storage.warning) {
    console.error('Database storage exceeds 400 MB; maintenance needs attention.');
    process.exitCode = 1;
  }
}
