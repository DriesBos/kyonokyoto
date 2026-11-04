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

export async function maintainCrawlerStorage(env, fetchImpl = fetch) {
  const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/rpc/maintain_crawler_storage`, {
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
    throw new Error(
      `Crawler storage maintenance failed (${response.status}): ${await response.text()}`,
    );
  }

  return response.json();
}

export async function postStatus(url, payload, fetchImpl = fetch) {
  if (!url) return;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Crawler status webhook failed (${response.status})`);
}

// Web pages cache on the Netlify CDN until the city's midnight, tagged per city
// (apps/web-next/src/lib/cdnCache.ts). Purging the tag makes fresh crawl data visible right away.
export async function purgeCityPageCache(env, city, fetchImpl = fetch) {
  if (!env.NETLIFY_SITE_ID || !env.NETLIFY_PURGE_TOKEN) return { skipped: true };
  const response = await fetchImpl('https://api.netlify.com/api/v1/purge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.NETLIFY_PURGE_TOKEN}`,
    },
    body: JSON.stringify({ site_id: env.NETLIFY_SITE_ID, cache_tags: [`city-${city}`] }),
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`Netlify cache purge failed (${response.status}): ${await response.text()}`);
  }

  return { skipped: false };
}

const landingWarmAccepts = ['image/avif,image/webp,*/*', 'image/webp,*/*'];

// Requests the city's landing image transforms (listed by the site's /api/landing-images/<city>/
// route) so Netlify Image CDN has them cached before visitors arrive. Each URL is requested as
// AVIF and WebP, the two formats browsers negotiate. Only reports; failures never fail a crawl.
export async function warmLandingImages(env, city, fetchImpl = fetch, { concurrency = 4 } = {}) {
  if (env.LANDING_WARM === '0') return { skipped: true };
  const origin = (env.SITE_URL || 'https://kyonokyoto.xyz').replace(/\/+$/, '');
  const listResponse = await fetchImpl(`${origin}/api/landing-images/${city}/`, {
    signal: AbortSignal.timeout(30000),
  });
  if (!listResponse.ok) {
    throw new Error(`Landing image list failed (${listResponse.status}) for ${city}`);
  }
  const { urls = [] } = await listResponse.json();
  const requests = urls.flatMap((url) =>
    landingWarmAccepts.map((accept) => ({ url: new URL(url, origin).href, accept })),
  );

  let warmed = 0;
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < requests.length) {
      const { url, accept } = requests[next++];
      try {
        const response = await fetchImpl(url, {
          headers: { accept },
          signal: AbortSignal.timeout(60000),
        });
        await response.arrayBuffer();
        if (response.ok) warmed += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, requests.length) }, worker));

  return { skipped: false, urls: urls.length, warmed, failed };
}
