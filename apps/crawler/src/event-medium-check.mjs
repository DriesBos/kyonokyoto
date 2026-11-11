// Per-event mediums (C1, 2026-11-11). Sources carry one taxonomy for the whole venue, so every show
// at a gallery tagged photography + painting used to count as both. For venues that show art, the
// crawler asks a small text model which mediums THIS event is about, from its title and description,
// and stores them in the event's own categories as display_category tokens, next to a
// `medium_check:<key>` marker. The web (apps/web-next/src/lib/cityEvents.ts sourceTruth) uses them
// over the venue's mediums, and falls back to the venue's when the model found none.
//
// The key hashes source, title and description, so an unchanged event reuses the stored answer
// (one Supabase lookup, no model call). Without ANTHROPIC_API_KEY, or with MEDIUM_CHECK=0, nothing
// is checked and events keep the venue's mediums.

import { createHash } from 'node:crypto';
import { CATEGORY_REGISTRY } from '../../../data/categories.mjs';

export const MEDIUM_CHECK_MODEL = 'claude-haiku-5-5';
export const MEDIUM_CHECK_PREFIX = 'medium_check:';
const MEDIUMS = CATEGORY_REGISTRY.display_category;
// venues whose events are art (data/categories.mjs filterTagsFor ART_VENUES)
const ART_VENUES = new Set(['museum', 'gallery', 'fair', 'campus', 'institute', 'theatre', 'cafe']);
const MAX_MEDIUMS = 3;
const MAX_DESCRIPTION_CHARS = 2000;

const mediumSchema = {
  type: 'object',
  properties: {
    mediums: { type: 'array', items: { type: 'string', enum: [...MEDIUMS] } },
  },
  required: ['mediums'],
  additionalProperties: false,
};

const mediumPrompt = `You tag events from an art and culture listing in Japan by medium. Pick the mediums this specific event is mainly about, at most ${MAX_MEDIUMS}, from: ${MEDIUMS.join(', ')}.
- photography, painting, sculpture, ceramics, textile, ukiyoe (woodblock prints), graphic (graphic design, posters, prints, illustration), design (product, furniture, fashion), new-media (video, digital, sound art, installation with screens), performance (dance, theatre, live art), music (concerts), architecture.
- contemporary: a contemporary art show whose medium is mixed or unclear.
Judge from the title and description only. The venue's usual mediums are a hint, not an answer. Return an empty list if the text says nothing about the medium.`;

const isArtVenue = (source) =>
  (source?.taxonomy?.venue_category ?? []).some((venue) => ART_VENUES.has(venue));

export const mediumCheckKey = (source, event) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        source?.slug ?? '',
        event?.title ?? '',
        String(event?.description ?? '').slice(0, MAX_DESCRIPTION_CHARS),
      ]),
    )
    .digest('hex')
    .slice(0, 16);

// The event's categories with its own mediums: venue/event tokens kept, display_category tokens
// replaced by the checked ones, plus the marker. No mediums found: the venue's stay (fallback).
export const categoriesWithMediums = (categories = [], mediums = [], key) => {
  const kept = categories.filter(
    (token) =>
      !token.startsWith(MEDIUM_CHECK_PREFIX) &&
      (mediums.length === 0 || !token.startsWith('display_category:')),
  );
  return [
    ...new Set([
      ...kept,
      ...mediums.map((medium) => `display_category:${medium}`),
      `${MEDIUM_CHECK_PREFIX}${key}`,
    ]),
  ];
};

// The mediums stored for this key by an earlier crawl: display tokens next to the marker.
export const mediumsFromCategories = (categories = []) =>
  categories
    .filter((token) => token.startsWith('display_category:'))
    .map((token) => token.slice('display_category:'.length))
    .filter((medium) => MEDIUMS.includes(medium));

let anthropicClient = null;
const defaultClient = async (env) => {
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  }
  return anthropicClient;
};

export async function classifyEventMediums(event, source, env, clientFn = defaultClient) {
  const client = await clientFn(env);
  const venueMediums = source?.taxonomy?.display_category ?? [];
  const response = await client.messages.create({
    model: MEDIUM_CHECK_MODEL,
    max_tokens: 256,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: mediumSchema } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: mediumPrompt, cache_control: { type: 'ephemeral' } },
          {
            type: 'text',
            text: [
              `Venue: ${source?.name ?? ''}${venueMediums.length ? ` (usually: ${venueMediums.join(', ')})` : ''}`,
              `Title: ${event.title ?? ''}`,
              `Description: ${String(event.description ?? '').slice(0, MAX_DESCRIPTION_CHARS)}`,
            ].join('\n'),
          },
        ],
      },
    ],
  });
  if (response.stop_reason !== 'end_turn') return null;
  const text = response.content.find((block) => block.type === 'text')?.text;
  try {
    const { mediums } = JSON.parse(text ?? '');
    return Array.isArray(mediums)
      ? [...new Set(mediums.filter((medium) => MEDIUMS.includes(medium)))].slice(0, MAX_MEDIUMS)
      : null;
  } catch {
    return null;
  }
}

export async function checkEventMediums(
  event,
  source,
  { env = {}, lookupFn, classifyFn = classifyEventMediums, log = () => {} } = {},
) {
  if (!env.ANTHROPIC_API_KEY || env.MEDIUM_CHECK === '0') return event;
  if (source?.source_kind === 'aggregator' || !isArtVenue(source) || !event?.title) return event;
  const key = mediumCheckKey(source, event);
  try {
    const stored = lookupFn ? await lookupFn(key) : null;
    const mediums = stored ?? (await classifyFn(event, source, env));
    if (!mediums) return event;
    if (!stored)
      log(`medium check ${mediums.join(', ') || '(none, venue fallback)'}: ${event.title}`);
    return { ...event, categories: categoriesWithMediums(event.categories ?? [], mediums, key) };
  } catch (error) {
    // the event keeps the venue's mediums; the next crawl tries again
    log(
      `medium check failed for ${event.title}: ${error instanceof Error ? error.message : error}`,
    );
    return event;
  }
}
