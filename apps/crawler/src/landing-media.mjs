import { createHash } from 'node:crypto';

// Landing images: the one place the site serves images from Supabase Storage. Each event of a
// landing_slider source gets one landing image, stored as two small WebP files (desktop and
// mobile, centre crop) and served through Netlify Image CDN with a fixed format. Kept small on
// purpose to stay within the Supabase Free plan (docs/supabase-free-plan.md). Card images are
// never stored: they always load from the venue's own site.
export const LANDING_MEDIA_BUCKET = 'event-media';
export const LANDING_VARIANTS = {
  desktop: { width: 1920, height: 1080 },
  mobile: { width: 900, height: 1600 },
};
const LANDING_QUALITY = 60;
const LANDING_FIELDS = ['landing_desktop', 'landing_mobile'];

const hasLandingFiles = (image) =>
  LANDING_FIELDS.every((field) => typeof image?.[field] === 'string' && image[field].length > 0);

const withoutLandingFiles = (image) => {
  const { landing_desktop: _desktop, landing_mobile: _mobile, ...rest } = image;
  return rest;
};

// The event's landing image: the first approved by the image check, else the first not rejected.
export function landingImageFor(metadata = []) {
  return (
    metadata.find((image) => image?.landing_ok === true) ??
    metadata.find((image) => image?.url && image.landing_ok !== false) ??
    null
  );
}

export function landingObjectPath(sourceSlug, imageUrl, variant) {
  const hash = createHash('sha256').update(imageUrl).digest('hex').slice(0, 32);
  return `landing/${sourceSlug}/${hash}-${variant}.webp`;
}

export function publicLandingMediaUrl(env, objectPath) {
  return `${env.SUPABASE_URL}/storage/v1/object/public/${LANDING_MEDIA_BUCKET}/${objectPath}`;
}

// Landscape images are the norm, so the mobile crop is simply centred.
export async function renderLandingVariants(bytes, sharpImpl) {
  const sharp = sharpImpl ?? (await import('sharp')).default;
  const entries = await Promise.all(
    Object.entries(LANDING_VARIANTS).map(async ([variant, size]) => [
      variant,
      await sharp(bytes)
        .rotate()
        .resize({ ...size, fit: 'cover', position: 'centre', withoutEnlargement: false })
        .webp({ quality: LANDING_QUALITY })
        .toBuffer(),
    ]),
  );
  return Object.fromEntries(entries);
}

// Adds landing_desktop / landing_mobile (public URLs) to the event's landing image. Files made
// by an earlier crawl are reused (lookupFn), so each image is downloaded and uploaded once.
export async function attachLandingMedia(
  eventData,
  source,
  {
    env = {},
    lookupFn,
    downloadFn,
    uploadFn,
    renderFn = renderLandingVariants,
    log = () => {},
  } = {},
) {
  const metadata = (eventData?.image_metadata ?? []).map(withoutLandingFiles);
  const cleared = { ...eventData, image_metadata: metadata };
  if (source?.landing_slider !== true || !env.SUPABASE_URL || !source?.slug) return cleared;

  const image = landingImageFor(metadata);
  if (!image) return cleared;

  const withFiles = (files) => ({
    ...cleared,
    image_metadata: metadata.map((item) => (item === image ? { ...item, ...files } : item)),
  });

  try {
    const known = lookupFn ? await lookupFn(image.url) : null;
    if (hasLandingFiles(known)) {
      return withFiles({
        landing_desktop: known.landing_desktop,
        landing_mobile: known.landing_mobile,
      });
    }

    const download = await downloadFn(image.url);
    if (!download?.bytes?.length) return cleared;
    const variants = await renderFn(download.bytes);
    const files = {};
    for (const [variant, bytes] of Object.entries(variants)) {
      const objectPath = landingObjectPath(source.slug, image.url, variant);
      await uploadFn(env, objectPath, { bytes, contentType: 'image/webp' });
      files[`landing_${variant}`] = publicLandingMediaUrl(env, objectPath);
    }
    log(`landing files made for ${image.url}`);
    return withFiles(files);
  } catch (error) {
    // no landing image this crawl; the next crawl tries again
    log(`landing files failed for ${image.url}: ${error instanceof Error ? error.message : error}`);
    return cleared;
  }
}
