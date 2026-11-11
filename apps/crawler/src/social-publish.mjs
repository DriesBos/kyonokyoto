// Instagram auto poster, step 2 (VPS, daily timer kyo-no-kyoto-social.timer).
// Takes the next post Dries approved on the Socials tab (Supabase social_posts), renders it with
// packages/shared/social-post.mjs (event-card box: photo, meta, title; same SVG as the tab's
// preview), uploads the JPEG to the public event-media bucket and publishes it with the Instagram
// Graph API (create container, then media_publish).
// One post per run. Posts whose event has ended are marked expired and skipped.
// Without INSTAGRAM_USER_ID / a token it exits quietly, so the timer is safe before setup.
// `node apps/crawler/src/social-publish.mjs --dry-run` renders the next post into
// apps/crawler/.social-preview/ and touches nothing else. See docs/instagram-autopost.md.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import {
  layoutSocialPost,
  measureSocialPostText,
  SOCIAL_CITY_COLORS,
  socialPostSvg,
} from '../../../packages/shared/social-post.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
const appRoot = resolve(__dirname, '..');
export const FONT_PATH = resolve(repoRoot, 'apps/web-next/src/app/fonts/GT-Walsheim-Regular.woff2');
const BUCKET = 'event-media';
const TOKEN_REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export const todayInTokyo = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(now);

// Soonest-ending first (so ending events go out in time), then oldest approval.
export function planQueue(posts, today) {
  const expired = posts.filter((post) => post.event_end_date && post.event_end_date < today);
  const live = posts
    .filter((post) => !expired.includes(post))
    .sort(
      (left, right) =>
        (left.event_end_date ?? '9999-12-31').localeCompare(right.event_end_date ?? '9999-12-31') ||
        String(left.created_at).localeCompare(String(right.created_at)),
    );
  return { expired, next: live[0] ?? null };
}

let fontPromise = null;
export const loadSocialFont = () =>
  (fontPromise ??= Promise.all([import('fontkit'), readFile(FONT_PATH)]).then(([fontkit, bytes]) =>
    (fontkit.create ?? fontkit.default.create)(bytes),
  ));

// The post as a 1080 x 1350 JPEG: the photo keeps its ratio and is never cropped (its box has the
// same ratio, so 'fill' only absorbs pixel rounding); the meta and title show as far as
// they fit (layoutSocialPost). Throws when the image can't make a post (too wide / too tall).
export async function renderSocialImage({ post, imageBytes, font, sharpImpl }) {
  const sharp = sharpImpl ?? (await import('sharp')).default;
  const { data: oriented, info } = await sharp(imageBytes)
    .rotate()
    .toBuffer({ resolveWithObject: true });
  const layout = post.layout ?? 'inset';
  const resolvedFont = font ?? (await loadSocialFont());
  const text = measureSocialPostText(
    resolvedFont,
    { venue: post.venue, date: post.event_date_text, title: post.event_title },
    layout,
  );
  const result = layoutSocialPost({
    layout,
    imageWidth: info.width,
    imageHeight: info.height,
    meta: text.meta,
    title: text.title,
  });
  if (!result.ok) throw new Error(`can't make a post: ${result.reason}`);
  const photo = await sharp(oriented)
    .resize(result.photo.width, result.photo.height, { fit: 'fill' })
    .jpeg({ quality: 92 })
    .toBuffer();
  const svg = socialPostSvg(result, {
    color: SOCIAL_CITY_COLORS[post.city] ?? SOCIAL_CITY_COLORS.kyoto,
    imageHref: `data:image/jpeg;base64,${photo.toString('base64')}`,
    metaPaths: text.metaPaths,
    titlePaths: text.titlePaths,
  });
  return sharp(Buffer.from(svg)).jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
}

const supabase = (env, fetchImpl) => {
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  };
  return {
    async approved() {
      const url = new URL('/rest/v1/social_posts', env.SUPABASE_URL);
      url.search = 'select=*&status=eq.approved';
      const response = await fetchImpl(url, { headers });
      if (!response.ok) throw new Error(`social_posts read failed: ${response.status}`);
      return response.json();
    },
    async update(id, fields) {
      const url = new URL('/rest/v1/social_posts', env.SUPABASE_URL);
      url.search = `id=eq.${id}`;
      const response = await fetchImpl(url, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ ...fields, updated_at: new Date().toISOString() }),
      });
      if (!response.ok) throw new Error(`social_posts update failed: ${response.status}`);
    },
    async upload(path, bytes) {
      const response = await fetchImpl(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
        body: bytes,
      });
      if (!response.ok) throw new Error(`upload failed: ${response.status}`);
      return `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
    },
    async remove(path) {
      await fetchImpl(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'DELETE',
        headers,
      }).catch(() => {});
    },
  };
};

// Long-lived Instagram tokens last 60 days; refreshing (allowed once a token is 24h old) gives a
// new 60 days. The current token lives in INSTAGRAM_TOKEN_FILE so refreshes survive restarts.
export async function currentInstagramToken(env, fetchImpl = fetch, now = Date.now()) {
  const file = resolve(repoRoot, env.INSTAGRAM_TOKEN_FILE || 'apps/crawler/.instagram-token.json');
  let stored = null;
  try {
    stored = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    // first run: seed from .env
  }
  const token = stored?.access_token || env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return null;
  const refreshedAt = Date.parse(stored?.refreshed_at ?? '') || 0;
  if (now - refreshedAt < TOKEN_REFRESH_AFTER_MS) return token;
  const host = env.INSTAGRAM_GRAPH_HOST || 'https://graph.instagram.com';
  const url = new URL('/refresh_access_token', host);
  url.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: token });
  try {
    const response = await fetchImpl(url);
    const json = await response.json();
    if (!response.ok || !json.access_token)
      throw new Error(json?.error?.message ?? response.status);
    await writeFile(
      file,
      `${JSON.stringify({ access_token: json.access_token, refreshed_at: new Date(now).toISOString() }, null, 2)}\n`,
      { mode: 0o600 },
    );
    return json.access_token;
  } catch (error) {
    console.warn(`instagram token refresh failed (using current token): ${error.message}`);
    return token;
  }
}

export async function publishToInstagram({ env, token, imageUrl, caption, fetchImpl = fetch }) {
  const host = env.INSTAGRAM_GRAPH_HOST || 'https://graph.instagram.com';
  const version = env.INSTAGRAM_API_VERSION || 'v23.0';
  const base = `${host}/${version}`;
  const call = async (path, params, method = 'POST') => {
    const url = new URL(`${base}/${path}`);
    const body = new URLSearchParams({ ...params, access_token: token });
    const response =
      method === 'GET' ? await fetchImpl(`${url}?${body}`) : await fetchImpl(url, { method, body });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.error) {
      throw new Error(`instagram ${path}: ${json?.error?.message ?? response.status}`);
    }
    return json;
  };
  const container = await call(`${env.INSTAGRAM_USER_ID}/media`, { image_url: imageUrl, caption });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const { status_code: status } = await call(container.id, { fields: 'status_code' }, 'GET');
    if (status === 'FINISHED') break;
    if (status === 'ERROR' || status === 'EXPIRED')
      throw new Error(`instagram container ${status}`);
    await new Promise((done) => setTimeout(done, 3000));
  }
  const published = await call(`${env.INSTAGRAM_USER_ID}/media_publish`, {
    creation_id: container.id,
  });
  return published.id;
}

const downloadImage = async (url, env, fetchImpl) => {
  const response = await fetchImpl(url, {
    headers: { 'User-Agent': env.CRAWLER_USER_AGENT || 'kyo-no-kyoto-bot' },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`event image ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
};

export async function runSocialPublish(
  env,
  { dryRun = false, fetchImpl = fetch, log = console.log } = {},
) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase env missing');
  const db = supabase(env, fetchImpl);
  const today = todayInTokyo();
  const { expired, next } = planQueue(await db.approved(), today);
  if (!dryRun) {
    for (const post of expired) await db.update(post.id, { status: 'expired' });
  }
  if (expired.length) log(`expired ${expired.length} post(s) whose event ended`);
  if (!next) return (log('social: nothing approved to post'), { status: 'empty' });

  const token = dryRun ? null : await currentInstagramToken(env, fetchImpl);
  if (!dryRun && (!env.INSTAGRAM_USER_ID || !token)) {
    log('social: Instagram not configured (INSTAGRAM_USER_ID / token), nothing posted');
    return { status: 'not_configured' };
  }

  try {
    const jpeg = await renderSocialImage({
      post: next,
      imageBytes: await downloadImage(next.image_url, env, fetchImpl),
    });
    if (dryRun) {
      const out = resolve(appRoot, '.social-preview', `${next.id}.jpg`);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, jpeg);
      log(`social (dry run): ${next.event_title} → ${out}\n\n${next.caption}`);
      return { status: 'dry_run', path: out };
    }
    const objectPath = `social/${next.id}.jpg`;
    const imageUrl = await db.upload(objectPath, jpeg);
    const mediaId = await publishToInstagram({
      env,
      token,
      imageUrl,
      caption: next.caption,
      fetchImpl,
    });
    await db.update(next.id, {
      status: 'published',
      published_at: new Date().toISOString(),
      instagram_media_id: mediaId,
      error: null,
    });
    // Instagram keeps its own copy; free the bucket (Supabase Free plan).
    await db.remove(objectPath);
    log(`social: posted ${next.event_title} (${mediaId})`);
    return { status: 'published', mediaId };
  } catch (error) {
    if (!dryRun) await db.update(next.id, { status: 'failed', error: error.message });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fileEnv = parseEnv(await readFile(resolve(appRoot, '.env'), 'utf8'));
  const env = { ...fileEnv, ...process.env };
  await runSocialPublish(env, { dryRun: process.argv.includes('--dry-run') });
}
