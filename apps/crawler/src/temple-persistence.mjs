import { buildTempleEventIdentity } from '../../../packages/shared/temple-event-identity.mjs';
import { buildScheduleSegmentRows } from './schedule-segments.mjs';

// Facts, provenance and canonical schedule are written atomically in one database RPC.
export async function persistTempleEvent({ env, source, rawPageId, event, request }) {
  const identity = buildTempleEventIdentity(event);
  if (!identity.sourceEventKey) throw new Error('Temple event requires stable publisher identity');
  const segments = buildScheduleSegmentRows('__preflight__', event).map(
    ({ event_id, ordinal, ...segment }) => segment,
  );
  const facts = Object.fromEntries(
    Object.entries(event).filter(([key]) => !key.startsWith('_') && key !== 'schedule_segments'),
  );
  const result = await request({
    env,
    path: 'rpc/ingest_temple_event',
    method: 'POST',
    body: {
      p_source_id: source.id,
      p_raw_page_id: rawPageId,
      p_source_event_key: identity.sourceEventKey,
      p_match_key: identity.matchKey,
      p_review_key: identity.reviewKey,
      p_event: facts,
      p_segments: segments,
    },
  });
  if (!result?.event?.id) throw new Error('Temple ingestion returned no canonical event');
  return { ...result, identity };
}

export async function finishTempleSourceScan({ env, sourceId, seenKeys, request }) {
  return request({
    env,
    path: 'rpc/finish_temple_source_scan',
    method: 'POST',
    body: { p_source_id: sourceId, p_seen_keys: [...seenKeys] },
  });
}

export async function finalizeTempleEvent({ env, sourceId, event, translations, request }) {
  return request({
    env,
    path: 'rpc/finalize_temple_event',
    method: 'POST',
    body: {
      p_event_id: event.id,
      p_source_id: sourceId,
      p_revision: event.updated_at,
      p_translations: translations,
    },
  });
}
