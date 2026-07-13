const YUTAKA_IMAGE_ORIGIN = 'https://www.yutakakikutakegallery.com';
const YUTAKA_IMAGE_PATH_PREFIX = '/ykgg/wp-content/uploads/';
const YUTAKA_IMAGE_PROXY_PATH = '/api/yutaka-image';
const MAX_YUTAKA_IMAGE_BYTES = 12 * 1024 * 1024;
const YUTAKA_IMAGE_TIMEOUT_MS = 10_000;

const rasterImagePathPattern = /\.(?:avif|gif|jpe?g|png|webp)$/i;
const allowedImageContentTypes = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const validatedYutakaImageUrl = (value: unknown): URL | null => {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return null;
    if (url.origin !== YUTAKA_IMAGE_ORIGIN) return null;
    if (url.username || url.password || url.port) return null;
    if (!url.pathname.startsWith(YUTAKA_IMAGE_PATH_PREFIX)) return null;
    if (!rasterImagePathPattern.test(url.pathname)) return null;
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return null;
  }
};

export const eventMediaDeliveryUrl = (value: string | null): string | null => {
  const upstream = validatedYutakaImageUrl(value);
  if (!upstream) return value;
  return `${YUTAKA_IMAGE_PROXY_PATH}?url=${encodeURIComponent(upstream.href)}`;
};

export const withEventMediaDelivery = <
  T extends { primary_image_url: string | null; image_urls: string[] | null },
>(
  event: T,
): T => ({
  ...event,
  primary_image_url: eventMediaDeliveryUrl(event.primary_image_url),
  image_urls: event.image_urls?.map((url) => eventMediaDeliveryUrl(url) ?? url) ?? null,
});

const noStoreResponse = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });

const cancelResponseBody = async (response: Response) => {
  await response.body?.cancel().catch(() => undefined);
};

const readImageBodyWithinLimit = async (response: Response): Promise<Uint8Array | null> => {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_YUTAKA_IMAGE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

export const proxyYutakaImage = async (
  request: Request,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> => {
  const requestedUrl = new URL(request.url).searchParams.get('url');
  const upstreamUrl = validatedYutakaImageUrl(requestedUrl);
  if (!upstreamUrl || requestedUrl !== upstreamUrl.href) {
    return noStoreResponse('Invalid image URL', 400);
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetchImpl(upstreamUrl, {
      headers: {
        Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif',
        Referer: `${YUTAKA_IMAGE_ORIGIN}/`,
        'User-Agent': 'kyo-no-kyoto-media-proxy/1.0',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(YUTAKA_IMAGE_TIMEOUT_MS),
    });
  } catch {
    return noStoreResponse('Upstream image unavailable', 502);
  }

  if (!upstreamResponse.ok || (upstreamResponse.status >= 300 && upstreamResponse.status < 400)) {
    await cancelResponseBody(upstreamResponse);
    return noStoreResponse('Upstream image unavailable', 502);
  }

  const contentType = upstreamResponse.headers.get('Content-Type')?.split(';', 1)[0].trim() ?? '';
  if (!allowedImageContentTypes.has(contentType.toLowerCase())) {
    await cancelResponseBody(upstreamResponse);
    return noStoreResponse('Upstream response is not a supported image', 502);
  }

  const contentLength = Number(upstreamResponse.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_YUTAKA_IMAGE_BYTES) {
    await cancelResponseBody(upstreamResponse);
    return noStoreResponse('Upstream image is too large', 502);
  }

  let body: Uint8Array | null;
  try {
    body = await readImageBodyWithinLimit(upstreamResponse);
  } catch {
    return noStoreResponse('Upstream image unavailable', 502);
  }
  if (!body) {
    return noStoreResponse('Upstream image is too large', 502);
  }

  return new Response(body, {
    status: 200,
    headers: {
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Content-Length': String(body.byteLength),
      'Content-Type': contentType,
      'Netlify-CDN-Cache-Control':
        'public, durable, max-age=604800, stale-while-revalidate=2592000',
      'Netlify-Vary': 'query=url',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
