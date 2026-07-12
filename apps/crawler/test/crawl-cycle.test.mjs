import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cycleStatus, parseGitDivergence } from '../../../scripts/crawl-cycle-utils.mjs';

test('crawl cycle parses Git ahead and behind counts', () => {
  assert.deepEqual(parseGitDivergence('0\t28\n'), { ahead: 0, behind: 28 });
  assert.deepEqual(parseGitDivergence('9 0'), { ahead: 9, behind: 0 });
  assert.throws(() => parseGitDivergence('unknown'));
});

test('crawl cycle status reports partial failures as degraded', () => {
  assert.equal(cycleStatus({ crawlPassed: true, translationsPassed: true }), 'success');
  assert.equal(cycleStatus({ crawlPassed: false, translationsPassed: true }), 'degraded');
  assert.equal(cycleStatus({ crawlPassed: true, translationsPassed: false }), 'degraded');
});
