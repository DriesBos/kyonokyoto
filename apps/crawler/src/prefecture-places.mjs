import { normalizeTemplePlaceName } from './temple-places.mjs';

const ORIGIN = 'https://www.kyoto-kankou.or.jp';
const plain = (html = '') =>
  String(html)
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const nameMatches = (actual, expected) =>
  normalizeTemplePlaceName(actual) === normalizeTemplePlaceName(expected);

export function prefecturePlaceSearchUrl(venue) {
  const url = new URL('/info_search', ORIGIN);
  // Observed official GET search form field, not a guessed endpoint.
  url.searchParams.set('q[name_or_description_cont]', venue);
  return url.href;
}

export function findPrefecturePlaceUrl(html, expectedVenue) {
  const matches = new Set();
  for (const card of html.matchAll(
    /<article\b[^>]*class=["'][^"']*\bspotArticle\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi,
  )) {
    const title = card[1].match(
      /<h[1-4]\b[^>]*class=["'][^"']*\bspotArticle__title\b[^"']*["'][^>]*>([\s\S]*?)<\/h[1-4]>/i,
    )?.[1];
    if (!title || !nameMatches(plain(title), expectedVenue)) continue;
    const path = card[1].match(/href=["'](\/info_search\/\d+)["']/)?.[1];
    if (path) matches.add(new URL(path, ORIGIN).href);
  }
  return matches.size === 1 ? [...matches][0] : null;
}

export function extractPrefecturePlaceFacts(html, url, expectedVenue) {
  const parsed = new URL(url);
  if (parsed.origin !== ORIGIN || !/^\/info_search\/\d+$/.test(parsed.pathname)) return null;
  const start = html.search(/<article\b[^>]*class=["']showArticle["']/i);
  if (start < 0) return null;
  const article = html.slice(start).split(/<div\b[^>]*class=["']showArticle__connection/i)[0];
  const title = article.match(
    /<h1\b[^>]*class=["']showArticle__title["'][^>]*>([\s\S]*?)<\/h1>/i,
  )?.[1];
  if (!title || !nameMatches(plain(title), expectedVenue)) return null;
  let address = '';
  for (const row of article.matchAll(
    /<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi,
  )) {
    if (/^(?:住所|所在地)$/.test(plain(row[1]))) address = plain(row[2]);
  }
  const hero = article.split(/<div\b[^>]*class=["']u-inner showArticle__contents["']/i)[0];
  const images = [
    ...new Set(
      [...hero.matchAll(/<img\b[^>]*src=["']([^"']+)["']/gi)]
        .map((m) => m[1].replace(/&amp;/g, '&'))
        .filter(
          (value) =>
            value.startsWith(`${ORIGIN}/rails/active_storage/representations/`) &&
            /\.(?:jpe?g|png|webp)$/i.test(value),
        ),
    ),
  ];
  const coords = article.match(/[?&](?:amp;)?q=(-?\d+\.\d+),(\d+\.\d+)/);
  return {
    venue_name: expectedVenue,
    address_text: address || null,
    lat: Number(coords?.[1]) || null,
    lng: Number(coords?.[2]) || null,
    image_urls: images,
    source_url: url,
  };
}
