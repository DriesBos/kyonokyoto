import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  crawlBatchExitCode,
  cycleStatus,
  normalizeCrawlTriggerType,
  parseGitDivergence,
  maintainCrawlerStorage,
} from '../../../scripts/crawl-cycle-utils.mjs';
import { runStorageMaintenance } from '../../../scripts/maintain-storage.mjs';

test('crawl cycle parses Git ahead and behind counts', () => {
  assert.deepEqual(parseGitDivergence('0\t28\n'), { ahead: 0, behind: 28 });
  assert.deepEqual(parseGitDivergence('9 0'), { ahead: 9, behind: 0 });
  assert.throws(() => parseGitDivergence('unknown'));
});

test('crawl cycle validates trigger attribution', () => {
  assert.equal(normalizeCrawlTriggerType(), 'manual');
  assert.equal(normalizeCrawlTriggerType('scheduled'), 'scheduled');
  assert.throws(() => normalizeCrawlTriggerType('timer'));
});

test('crawl batch distinguishes review outcomes from hard failures', () => {
  assert.equal(crawlBatchExitCode([{ status: 'success' }]), 0);
  assert.equal(crawlBatchExitCode([{ status: 'partial_success' }]), 2);
  assert.equal(crawlBatchExitCode([{ status: 'partial_success' }, { status: 'failed' }]), 1);
});

test('crawl cycle keeps degraded reviews separate from hard failures', () => {
  assert.equal(cycleStatus({ crawlExitCode: 0, translationsPassed: true }), 'success');
  assert.equal(cycleStatus({ crawlExitCode: 2, translationsPassed: true }), 'degraded');
  assert.equal(cycleStatus({ crawlExitCode: 1, translationsPassed: true }), 'failed');
  assert.equal(cycleStatus({ crawlExitCode: 0, translationsPassed: false }), 'degraded');
});

test('storage maintenance calls its default RPC and rejects failures', async () => {
  const requests = [];
  const env = { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(requests.length === 1 ? '{"cleared_pages":12,"warning":false}' : 'denied', {
      status: requests.length === 1 ? 200 : 403,
    });
  };

  assert.deepEqual(await maintainCrawlerStorage(env, fetchImpl), {
    cleared_pages: 12,
    warning: false,
  });
  assert.deepEqual(requests[0], {
    url: 'https://database.example/rest/v1/rpc/maintain_crawler_storage',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: 'test-key',
        Authorization: 'Bearer test-key',
      },
      body: '{}',
      signal: requests[0].options.signal,
    },
  });
  await assert.rejects(
    maintainCrawlerStorage(env, fetchImpl),
    /Crawler storage maintenance failed \(403\): denied/,
  );
});

test('daily maintenance stays quiet when healthy and alerts on storage warning or failure', async () => {
  const env = {
    SUPABASE_URL: 'https://database.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    CRAWL_ALERT_WEBHOOK_URL: 'https://alerts.example',
  };
  const alerts = [];
  let mode = 'healthy';
  const fetchImpl = async (url, options) => {
    if (url === env.CRAWL_ALERT_WEBHOOK_URL) {
      alerts.push(JSON.parse(options.body));
      return new Response('ok');
    }
    if (mode === 'failure') return new Response('unavailable', { status: 503 });
    return Response.json({
      warning: mode === 'warning',
      database_bytes: mode === 'warning' ? 410000000 : 200000000,
    });
  };
  await runStorageMaintenance(env, fetchImpl);
  assert.equal(alerts.length, 0);
  mode = 'warning';
  assert.equal((await runStorageMaintenance(env, fetchImpl)).warning, true);
  assert.equal(alerts[0].status, 'storage_warning');
  assert.equal(alerts[0].database_bytes, 410000000);
  mode = 'failure';
  await assert.rejects(runStorageMaintenance(env, fetchImpl), /503/);
  assert.equal(alerts[1].status, 'storage_maintenance_failed');
});

test('warning delivery failure is not reported as failed database maintenance', async () => {
  const alerts = [];
  const env = {
    SUPABASE_URL: 'https://database.example',
    SUPABASE_SERVICE_ROLE_KEY: 'test-key',
    CRAWL_ALERT_WEBHOOK_URL: 'https://alerts.example',
  };
  await assert.rejects(
    runStorageMaintenance(env, async (url, options) => {
      if (url === env.CRAWL_ALERT_WEBHOOK_URL) {
        alerts.push(JSON.parse(options.body).status);
        return new Response('unavailable', { status: 503 });
      }
      return Response.json({ warning: true, database_bytes: 410000000 });
    }),
    /webhook failed \(503\)/,
  );
  assert.deepEqual(alerts, ['storage_warning']);
});
