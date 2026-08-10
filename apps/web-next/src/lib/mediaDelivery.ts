const EVENT_IMAGE_WIDTHS = [320, 640, 960];
const EVENT_IMAGE_QUALITY = '60';

export const safeEventImageSource = (value: string | null): string | null => {
  if (typeof value !== 'string') return null;

  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) {
      return null;
    }
    url.hash = '';
    return url.href;
  } catch {
    return null;
  }
};

const netlifyImageUrl = (source: string, width: number) =>
  `/.netlify/images?${new URLSearchParams({
    url: source,
    w: String(width),
    q: EVENT_IMAGE_QUALITY,
  })}`;

export const eventMediaDeliveryUrl = (value: string | null): string | null => {
  const source = safeEventImageSource(value);
  if (!source) return null;
  return process.env.NETLIFY ? netlifyImageUrl(source, 640) : source;
};

export const eventMediaDeliverySrcSet = (value: string | null): string | null => {
  const source = safeEventImageSource(value);
  if (!source || !process.env.NETLIFY) return null;
  return EVENT_IMAGE_WIDTHS.map((width) => `${netlifyImageUrl(source, width)} ${width}w`).join(', ');
};

export const landingMediaDeliveryUrl = (
  value: string | null,
  width: number,
  height: number,
  useNetlifyImageCdn: boolean,
): string | null => {
  const source = safeEventImageSource(value);
  if (!source) return null;
  if (!useNetlifyImageCdn) return source;

  return `/.netlify/images?${new URLSearchParams({
    url: source,
    w: String(width),
    h: String(height),
    fit: 'cover',
    position: 'center',
    q: '82',
  })}`;
};
