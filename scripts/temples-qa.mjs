import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

export async function templeQaReport(env, fetchImpl = fetch) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (apps/crawler/.env)');
  }
  const get = async (path) => {
    const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/${path}`, {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Temple QA request failed (${response.status})`);
    return response.json();
  };
  const [candidates, sources] = await Promise.all([
    get(
      'event_duplicate_candidates?status=eq.pending&select=id,event_id,other_event_id,reason&order=created_at.desc&limit=200',
    ),
    get('sources?source_kind=eq.aggregator&city=eq.kyoto&select=id,slug,beta,is_active'),
  ]);
  const ids = [
    ...new Set(candidates.flatMap((candidate) => [candidate.event_id, candidate.other_event_id])),
  ];
  const events = [];
  const evidence = [];
  for (let offset = 0; offset < ids.length; offset += 50) {
    const chunk = ids.slice(offset, offset + 50).join(',');
    const [rows, observations] = await Promise.all([
      get(
        `events?id=in.(${chunk})&select=id,title,venue_name,address_text,start_date,end_date,status,source_url`,
      ),
      get(`event_sources?event_id=in.(${chunk})&select=event_id,source_url,is_active,last_seen_at`),
    ]);
    events.push(...rows);
    evidence.push(...observations);
  }
  return {
    sources,
    pendingMatches: candidates.map((candidate) => ({
      id: candidate.id,
      reason: candidate.reason,
      events: [candidate.event_id, candidate.other_event_id].map((id) => ({
        ...events.find((event) => event.id === id),
        sources: evidence.filter((item) => item.event_id === id),
      })),
    })),
    limit: 200,
    note: 'Read-only report. Pending matches stay separate beta cards; no automatic fuzzy merge.',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let fileEnv = {};
  try {
    fileEnv = parseEnv(await readFile(new URL('../apps/crawler/.env', import.meta.url), 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  console.log(JSON.stringify(await templeQaReport({ ...fileEnv, ...process.env }), null, 2));
}
