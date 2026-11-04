// Landing images are shown fullscreen, so they must be photos of art, spaces or events: no
// flyers, posters, overlaid text, dates or logos. For landing-slider sources the crawler asks a
// small vision model once per image and stores the verdict as image_metadata[].landing_ok; the
// landing skips images marked false. Verdicts are reused from earlier crawls by image URL, so
// only new images cost a call. Without ANTHROPIC_API_KEY nothing is checked (landing_ok unset).

export const LANDING_CHECK_MODEL = 'claude-haiku-5-5';
// the landing only uses an event's first three images
const MAX_CHECKED_IMAGES_PER_EVENT = 3;

const verdictSchema = {
  type: 'object',
  properties: {
    landing_ok: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['landing_ok', 'reason'],
  additionalProperties: false,
};

const verdictPrompt = `This image may be shown fullscreen as a background on an art and culture events website.
It is suitable only if it is a clean photo or reproduction of an artwork, an exhibition space, a building, or an event in progress.
It is NOT suitable if it is a flyer, poster, banner or graphic design, or if it has overlaid text, titles, dates, prices or logos added on top of the picture.
Text that is naturally part of an artwork or a scene (for example a painted word in a painting or a sign in a street photo) is fine.
Give landing_ok and a short reason.`;

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

export async function classifyLandingImage(imageUrl, env, clientFn = defaultClient) {
  const client = await clientFn(env);
  const response = await client.messages.create({
    model: LANDING_CHECK_MODEL,
    max_tokens: 1024,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: verdictSchema } },
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'url', url: landingCheckImageUrl(env, imageUrl) } },
          { type: 'text', text: verdictPrompt },
        ],
      },
    ],
  });
  if (response.stop_reason !== 'end_turn') return null;
  const text = response.content.find((block) => block.type === 'text')?.text;
  try {
    const verdict = JSON.parse(text ?? '');
    return typeof verdict.landing_ok === 'boolean' ? verdict : null;
  } catch {
    return null;
  }
}

export async function checkLandingImages(
  eventData,
  source,
  { env = {}, lookupVerdictFn, classifyFn = classifyLandingImage, log = () => {} } = {},
) {
  if (source?.landing_slider !== true || !env.ANTHROPIC_API_KEY) return eventData;
  const metadata = eventData.image_metadata ?? [];
  if (!metadata.length) return eventData;

  const checkedUrls = new Set((eventData.image_urls ?? []).slice(0, MAX_CHECKED_IMAGES_PER_EVENT));
  const nextMetadata = [];
  for (const image of metadata) {
    if (!checkedUrls.has(image.url) || typeof image.landing_ok === 'boolean') {
      nextMetadata.push(image);
      continue;
    }
    try {
      const known = lookupVerdictFn ? await lookupVerdictFn(image.url) : null;
      const verdict =
        typeof known === 'boolean' ? { landing_ok: known } : await classifyFn(image.url, env);
      if (verdict && typeof known !== 'boolean') {
        log(
          `landing check ${verdict.landing_ok ? 'ok' : 'rejected'}: ${image.url} (${verdict.reason})`,
        );
      }
      nextMetadata.push(verdict ? { ...image, landing_ok: verdict.landing_ok } : image);
    } catch (error) {
      // leave it unchecked; the next crawl tries again
      log(
        `landing check failed for ${image.url}: ${error instanceof Error ? error.message : error}`,
      );
      nextMetadata.push(image);
    }
  }
  return { ...eventData, image_metadata: nextMetadata };
}
