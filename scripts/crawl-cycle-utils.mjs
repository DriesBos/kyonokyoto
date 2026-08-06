export function parseGitDivergence(value) {
  const [ahead, behind] = String(value ?? '')
    .trim()
    .split(/\s+/)
    .map(Number);

  if (!Number.isInteger(ahead) || !Number.isInteger(behind)) {
    throw new Error(`Could not parse Git divergence: ${value}`);
  }

  return { ahead, behind };
}

const crawlTriggerTypes = new Set(['manual', 'scheduled', 'retry', 'backfill']);

export function normalizeCrawlTriggerType(value = 'manual') {
  const triggerType = String(value || 'manual').trim();
  if (!crawlTriggerTypes.has(triggerType)) {
    throw new Error(`Unsupported crawl trigger type "${triggerType}"`);
  }
  return triggerType;
}

export function crawlBatchExitCode(results) {
  if (results.some((result) => result.status === 'failed')) return 1;
  if (results.some((result) => result.status !== 'success')) return 2;
  return 0;
}

export function cycleStatus({ crawlExitCode, translationsPassed }) {
  if (crawlExitCode !== 0 && crawlExitCode !== 2) return 'failed';
  return crawlExitCode === 2 || !translationsPassed ? 'degraded' : 'success';
}

export async function pruneRawPages(env, fetchImpl = fetch) {
  const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/prune_raw_pages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: '{}',
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Raw page retention failed (${response.status}): ${await response.text()}`);
  }

  return response.json();
}
