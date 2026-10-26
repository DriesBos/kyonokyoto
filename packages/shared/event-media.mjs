export const MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX = 540;

// CMS theme chrome (e.g. Drupal /themes/custom/asia/images/...footer.svg on asiasociety.org),
// never event media. Also applied at display time to rows stored before the crawler filtered it.
export const isSiteThemeAssetUrl = (url) =>
  /\/themes\/(?:custom|contrib)\/[^/]+\/images\//i.test(String(url ?? ''));

const SHOPIFY_SIZE_PARAMS = ['width', 'height', 'crop', 'pad_color', 'format'];
// Cloudinary-style transform segments, e.g. /w_920,h_920,c_limit,f_auto/ (artlogic).
const TRANSFORM_SEGMENT = /^(?:[a-z]{1,3}_[^,/]+,)+[a-z]{1,3}_[^,/]+$|^[wh]_\d+$/i;

const isShopifyImageUrl = (url) =>
  url.hostname === 'cdn.shopify.com' || url.pathname.startsWith('/cdn/shop/');

// Maps size/crop variants of one asset to the same key:
// WordPress name-1280x853.jpg / name-scaled.jpg, Shopify ?width=533 / name_600x.jpg,
// and artlogic /w_920,h_920,.../group_images_override/96/name.jpg vs main_image_override.
export const imageDedupeKey = (url) => {
  const value = String(url ?? '').replace(
    /-(?:\d+x\d+|scaled)(\.(?:jpe?g|png|gif|webp|avif))(?=$|[?#])/i,
    '$1',
  );
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return value;
  }

  const original = parsed.toString();
  if (isShopifyImageUrl(parsed)) {
    for (const param of SHOPIFY_SIZE_PARAMS) parsed.searchParams.delete(param);
    parsed.pathname = parsed.pathname.replace(
      /_(?:\d+x\d*|x\d+)(?:_crop_[a-z]+)?(?:@\dx)?(\.(?:jpe?g|png|gif|webp|avif))$/i,
      '$1',
    );
  }

  parsed.pathname = parsed.pathname
    .split('/')
    .filter((segment) => !TRANSFORM_SEGMENT.test(segment))
    .join('/')
    .replace(/\/[a-z]+(?:_[a-z]+)*_override\//i, '/override/');

  // Return the input untouched when nothing changed, so originals compare equal to their key.
  const key = parsed.toString();
  return key === original ? value : key;
};

export const isOriginalImageVariant = (url) => imageDedupeKey(url) === url;

// Collapses size variants of the same asset, keeping the first position and preferring the original.
export const dedupeImageUrls = (urls) => {
  const byKey = new Map();
  for (const url of urls) {
    const key = imageDedupeKey(url);
    const existing = byKey.get(key);
    if (!existing || (!isOriginalImageVariant(existing) && isOriginalImageVariant(url))) {
      byKey.set(key, url);
    }
  }
  return [...byKey.values()];
};

// Display-side guard for rows stored before the crawler deduped a variant: one slot per
// asset, using the primary image's URL for its own slot.
const dedupeDisplayImageUrls = (urls, primaryUrl) => {
  const primaryKey = primaryUrl ? imageDedupeKey(primaryUrl) : null;
  const seen = new Set();
  const result = [];
  for (const url of urls) {
    const key = imageDedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key === primaryKey ? primaryUrl : url);
  }
  return result;
};

export const filterEventMediaByMinimumHeight = (event) => {
  const measuredHeightByUrl = new Map(
    (event.image_metadata ?? [])
      .filter((image) => Number.isFinite(image.height) && image.height > 0)
      .map((image) => [image.url, image.height]),
  );
  const isEligible = (url) => {
    if (isSiteThemeAssetUrl(url)) return false;
    const height = measuredHeightByUrl.get(url);
    return height === undefined || height >= MIN_EVENT_MEDIA_SOURCE_HEIGHT_PX;
  };
  const eligiblePrimary =
    event.primary_image_url && isEligible(event.primary_image_url) ? event.primary_image_url : null;
  const imageUrls = dedupeDisplayImageUrls(
    (event.image_urls ?? []).filter(isEligible),
    eligiblePrimary,
  );

  return {
    ...event,
    primary_image_url: eligiblePrimary ?? imageUrls[0] ?? null,
    image_urls: event.image_urls === null ? null : imageUrls,
    image_metadata:
      event.image_metadata === null
        ? null
        : (event.image_metadata ?? []).filter((image) => isEligible(image.url)),
  };
};
