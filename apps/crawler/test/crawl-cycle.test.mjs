import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  crawlBatchExitCode,
  cycleStatus,
  normalizeCrawlTriggerType,
  parseGitDivergence,
  pruneRawPages,
} from '../../../scripts/crawl-cycle-utils.mjs';

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

test('raw page retention calls its default RPC and rejects failures', async () => {
  const requests = [];
  const env = { SUPABASE_URL: 'https://database.example', SUPABASE_SERVICE_ROLE_KEY: 'test-key' };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return new Response(requests.length === 1 ? '12' : 'denied', {
      status: requests.length === 1 ? 200 : 403,
    });
  };

  assert.equal(await pruneRawPages(env, fetchImpl), 12);
  assert.deepEqual(requests[0], {
    url: 'https://database.example/rest/v1/rpc/prune_raw_pages',
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: 'test-key',
        Authorization: 'Bearer test-key',
      },
      body: JSON.stringify({ p_older_than: '7 days' }),
      signal: requests[0].options.signal,
    },
  });
  await assert.rejects(pruneRawPages(env, fetchImpl), /Raw page retention failed \(403\): denied/);
});
