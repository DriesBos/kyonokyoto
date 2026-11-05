// Event images should be photos of art, spaces or events: no flyers, posters, overlaid text,
// dates or logos. The crawler asks a small vision model once per image (an event's first three)
// and stores its tags on image_metadata[]: landing_ok (clean or not), image_subject,
// image_busyness, image_score (1-10) and image_confidence. The web ranks images with tunable
// weights (apps/web-next/src/lib/imageRanking.ts), so taste changes never need new calls. Tags are
// reused from earlier crawls by image URL, so only new images cost a call. Without
// ANTHROPIC_API_KEY nothing is checked.
//
// Dries's manual ratings (data/image-ratings.json, set at /dev/images/) teach the model: his
// latest +2 (preferred) and -2 (leave out) images go with every request as examples, cached so
// they cost a tenth after the first call. `pnpm images:recheck` re-tags stored images afterwards.

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LANDING_CHECK_MODEL = 'claude-haiku-5-5';
// cards and the landing only use an event's first three images
const MAX_CHECKED_IMAGES_PER_EVENT = 3;

export const IMAGE_SUBJECTS = [
  'artwork',
  'illustration',
  'installation',
  'interior',
  'exterior',
  'event',
  'people',
  'graphic',
];
export const IMAGE_BUSYNESS = ['calm', 'medium', 'busy'];
export const IMAGE_CONFIDENCE = ['high', 'medium', 'low'];
// examples per side (+2 and -2) sent with each request
const EXAMPLES_PER_SIDE = 3;

const verdictSchema = {
  type: 'object',
  properties: {
    clean: { type: 'boolean' },
    subject: { type: 'string', enum: IMAGE_SUBJECTS },
    busyness: { type: 'string', enum: IMAGE_BUSYNESS },
    score: { type: 'integer' },
    confidence: { type: 'string', enum: IMAGE_CONFIDENCE },
    reason: { type: 'string' },
  },
  required: ['clean', 'subject', 'busyness', 'score', 'confidence', 'reason'],
  additionalProperties: false,
};

const verdictPrompt = `You judge images from an art and culture event listing. They may be shown on an event card or fullscreen on the landing page. Judge the LAST image in this message.
clean: true only if it is a clean photo or reproduction of an artwork, an exhibition space, a building, or an event in progress. False if it is a flyer, poster, banner or graphic design, or if it has overlaid text, titles, dates, prices or logos added on top of the picture. Text that is naturally part of an artwork or a scene (a painted word in a painting, a sign in a street photo) is fine.
subject, the main thing shown:
- artwork: a single artwork or a reproduction of one, filling most of the frame
- illustration: a drawn, painted or digital illustration (not a flyer or poster layout)
- installation: an exhibition view showing artworks in the space
- interior: a room, lobby or space without artworks as the focus
- exterior: a building or outdoor view
- event: a performance, talk, workshop or crowd at an event
- people: a portrait, such as of the artist
- graphic: a flyer, poster, logo, text panel or other graphic design
busyness: calm (simple composition, lots of breathing room), medium, or busy (cluttered, many elements, crowded).
score: 1-10, how strong this is as a calm, photographic, gallery-quality image for an editorial art website. Sharp, well-composed photos of artworks score high; blurry, cluttered, low-resolution or text-heavy images score low.
confidence: high if the call is clear, low if you are unsure about clean or the score (for example a small text block, a borderline graphic, or an unclear subject).
Give a short reason.`;

const examplesIntro = `The site's editor rated these images. Match their taste: preferred images should score 9-10, left-out images 1-2 (and are often not clean).`;
const targetIntro = 'The image to judge:';

const ratingsPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../data/image-ratings.json',
);

// The latest +2 and -2 ratings (the file keeps rating order: newest last).
export const selectRatingExamples = (ratings, perSide = EXAMPLES_PER_SIDE) => {
  const entries = Object.entries(ratings ?? {});
  const latest = (rating) =>
    entries
      .filter(([, value]) => value === rating)
      .slice(-perSide)
      .map(([url]) => ({ url, rating }));
  return [...latest(2), ...latest(-2)];
};

let examplesPromise = null;
export const loadRatingExamples = (path = ratingsPath) => {
  examplesPromise ??= readFile(path, 'utf8')
    .then((text) => selectRatingExamples(JSON.parse(text).ratings))
    .catch(() => []);
  return examplesPromise;
};

// Message content: stable prompt + examples first (cached prefix), the image to judge last.
export const verdictContent = (env, imageUrl, examples = []) => {
  const content = [{ type: 'text', text: verdictPrompt }];
  if (examples.length) {
    content.push({ type: 'text', text: examplesIntro });
    for (const example of examples) {
      content.push(
        { type: 'image', source: { type: 'url', url: landingCheckImageUrl(env, example.url) } },
        {
          type: 'text',
          text: example.rating > 0 ? 'Editor: preferred (+2).' : 'Editor: leave out (-2).',
        },
      );
    }
  }
  content[content.length - 1] = {
    ...content[content.length - 1],
    cache_control: { type: 'ephemeral' },
  };
  content.push(
    { type: 'text', text: targetIntro },
    { type: 'image', source: { type: 'url', url: landingCheckImageUrl(env, imageUrl) } },
  );
  return content;
};

const clampScore = (value) =>
  Number.isFinite(value) ? Math.min(10, Math.max(1, Math.round(value))) : null;

// The tags stored on an image_metadata entry; null if the verdict is unusable.
export const imageTagsFromVerdict = (verdict) => {
  if (typeof verdict?.clean !== 'boolean') return null;
  return {
    landing_ok: verdict.clean,
    image_subject: IMAGE_SUBJECTS.includes(verdict.subject) ? verdict.subject : null,
    image_busyness: IMAGE_BUSYNESS.includes(verdict.busyness) ? verdict.busyness : null,
    image_score: clampScore(verdict.score),
    image_confidence: IMAGE_CONFIDENCE.includes(verdict.confidence) ? verdict.confidence : null,
  };
};

// Fully tagged = checked with the current tag set (landing_ok alone is the older check).
export const hasImageTags = (image) =>
  typeof image?.landing_ok === 'boolean' && typeof image?.image_score === 'number';

let anthropicClient = null;
const defaultClient = async (env) => {
  if (!anthropicClient) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    anthropicClient = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  }
  return anthropicClient;
};

// Claude fetches the image through the site's Netlify Image CDN at a modest size: small, fast and
// it works for museum hosts that block fetchers outside Japan once they are rehosted.
export const landingCheckImageUrl = (env, imageUrl) => {
  const origin = (env.SITE_URL || 'https://kyonokyoto.xyz').replace(/\/+$/, '');
  return `${origin}/.netlify/images?${new URLSearchParams({ url: imageUrl, w: '1024', q: '70' })}`;
};

export async function classifyLandingImage(
  imageUrl,
  env,
  clientFn = defaultClient,
  examplesFn = loadRatingExamples,
) {
  const client = await clientFn(env);
  const examples = env.IMAGE_CHECK_EXAMPLES === '0' ? [] : await examplesFn();
  const response = await client.messages.create({
    model: LANDING_CHECK_MODEL,
    max_tokens: 1024,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: verdictSchema } },
    messages: [
      {
        role: 'user',
        content: verdictContent(env, imageUrl, examples),
      },
    ],
  });
  if (response.stop_reason !== 'end_turn') return null;
  const text = response.content.find((block) => block.type === 'text')?.text;
  try {
    const verdict = JSON.parse(text ?? '');
    return typeof verdict.clean === 'boolean' ? verdict : null;
  } catch {
    return null;
  }
}

export async function checkLandingImages(
  eventData,
  _source,
  { env = {}, lookupVerdictFn, classifyFn = classifyLandingImage, log = () => {} } = {},
) {
  if (!env.ANTHROPIC_API_KEY || env.IMAGE_CHECK === '0') return eventData;
  const metadata = eventData.image_metadata ?? [];
  if (!metadata.length) return eventData;

  const checkedUrls = new Set((eventData.image_urls ?? []).slice(0, MAX_CHECKED_IMAGES_PER_EVENT));
  const nextMetadata = [];
  for (const image of metadata) {
    if (!checkedUrls.has(image.url) || hasImageTags(image)) {
      nextMetadata.push(image);
      continue;
    }
    try {
      const known = lookupVerdictFn ? await lookupVerdictFn(image.url) : null;
      if (hasImageTags(known)) {
        nextMetadata.push({ ...image, ...pickTags(known) });
        continue;
      }
      const verdict = await classifyFn(image.url, env);
      const tags = imageTagsFromVerdict(verdict);
      if (tags) {
        log(
          `image check ${tags.landing_ok ? 'clean' : 'rejected'} ${tags.image_subject}/${tags.image_busyness}/${tags.image_score} (${tags.image_confidence}): ${image.url} (${verdict.reason})`,
        );
      }
      nextMetadata.push(tags ? { ...image, ...tags } : image);
    } catch (error) {
      // leave it unchecked; the next crawl tries again
      log(`image check failed for ${image.url}: ${error instanceof Error ? error.message : error}`);
      nextMetadata.push(image);
    }
  }
  return { ...eventData, image_metadata: nextMetadata };
}

const pickTags = (image) => ({
  landing_ok: image.landing_ok,
  image_subject: image.image_subject ?? null,
  image_busyness: image.image_busyness ?? null,
  image_score: image.image_score,
  image_confidence: image.image_confidence ?? null,
});
