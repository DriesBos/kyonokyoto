const BASE = 'https://ja.kyoto.travel';

const decode = (value = '') =>
  String(value)
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

const stripTags = (html = '') =>
  decode(
    String(html)
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

const normalize = (value = '') =>
  stripTags(value)
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[「」『』【】〈〉《》［］\[\]（）()・·,，.。:：]/g, '');

function absoluteUrl(value, base) {
  try {
    const url = new URL(decode(value), base);
    return url.origin === BASE && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function titleAliases(value) {
  const title = stripTags(String(value).replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, ''));
  const aliases = new Set([title, title.replace(/[（(][^）)]*[）)]/g, '')]);
  for (const match of title.matchAll(/[（(]([^）)]+)[）)]/g)) aliases.add(match[1]);
  return [...aliases].map(normalize).filter(Boolean);
}

/** Build exact normalized aliases from Kyoto Tourism directory listing pages. */
export function buildTemplePlaceIndex(pages = []) {
  const index = new Map();
  for (const page of pages) {
    const base = page.url || BASE;
    for (const card of String(page.html ?? '').matchAll(
      /<h[1-4]\b[^>]*class=["'][^"']*\btit\b[^"']*["'][^>]*>[\s\S]*?<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h[1-4]>/gi,
    )) {
      const href = absoluteUrl(card[1], base);
      if (
        !href ||
        !/\/tourism\/single0[12]\.php\?/.test(new URL(href).pathname + new URL(href).search)
      )
        continue;
      const tourismId = new URL(href).searchParams.get('tourism_id');
      const categoryId = new URL(href).searchParams.get('category_id');
      if (!/^\d+$/.test(tourismId ?? '') || !/^\d+$/.test(categoryId ?? '')) continue;
      for (const alias of titleAliases(card[2])) {
        const urls = index.get(alias) ?? new Set();
        urls.add(href);
        index.set(alias, urls);
      }
    }
  }
  return index;
}

/** Return unique exact directory match only; ambiguous or missing names stay unresolved. */
export function findTemplePlaceUrl(index, venue) {
  const urls = index.get(normalize(venue));
  if (!urls?.size) return null;
  const byId = new Map([...urls].map((url) => [new URL(url).searchParams.get('tourism_id'), url]));
  return byId.size === 1 ? byId.values().next().value : null;
}

function fieldValue(html, label) {
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const th = row[1].match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1];
    if (th && normalize(stripTags(th)) === normalize(label))
      return stripTags(row[1].match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '');
  }
  return '';
}

function placeAliases(html) {
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '';
  const formal = fieldValue(html, '正式名称');
  const common = fieldValue(html, '通称名称');
  return new Set([...titleAliases(heading), ...titleAliases(formal), ...titleAliases(common)]);
}

function detailArticle(html) {
  const main = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? '';
  return main.match(/<article\b[^>]*id=["']detail["'][^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? '';
}

function coordinates(html) {
  const ld = [
    ...html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ]
    .flatMap((m) => {
      try {
        const data = JSON.parse(m[1]);
        return Array.isArray(data) ? data : [data, ...(data['@graph'] ?? [])];
      } catch {
        return [];
      }
    })
    .map((v) => v.geo)
    .find((v) => v?.latitude && v?.longitude);
  if (ld) return { lat: Number(ld.latitude) || null, lng: Number(ld.longitude) || null };
  const sources = [
    ...html.matchAll(/(?:destination=|[?&](?:amp;)?q=)(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/gi),
  ];
  const match = sources[0] ?? html.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  return match
    ? { lat: Number(match[1]) || null, lng: Number(match[2]) || null }
    : { lat: null, lng: null };
}

/** Extract facts only after exact expected-venue alias validation. */
export function extractTemplePlaceFacts(html, url, expectedVenue) {
  const parsed = new URL(url);
  if (
    parsed.origin !== BASE ||
    parsed.username ||
    parsed.password ||
    !/^\/tourism\/single0[12]\.php$/.test(parsed.pathname)
  )
    return null;
  const article = detailArticle(html);
  if (!article || !expectedVenue) return null;
  const expected = normalize(expectedVenue);
  if (!placeAliases(article).has(expected)) return null;
  const address = fieldValue(article, '住所・所在地');
  const galleryStart = article.match(
    /<div\b[^>]*class=["'][^"']*\bdetailGallery\b[^"']*["'][^>]*>/i,
  );
  let gallery = '';
  if (galleryStart) {
    const content = article.slice(galleryStart.index + galleryStart[0].length);
    let depth = 1;
    for (const token of content.matchAll(/<\/?div\b[^>]*>/gi)) {
      depth += /^<\//.test(token[0]) ? -1 : 1;
      if (depth === 0) {
        gallery = content.slice(0, token.index);
        break;
      }
    }
  }
  const tourismId = new URL(url).searchParams.get('tourism_id');
  const imageUrls = [
    ...new Set(
      [...gallery.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)]
        .map((m) => absoluteUrl(m[1], url))
        .filter(
          (v) =>
            v &&
            new RegExp(`/resource/tourism/${tourismId}-\\d+\\.(?:jpe?g|png|webp)$`, 'i').test(
              new URL(v).pathname,
            ),
        ),
    ),
  ];
  const { lat, lng } = coordinates(article);
  return {
    venue_name: expectedVenue,
    address_text: address || null,
    lat,
    lng,
    image_urls: imageUrls,
    source_url: url,
  };
}

export { normalize as normalizeTemplePlaceName };
