import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lookup as lookupHost } from 'node:dns/promises';
import { isIP } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv, TextDecoder } from 'node:util';
import {
  applySourceOverride,
  currentYearInTokyo,
  loadSourcesConfig,
  normalizeCity,
  timeZoneForCity,
} from '../../../data/sources/source-config.mjs';
import { flattenTaxonomy } from '../../../data/categories.mjs';
import { buildCrawlQaReport } from './crawl-qa.mjs';
import { buildScheduleSegmentRows, upsertEventScheduleSegments } from './schedule-segments.mjs';
import { buildEventDedupeKey } from '../../../packages/shared/event-dedupe.mjs';
import {
  buildScheduleFields,
  classifyEventTiming,
  normalizeDateOnly,
  validateScheduleSegments,
} from '../../../packages/shared/event-schedule.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
const envPath = resolve(appRoot, '.env');
const crawl4AiFetchPath = resolve(__dirname, 'crawl4ai-fetch.py');
let crawl4AiDisabled = false;
let googleTranslationClientPromise = null;
let missingGoogleTranslateConfigWarningShown = false;
const domainFetchSchedule = new Map();
const robotsPolicyCache = new Map();
const supportedTranslationLocales = ['en', 'ja'];
const localizedEventFields = ['title', 'description'];
const missingDateCanMeanNoCurrentEventSources = new Set(['sibasi']);
const emptyDetailUrlsMeanNoCurrentEventSources = new Set([
  'curation-fair-kyoto',
  'curation-fair-tokyo',
]);

function applyEnvToProcess(env) {
  for (const [key, value] of Object.entries(env)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function getNumberArg(name, fallback) {
  const value = getArg(name);
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getEnvNumber(env, name, fallback) {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isPublicIpAddress(address) {
  const normalized = address.toLowerCase().split('%')[0];

  if (isIP(normalized) === 4) {
    const [a, b, c] = normalized.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }

  if (isIP(normalized) === 6) {
    const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    if (mappedIpv4) return isPublicIpAddress(mappedIpv4);

    return !(
      normalized.startsWith('::') ||
      /^f[cd]/.test(normalized) ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:')
    );
  }

  return false;
}

async function assertSafeRemoteUrl(value, lookup = lookupHost) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Blocked non-HTTP crawler URL: ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error('Blocked crawler URL with credentials');
  if (
    !hostname.includes('.') ||
    hostname === 'localhost' ||
    /\.(?:localhost|local|internal|home\.arpa)$/.test(hostname)
  ) {
    throw new Error(`Blocked private crawler hostname: ${hostname}`);
  }

  // ponytail: DNS is checked immediately before fetch; pin resolved addresses if sources become user-controlled.
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error(`Blocked non-public crawler address for ${hostname}`);
  }

  return url;
}

const redirectStatuses = new Set([301, 302, 303, 307, 308]);

async function fetchRemote(
  value,
  options = {},
  lookup = lookupHost,
  fetchImpl = fetch,
  onRedirect = null,
) {
  let url = await assertSafeRemoteUrl(value, lookup);

  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetchImpl(url, { ...options, redirect: 'manual' });
    const location = response.headers.get('location');
    if (!redirectStatuses.has(response.status) || !location) return response;
    if (redirects === 5) throw new Error(`Too many redirects for ${value}`);

    await response.body?.cancel().catch(() => {});
    url = await assertSafeRemoteUrl(new URL(location, url), lookup);
    await onRedirect?.(url);
  }

  throw new Error(`Too many redirects for ${value}`);
}

function getCrawl4AiRenderMode(env) {
  const value = getArg('render', env.CRAWL4AI_RENDER_MODE ?? 'auto').toLowerCase();
  return ['auto', 'always', 'never'].includes(value) ? value : 'auto';
}

function envFlag(env, name, fallback = true) {
  const value = env[name];
  if (value === undefined) return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function robotsPatternMatches(pattern, path) {
  const anchored = pattern.endsWith('$');
  const source = pattern
    .replace(/\$$/, '')
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*');
  return new RegExp(`^${source}${anchored ? '$' : ''}`).test(path);
}

function isUrlAllowedByRobotsText(robotsText, userAgent, value) {
  const groups = [];
  let agents = [];
  let rules = [];

  const flush = () => {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  };

  for (const rawLine of String(robotsText ?? '').split(/\r?\n/)) {
    if (!rawLine.trim()) {
      flush();
      continue;
    }
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const separatorIndex = line.indexOf(':');
    if (separatorIndex === -1) continue;
    const field = line.slice(0, separatorIndex).trim().toLowerCase();
    const entry = line.slice(separatorIndex + 1).trim();

    if (field === 'user-agent') {
      if (rules.length) flush();
      agents.push(entry.toLowerCase());
    } else if ((field === 'allow' || field === 'disallow') && agents.length) {
      if (entry || field === 'allow') rules.push({ type: field, pattern: entry });
    }
  }
  flush();

  const normalizedAgent = String(userAgent ?? '').toLowerCase();
  const matchingGroups = groups
    .map((group) => ({
      ...group,
      specificity: Math.max(
        ...group.agents.map((agent) =>
          agent === '*' ? 0 : normalizedAgent.includes(agent) ? agent.length : -1,
        ),
      ),
    }))
    .filter((group) => group.specificity >= 0);
  if (!matchingGroups.length) return true;

  const bestSpecificity = Math.max(...matchingGroups.map((group) => group.specificity));
  const path = `${new URL(value).pathname}${new URL(value).search}`;
  const matchingRules = matchingGroups
    .filter((group) => group.specificity === bestSpecificity)
    .flatMap((group) => group.rules)
    .filter((rule) => rule.pattern && robotsPatternMatches(rule.pattern, path))
    .sort((a, b) => b.pattern.length - a.pattern.length || (a.type === 'allow' ? -1 : 1));

  return matchingRules[0]?.type !== 'disallow';
}

function normalizeLocaleCode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'jp' || normalized.startsWith('ja')) return 'ja';
  if (normalized.startsWith('en')) return 'en';
  return null;
}

function getSourceLocale(source) {
  return normalizeLocaleCode(source?.language) ?? 'ja';
}

function getNativeLocales(source) {
  const configuredNativeLocales = Array.isArray(source?.capabilities?.native_locales)
    ? source.capabilities.native_locales.map(normalizeLocaleCode).filter(Boolean)
    : [];

  if (configuredNativeLocales.length) {
    return [...new Set(configuredNativeLocales)];
  }

  const localeConfigs = Object.entries(source?.locales ?? {})
    .filter(([, config]) => Array.isArray(config?.start_urls) && config.start_urls.some(Boolean))
    .map(([locale]) => normalizeLocaleCode(locale))
    .filter(Boolean);

  return [...new Set([getSourceLocale(source), ...localeConfigs])];
}

function sourceHasNativeLocale(source, locale) {
  const normalizedLocale = normalizeLocaleCode(locale);
  if (!normalizedLocale) return false;

  return getNativeLocales(source).includes(normalizedLocale);
}

function shouldMachineTranslateMissingLocales(source) {
  return source?.capabilities?.machine_translate_missing_locales !== false;
}

function getSourceRenderMode(source, fallbackRenderMode) {
  const hintMode = source?.crawl_hints?.render_mode;
  if (['auto', 'always', 'never'].includes(hintMode)) return hintMode;
  if (source?.crawl_hints?.requires_render === true) return 'always';
  return fallbackRenderMode;
}

function getSourceDetailLimit(source, fallbackLimit, hardLimit = 50) {
  const configuredLimit = Number(source?.crawl_hints?.max_detail_pages);
  const requestedLimit =
    Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : fallbackLimit;

  return Math.min(requestedLimit, hardLimit);
}

function sourceSkipsUrl(source, url) {
  const patterns = source?.crawl_hints?.skip_patterns;
  if (!Array.isArray(patterns) || !patterns.length) return false;

  return patterns.some((pattern) => {
    if (typeof pattern !== 'string' || !pattern.trim()) return false;
    const trimmedPattern = pattern.trim();

    try {
      const parsedUrl = new URL(url);
      return parsedUrl.href.includes(trimmedPattern) || parsedUrl.pathname.includes(trimmedPattern);
    } catch {
      return String(url ?? '').includes(trimmedPattern);
    }
  });
}

function getLocalizedSourceName(source, locale) {
  const normalizedLocale = normalizeLocaleCode(locale) ?? getSourceLocale(source);
  const names = source?.names && typeof source.names === 'object' ? source.names : {};
  const localizedName = names[normalizedLocale] ?? source?.[`name_${normalizedLocale}`] ?? null;

  return typeof localizedName === 'string' && localizedName.trim()
    ? localizedName.trim()
    : source?.name;
}

function withSourceLocaleConfig(source, locale) {
  const normalizedLocale = normalizeLocaleCode(locale) ?? getSourceLocale(source);
  const localeConfig = source?.locales?.[normalizedLocale] ?? null;

  if (!localeConfig) {
    return {
      ...source,
      language: normalizedLocale,
      name: getLocalizedSourceName(source, normalizedLocale),
    };
  }

  return {
    ...source,
    language: normalizedLocale,
    name: getLocalizedSourceName(source, normalizedLocale),
    start_urls: localeConfig.start_urls?.some(Boolean)
      ? localeConfig.start_urls
      : source.start_urls,
    event_page_patterns: localeConfig.event_page_patterns?.length
      ? localeConfig.event_page_patterns
      : source.event_page_patterns,
  };
}

function decodeHtml(value) {
  return String(value)
    .replace(
      /&(nbsp|amp|quot|apos|lt|gt|ndash|mdash|lsquo|rsquo|ldquo|rdquo|hellip);?/gi,
      (match, entity) => {
        const entities = {
          nbsp: ' ',
          amp: '&',
          quot: '"',
          apos: "'",
          lt: '<',
          gt: '>',
          ndash: '–',
          mdash: '—',
          lsquo: "'",
          rsquo: "'",
          ldquo: '"',
          rdquo: '"',
          hellip: '…',
        };
        return entities[entity.toLowerCase()] ?? match;
      },
    )
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#8211;', '–')
    .replaceAll('&#8217;', "'")
    .replaceAll('&#038;', '&')
    .replaceAll('&#8212;', '—')
    .replaceAll('&#8220;', '"')
    .replaceAll('&#8221;', '"')
    .replaceAll('&#8230;', '…')
    .replaceAll('&#039;', "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    })
    .replace(/&#(\d+);/g, (_, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    });
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLocationMatchText(value) {
  return decodeHtml(String(value ?? ''))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function getEventLocationMatchText(eventData) {
  return [
    eventData?.venue_name,
    eventData?.address_text,
    eventData?.directions_query,
    eventData?.source_url,
    eventData?.institution_name,
    eventData?.title,
  ]
    .map(normalizeLocationMatchText)
    .filter(Boolean)
    .join(' ');
}

function findVenueLocation(eventData, source) {
  const eventText = getEventLocationMatchText(eventData);
  if (!eventText) return null;

  for (const location of source?.venue_locations ?? []) {
    if (!location || typeof location !== 'object') continue;

    const lat = toFiniteNumber(location.lat);
    const lng = toFiniteNumber(location.lng);
    if (lat === null || lng === null) continue;

    const matchers = Array.isArray(location.match)
      ? location.match
      : [location.match ?? location.name];
    const hasMatch = matchers
      .map(normalizeLocationMatchText)
      .filter(Boolean)
      .some((matcher) => eventText.includes(matcher));

    if (hasMatch) {
      return {
        ...location,
        lat,
        lng,
        name:
          typeof location.name === 'string' && location.name.trim() ? location.name.trim() : null,
        address_text:
          typeof location.address_text === 'string' && location.address_text.trim()
            ? location.address_text.trim()
            : null,
        directions_query:
          typeof location.directions_query === 'string' && location.directions_query.trim()
            ? location.directions_query.trim()
            : null,
      };
    }
  }

  return null;
}

const explicitVenueCityPatterns = new Map([
  ['tokyo', /(?:\bTokyo\b|東京(?:都|市)?)/iu],
  ['kyoto', /(?:\bKyoto\b|京都(?:府|市)?)/iu],
  ['osaka', /(?:\bOsaka\b|大阪(?:府|市)?)/iu],
  ['hong-kong', /(?:\bHong Kong\b|香港)/iu],
  ['nagoya', /(?:\bNagoya\b|名古屋市?)/iu],
  ['kobe', /(?:\bKobe\b|神戸市?)/iu],
  ['yokohama', /(?:\bYokohama\b|横浜市?)/iu],
  ['nara', /(?:\bNara\b|奈良市?)/iu],
]);

function hasExplicitVenueCityMismatch(eventData, source) {
  const sourceCity = String(source?.city ?? '')
    .trim()
    .toLowerCase();
  if (!explicitVenueCityPatterns.has(sourceCity)) return false;

  const scrapedLocationText = [
    eventData?.venue_name,
    eventData?.address_text,
    eventData?.directions_query,
  ]
    .filter((value) => typeof value === 'string' && value.trim())
    .join('\n');
  const detectedCities = new Set(
    [...explicitVenueCityPatterns]
      .filter(([, pattern]) => pattern.test(scrapedLocationText))
      .map(([city]) => city),
  );

  return detectedCities.size > 0 && !detectedCities.has(sourceCity);
}

function getSourceTruthSkipReason(eventData) {
  return eventData?._source_truth_warnings?.includes('venue_city_mismatch')
    ? 'venue_city_mismatch'
    : null;
}

function normalizeEventSourceTruth(eventData, source) {
  const sourceTruthWarnings = new Set(eventData?._source_truth_warnings ?? []);
  if (hasExplicitVenueCityMismatch(eventData, source)) {
    sourceTruthWarnings.add('venue_city_mismatch');
  }
  const venueLocation = findVenueLocation(eventData, source);
  const sourceLat = toFiniteNumber(source?.lat);
  const sourceLng = toFiniteNumber(source?.lng);
  const lat = venueLocation?.lat ?? sourceLat;
  const lng = venueLocation?.lng ?? sourceLng;
  const sourceAddress =
    typeof source?.address_text === 'string' && source.address_text.trim()
      ? source.address_text.trim()
      : null;
  const venueName = venueLocation?.name ?? source?.name;
  const addressText = venueLocation?.address_text ?? sourceAddress ?? source?.name;
  const directionsQuery =
    venueLocation?.directions_query ?? source?.directions_query ?? addressText ?? source?.name;

  return {
    ...eventData,
    institution_name: source?.name ?? eventData.institution_name,
    venue_name: venueName ?? eventData.venue_name ?? null,
    address_text: addressText ?? eventData.address_text ?? null,
    directions_query: directionsQuery ?? eventData.directions_query ?? null,
    categories: flattenTaxonomy(source?.taxonomy),
    lat: lat ?? null,
    lng: lng ?? null,
    ...(sourceTruthWarnings.size ? { _source_truth_warnings: [...sourceTruthWarnings] } : {}),
  };
}

function assignEventCoordinates(eventData, source) {
  return normalizeEventSourceTruth(eventData, source);
}

function stripTags(value) {
  const decoded = decodeHtml(value);

  return decodeHtml(
    decoded
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim(),
  );
}

function sanitizePostgresText(value) {
  return typeof value === 'string' ? value.replace(/\u0000/g, '') : value;
}

function sanitizePostgresJson(value) {
  if (typeof value === 'string') return sanitizePostgresText(value);
  if (Array.isArray(value)) return value.map(sanitizePostgresJson);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, currentValue]) => [key, sanitizePostgresJson(currentValue)]),
  );
}

function extractMeta(html, property) {
  const expected = String(property ?? '').toLowerCase();

  for (const match of String(html ?? '').matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const key = String(attributes.property ?? attributes.name ?? '').toLowerCase();
    if (key === expected) return attributes.content ?? null;
  }

  return null;
}

function extractTagAttribute(tag, attributeName) {
  const pattern = new RegExp(`${attributeName}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tag.match(pattern);
  return match?.[2] ?? match?.[3] ?? match?.[4] ?? null;
}

function selectorsFor(source, key) {
  const selector = source?.selectors?.[key];
  if (Array.isArray(selector)) return selector.filter(Boolean);
  return typeof selector === 'string' && selector.trim() ? [selector.trim()] : [];
}

function parseSimpleSelector(selector) {
  const trimmed = String(selector ?? '').trim();
  const attributePattern =
    /\[\s*([a-z0-9_:-]+)\s*(?:(\*|\^|\$)?=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/gi;
  const attributes = [...trimmed.matchAll(attributePattern)].map((match) => {
    const hasValue = match[3] !== undefined || match[4] !== undefined || match[5] !== undefined;

    return {
      name: match[1],
      operator: match[2] ? `${match[2]}=` : hasValue ? '=' : null,
      value: match[3] ?? match[4] ?? match[5] ?? null,
    };
  });
  const selectorWithoutAttributes = trimmed.replace(attributePattern, '');
  const tag = selectorWithoutAttributes.match(/^[a-z][a-z0-9-]*/i)?.[0]?.toLowerCase() ?? null;
  const id = selectorWithoutAttributes.match(/#([a-z0-9_-]+)/i)?.[1] ?? null;
  const classes = [...selectorWithoutAttributes.matchAll(/\.([a-z0-9_-]+)/gi)].map(
    (match) => match[1],
  );

  if (!tag && !id && !classes.length && !attributes.length) return null;

  return { tag, id, classes, attributes };
}

function tagMatchesSimpleSelector(tagName, attrs, selector) {
  const parsed = parseSimpleSelector(selector);
  if (!parsed) return false;
  if (parsed.tag && tagName.toLowerCase() !== parsed.tag) return false;

  if (parsed.id) {
    const id = extractTagAttribute(attrs, 'id');
    if (id !== parsed.id) return false;
  }

  if (parsed.classes.length) {
    const className = extractTagAttribute(attrs, 'class') ?? '';
    const classes = new Set(className.split(/\s+/).filter(Boolean));
    if (!parsed.classes.every((item) => classes.has(item))) return false;
  }

  for (const attribute of parsed.attributes) {
    const value = extractTagAttribute(attrs, attribute.name);
    if (value === null) return false;
    if (!attribute.operator) continue;
    if (attribute.operator === '=' && value !== attribute.value) return false;
    if (attribute.operator === '*=' && !value.includes(attribute.value)) return false;
    if (attribute.operator === '^=' && !value.startsWith(attribute.value)) return false;
    if (attribute.operator === '$=' && !value.endsWith(attribute.value)) return false;
  }

  return true;
}

function selectSimpleElements(html, selector) {
  const parsed = parseSimpleSelector(selector);
  if (!parsed) return [];

  const elements = [];
  const openTagPattern = /<([a-z][a-z0-9:-]*)\b([^>]*)>/gi;

  for (const match of html.matchAll(openTagPattern)) {
    const [openTag, tagName, attrs] = match;
    if (!tagMatchesSimpleSelector(tagName, attrs, selector)) continue;

    const lowerTagName = tagName.toLowerCase();
    if (
      [
        'area',
        'base',
        'br',
        'col',
        'embed',
        'hr',
        'img',
        'input',
        'link',
        'meta',
        'source',
        'track',
        'wbr',
      ].includes(lowerTagName)
    ) {
      elements.push(openTag);
      continue;
    }

    const closePattern = new RegExp(`</${lowerTagName}\\s*>`, 'i');
    const rest = html.slice(match.index + openTag.length);
    const closeMatch = rest.match(closePattern);
    if (!closeMatch || closeMatch.index === undefined) {
      elements.push(openTag);
      continue;
    }

    elements.push(openTag + rest.slice(0, closeMatch.index + closeMatch[0].length));
  }

  return elements;
}

function selectElements(html, selector) {
  const selectorGroups = String(selector ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const results = [];

  for (const selectorGroup of selectorGroups) {
    const parts = selectorGroup.split(/\s+/).filter(Boolean);
    let fragments = [html];

    for (const part of parts) {
      fragments = fragments.flatMap((fragment) => selectSimpleElements(fragment, part));
      if (!fragments.length) break;
    }

    results.push(...fragments);
  }

  return results;
}

function selectorTextValues(html, selectors) {
  return selectors
    .flatMap((selector) => selectElements(html, selector))
    .map(stripTags)
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function selectorAttributeValues(html, selectors, attributeNames) {
  return selectors.flatMap((selector) =>
    selectElements(html, selector)
      .flatMap((element) => {
        const values = attributeNames
          .map((attributeName) => extractTagAttribute(element, attributeName))
          .filter(Boolean);

        if (values.length) return values;

        return [...element.matchAll(/<img\b[^>]*>/gi)].flatMap((match) =>
          attributeNames
            .map((attributeName) => extractTagAttribute(match[0], attributeName))
            .filter(Boolean),
        );
      })
      .filter(Boolean),
  );
}

function canonicalizeUrlWithoutHash(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString();
  } catch {
    return String(url ?? '').replace(/#.*$/, '');
  }
}

function detailPageCacheKey(url) {
  return canonicalizeUrlWithoutHash(url);
}

function canonicalizeComparableUrl(url) {
  const canonical = canonicalizeUrlWithoutHash(url);
  try {
    const parsed = new URL(canonical);
    parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return parsed.toString();
  } catch {
    return canonical.replace(/\/+$/, '');
  }
}

function resolveHref(href, baseUrl) {
  if (!href || /^(mailto|tel|javascript):/i.test(href)) return null;

  try {
    return canonicalizeUrlWithoutHash(new URL(decodeHtml(href), baseUrl).toString());
  } catch {
    return null;
  }
}

function detectLocaleFromLink({ tag = '', href = '', text = '' }) {
  const hreflang = normalizeLocaleCode(extractTagAttribute(tag, 'hreflang'));
  if (hreflang) return hreflang;

  const lang = normalizeLocaleCode(extractTagAttribute(tag, 'lang'));
  if (lang) return lang;

  const combined = `${extractTagAttribute(tag, 'aria-label') ?? ''} ${
    extractTagAttribute(tag, 'title') ?? ''
  } ${stripTags(text)}`.trim();

  if (/(^|\b)(english|eng|en)(\b|$)/i.test(combined)) return 'en';
  if (/(日本語|Japanese|(^|\b)(ja|jp)(\b|$))/i.test(combined)) return 'ja';

  try {
    const parsed = new URL(href);
    const pathParts = parsed.pathname
      .split('/')
      .map((part) => part.toLowerCase())
      .filter(Boolean);
    if (pathParts.some((part) => ['en', 'eng', 'english'].includes(part))) {
      return 'en';
    }
    if (pathParts.some((part) => ['ja', 'jp', 'jpn', 'japanese'].includes(part))) {
      return 'ja';
    }
    const langParam = normalizeLocaleCode(
      parsed.searchParams.get('lang') ??
        parsed.searchParams.get('locale') ??
        parsed.searchParams.get('language'),
    );
    if (langParam) return langParam;
  } catch {
    return null;
  }

  return null;
}

function extractLocaleUrlsFromHtml(html, pageUrl) {
  const localeUrls = {};

  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const rel = extractTagAttribute(tag, 'rel') ?? '';
    if (!/\balternate\b/i.test(rel)) continue;

    const href = resolveHref(extractTagAttribute(tag, 'href'), pageUrl);
    if (!href) continue;

    const locale = detectLocaleFromLink({ tag, href });
    if (locale && href !== canonicalizeUrlWithoutHash(pageUrl)) {
      localeUrls[locale] ??= href;
    }
  }

  for (const match of html.matchAll(
    /<a\b[^>]*href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)[^>]*>[\s\S]*?<\/a>/gi,
  )) {
    const anchorHtml = match[0];
    const tag = anchorHtml.match(/^<a\b[^>]*>/i)?.[0] ?? '';
    const href = resolveHref(extractTagAttribute(tag, 'href'), pageUrl);
    if (!href || href === canonicalizeUrlWithoutHash(pageUrl)) continue;

    const locale = detectLocaleFromLink({
      tag,
      href,
      text: anchorHtml.replace(/^<a\b[^>]*>|<\/a>$/gi, ''),
    });
    if (locale) localeUrls[locale] ??= href;
  }

  return localeUrls;
}

function inferAlternateLocaleUrlFromConfig(detailUrl, source, sourceLocale, targetLocale) {
  const sourceConfig = source?.locales?.[sourceLocale];
  const targetConfig = source?.locales?.[targetLocale];
  const sourceStartUrls = sourceConfig?.start_urls?.filter(Boolean) ?? [];
  const targetStartUrls = targetConfig?.start_urls?.filter(Boolean) ?? [];

  if (!sourceStartUrls.length || !targetStartUrls.length) return null;

  const detail = new URL(detailUrl);

  for (const sourceStartUrl of sourceStartUrls) {
    for (const targetStartUrl of targetStartUrls) {
      try {
        const sourceStart = new URL(sourceStartUrl);
        const targetStart = new URL(targetStartUrl);

        if (detail.hostname !== sourceStart.hostname) continue;
        if (sourceStart.hostname !== targetStart.hostname) continue;

        const sourcePath = sourceStart.pathname.replace(/\/+$/, '/') || '/';
        const targetPath = targetStart.pathname.replace(/\/+$/, '/') || '/';

        if (!detail.pathname.startsWith(sourcePath)) continue;

        const inferred = new URL(detail.toString());
        inferred.hostname = targetStart.hostname;
        inferred.pathname = `${targetPath}${detail.pathname.slice(sourcePath.length)}`.replace(
          /\/{2,}/g,
          '/',
        );
        return canonicalizeUrlWithoutHash(inferred.toString());
      } catch {
        continue;
      }
    }
  }

  return null;
}

function getUrlPathParts(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean);
  } catch {
    return [];
  }
}

function isUsableNativeLocaleUrl(detailUrl, alternateUrl, source = null) {
  if (!alternateUrl || alternateUrl === canonicalizeUrlWithoutHash(detailUrl)) {
    return false;
  }

  if (source?.allowed_domains?.length) {
    if (!sourceAllowsUrl(source, alternateUrl)) return false;
  } else {
    try {
      if (new URL(detailUrl).hostname !== new URL(alternateUrl).hostname) return false;
    } catch {
      return false;
    }
  }

  const detailParts = getUrlPathParts(detailUrl);
  const alternateParts = getUrlPathParts(alternateUrl);

  if (detailParts.length > 1 && alternateParts.length <= 1) {
    return false;
  }

  return true;
}

function nativeLocaleEventMatchesCanonical(canonicalEvent, nativeEvent) {
  for (const field of ['start_date', 'end_date']) {
    if (canonicalEvent?.[field] && canonicalEvent[field] !== nativeEvent?.[field]) {
      return false;
    }
  }

  return true;
}

function extractSectionValue(html, dtText) {
  const escaped = dtText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<dt>${escaped}</dt>\\s*<dd>([\\s\\S]*?)</dd>`, 'i');
  const match = html.match(pattern)?.[1];
  return match ? stripTags(match) : null;
}

const ENGLISH_MONTHS = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const ENGLISH_MONTH_PATTERN = Object.keys(ENGLISH_MONTHS).join('|');

function normalizeHumanDateText(value) {
  return decodeHtml(String(value ?? ''))
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/令和(元|\d+)年/gu, (_, year) => `${2018 + (year === '元' ? 1 : Number(year))}年`)
    .replace(/[‐‑‒–—―−－〜～~]/g, '-')
    .replace(
      /\s*[（(](?:(?:月|火|水|木|金|土|日)(?:曜日)?|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\.?[）)]/giu,
      ' ',
    )
    .replace(
      /\s*\[(?:(?:月|火|水|木|金|土|日)(?:曜日)?|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\.?\]/giu,
      ' ',
    )
    .replace(
      /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\.?,?\s*/giu,
      '',
    )
    .replace(/\b(jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\./giu, '$1')
    .replace(/\s+to\s+/giu, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

function isValidDateParts(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  );
}

function buildParsedDateRange(startYear, startMonth, startDay, endYear, endMonth, endDay) {
  const sy = Number(startYear);
  const sm = Number(startMonth);
  const sd = Number(startDay);
  let ey = Number(endYear ?? startYear);
  const em = Number(endMonth ?? startMonth);
  const ed = Number(endDay ?? startDay);

  if (endYear == null && em * 100 + ed < sm * 100 + sd) ey += 1;
  if (!isValidDateParts(sy, sm, sd) || !isValidDateParts(ey, em, ed)) return null;

  const startDate = toDateOnly(sy, sm, sd);
  const endDate = toDateOnly(ey, em, ed);
  if (endDate < startDate) return null;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T00:00:00+09:00`,
    calendarEndsAt: `${endDate}T23:59:00+09:00`,
  };
}

function parseBilingualDateRange(dateText) {
  const text = normalizeHumanDateText(dateText);
  let match = text.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日[^\d]{0,30}?-\s*(?:(\d{4})年)?\s*(\d{1,2})月(\d{1,2})日/u,
  );
  if (match)
    return buildParsedDateRange(match[1], match[2], match[3], match[4], match[5], match[6]);

  match = text.match(
    /(\d{4})[./-](\d{1,2})[./-](\d{1,2})[^\d]{0,20}?-\s*(?:(\d{4})[./-])?(\d{1,2})[./-](\d{1,2})/u,
  );
  if (match)
    return buildParsedDateRange(match[1], match[2], match[3], match[4], match[5], match[6]);

  match = text.match(
    new RegExp(
      `(${ENGLISH_MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\s*-\\s*(${ENGLISH_MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?`,
      'iu',
    ),
  );
  if (match && (match[3] || match[6])) {
    const startYear = match[3] ?? match[6];
    const endYear =
      match[6] ??
      (ENGLISH_MONTHS[match[4].toLowerCase()] < ENGLISH_MONTHS[match[1].toLowerCase()]
        ? Number(startYear) + 1
        : startYear);
    return buildParsedDateRange(
      startYear,
      ENGLISH_MONTHS[match[1].toLowerCase()],
      match[2],
      endYear,
      ENGLISH_MONTHS[match[4].toLowerCase()],
      match[5],
    );
  }

  match = text.match(
    new RegExp(
      `(\\d{1,2})\\s+(${ENGLISH_MONTH_PATTERN})\\.?(?:,?\\s+(\\d{4}))?\\s*-\\s*(\\d{1,2})\\s+(${ENGLISH_MONTH_PATTERN})\\.?(?:,?\\s+(\\d{4}))?`,
      'iu',
    ),
  );
  if (match && (match[3] || match[6])) {
    const startYear = match[3] ?? match[6];
    const endYear =
      match[6] ??
      (ENGLISH_MONTHS[match[5].toLowerCase()] < ENGLISH_MONTHS[match[2].toLowerCase()]
        ? Number(startYear) + 1
        : startYear);
    return buildParsedDateRange(
      startYear,
      ENGLISH_MONTHS[match[2].toLowerCase()],
      match[1],
      endYear,
      ENGLISH_MONTHS[match[5].toLowerCase()],
      match[4],
    );
  }

  match = text.match(
    new RegExp(
      `(\\d{1,2})\\s*-\\s*(\\d{1,2})\\s+(${ENGLISH_MONTH_PATTERN})\\.?[,]?\\s+(\\d{4})`,
      'iu',
    ),
  );
  if (match) {
    const month = ENGLISH_MONTHS[match[3].toLowerCase()];
    return buildParsedDateRange(match[4], month, match[1], match[4], month, match[2]);
  }

  match = text.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/u);
  if (match) return buildParsedDateRange(match[1], match[2], match[3]);

  match = text.match(/(\d{4})[./-](\d{1,2})[./-](\d{1,2})/u);
  if (match) return buildParsedDateRange(match[1], match[2], match[3]);

  match = text.match(
    new RegExp(`(${ENGLISH_MONTH_PATTERN})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'iu'),
  );
  if (match)
    return buildParsedDateRange(match[3], ENGLISH_MONTHS[match[1].toLowerCase()], match[2]);

  match = text.match(
    new RegExp(`(\\d{1,2})\\s+(${ENGLISH_MONTH_PATTERN})\\.?[,]?\\s+(\\d{4})`, 'iu'),
  );
  if (match)
    return buildParsedDateRange(match[3], ENGLISH_MONTHS[match[2].toLowerCase()], match[1]);

  return null;
}

function parseJapaneseDateRange(dateText) {
  dateText = normalizeHumanDateText(dateText);
  const pattern = /(\d{4})年(\d{1,2})月(\d{1,2})日.*?-\s*(?:(\d{4})年)?\s*(\d{1,2})月(\d{1,2})日/u;
  const match = dateText.match(pattern);

  if (!match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, sy, sm, sd, maybeEndYear, em, ed] = match;
  const ey = maybeEndYear ?? sy;
  const startDate = `${sy}-${sm.padStart(2, '0')}-${sd.padStart(2, '0')}`;
  const endDate = `${ey}-${em.padStart(2, '0')}-${ed.padStart(2, '0')}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T00:00:00+09:00`,
    calendarEndsAt: `${endDate}T23:59:00+09:00`,
  };
}

function parseJapaneseSingleDate(dateText) {
  dateText = normalizeHumanDateText(dateText);
  const match = dateText.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/u);

  if (!match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, year, month, day] = match;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

  return {
    startDate: date,
    endDate: date,
    calendarStartsAt: `${date}T00:00:00+09:00`,
    calendarEndsAt: `${date}T23:59:00+09:00`,
  };
}

function parseKyoceraDateRange(dateText) {
  const normalized = decodeHtml(dateText)
    .replace(/\s+/g, '')
    .replace(/[‐‑‒–—―〜～]/g, '-');
  const japaneseRange = normalized.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日-(\d{4})年(\d{1,2})月(\d{1,2})日/u,
  );
  const slashRange = normalized.match(
    /(\d{4})\/(\d{1,2})\/(\d{1,2})-(\d{4})\/(\d{1,2})\/(\d{1,2})/,
  );
  const match = japaneseRange ?? slashRange;

  if (!match) {
    return parseSlashDateRange(dateText);
  }

  const [, sy, sm, sd, ey, em, ed] = match;
  const startDate = `${sy}-${sm.padStart(2, '0')}-${sd.padStart(2, '0')}`;
  const endDate = `${ey}-${em.padStart(2, '0')}-${ed.padStart(2, '0')}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:00:00+09:00`,
    calendarEndsAt: `${endDate}T18:00:00+09:00`,
  };
}

function parseSlashDateRange(dateText) {
  const pattern = /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[-–—]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/;
  const match = dateText.match(pattern);

  if (!match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, sy, sm, sd, ey, em, ed] = match;
  const startDate = `${sy}-${sm.padStart(2, '0')}-${sd.padStart(2, '0')}`;
  const endDate = `${ey}-${em.padStart(2, '0')}-${ed.padStart(2, '0')}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:00:00+09:00`,
    calendarEndsAt: `${endDate}T18:00:00+09:00`,
  };
}

function parseSlashSingleDate(dateText) {
  const match = dateText.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);

  if (!match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, year, month, day] = match;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;

  return {
    startDate: date,
    endDate: date,
    calendarStartsAt: `${date}T10:00:00+09:00`,
    calendarEndsAt: `${date}T18:00:00+09:00`,
  };
}

function parseMomakDateRange(dateText) {
  const pattern =
    /(\d{4})\.(\d{2})\.(\d{2})\s*[a-z]{3}\.\s*-\s*(?:(\d{4})\.)?(\d{2})\.(\d{2})\s*[a-z]{3}\./i;
  const match = dateText.match(pattern);

  if (!match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, sy, sm, sd, explicitEy, em, ed] = match;
  const parsed = buildParsedDateRange(sy, sm, sd, explicitEy, em, ed);

  if (!parsed) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  return {
    ...parsed,
    calendarStartsAt: `${parsed.startDate}T10:00:00+09:00`,
    calendarEndsAt: `${parsed.endDate}T18:00:00+09:00`,
  };
}

function parseDottedDateRange(dateText) {
  const pattern =
    /(\d{4})\.(\d{1,2})\.(\d{1,2})(?:.*?[～〜\-－–—]\s*(?:(\d{4})\.)?(\d{1,2})\.(\d{1,2}))?/u;
  const match = dateText.match(pattern);

  if (!match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, sy, sm, sd, explicitEy, em, ed] = match;
  const startDate = `${sy}-${sm.padStart(2, '0')}-${sd.padStart(2, '0')}`;
  const endDate =
    em && ed ? `${explicitEy ?? sy}-${em.padStart(2, '0')}-${ed.padStart(2, '0')}` : startDate;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:00:00+09:00`,
    calendarEndsAt: `${endDate}T18:00:00+09:00`,
  };
}

function parseEnglishMonthDateRange(dateText) {
  const months = {
    january: '01',
    jan: '01',
    february: '02',
    feb: '02',
    march: '03',
    mar: '03',
    april: '04',
    apr: '04',
    may: '05',
    june: '06',
    jun: '06',
    july: '07',
    jul: '07',
    august: '08',
    aug: '08',
    september: '09',
    sep: '09',
    sept: '09',
    october: '10',
    oct: '10',
    november: '11',
    nov: '11',
    december: '12',
    dec: '12',
  };

  const cleaned = decodeHtml(dateText)
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const match = cleaned.match(
    /([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/,
  );

  if (!match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, startMonthName, startDay, endMonthName, endDay, year] = match;
  const startMonth = months[startMonthName.toLowerCase()];
  const endMonth = months[endMonthName.toLowerCase()];

  if (!startMonth || !endMonth) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const startDate = `${year}-${startMonth}-${String(startDay).padStart(2, '0')}`;
  const endDate = `${year}-${endMonth}-${String(endDay).padStart(2, '0')}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T09:00:00+09:00`,
    calendarEndsAt: `${endDate}T17:30:00+09:00`,
  };
}

function parseEnglishMonthDateRangeWithOptionalStartYear(dateText) {
  const months = {
    january: '01',
    jan: '01',
    february: '02',
    feb: '02',
    march: '03',
    mar: '03',
    april: '04',
    apr: '04',
    may: '05',
    june: '06',
    jun: '06',
    july: '07',
    jul: '07',
    august: '08',
    aug: '08',
    september: '09',
    sep: '09',
    sept: '09',
    october: '10',
    oct: '10',
    november: '11',
    nov: '11',
    december: '12',
    dec: '12',
  };

  const cleaned = dateText
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const match = cleaned.match(
    /([A-Za-z]+)\s+(\d{1,2})(?:\s*,\s*(\d{4}))?\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2})\s*,\s*(\d{4})/,
  );

  if (!match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, startMonthName, startDay, maybeStartYear, endMonthName, endDay, endYear] = match;
  const startMonth = months[startMonthName.toLowerCase()];
  const endMonth = months[endMonthName.toLowerCase()];
  const startYear = maybeStartYear ?? endYear;

  if (!startMonth || !endMonth) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const startDate = `${startYear}-${startMonth}-${String(startDay).padStart(2, '0')}`;
  const endDate = `${endYear}-${endMonth}-${String(endDay).padStart(2, '0')}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T11:00:00+09:00`,
    calendarEndsAt: `${endDate}T19:00:00+09:00`,
  };
}

function parseEnglishMonthDateRangeWithWeekdays(dateText) {
  const cleaned = dateText
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return parseEnglishMonthDateRange(cleaned);
}

function parseEnglishDayMonthYearRange(dateText) {
  const months = {
    january: '01',
    february: '02',
    march: '03',
    april: '04',
    may: '05',
    june: '06',
    july: '07',
    august: '08',
    september: '09',
    october: '10',
    november: '11',
    december: '12',
  };

  const cleaned = dateText
    .replace(/\([^)]*\)/g, '')
    .replace(
      /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?,?\s+/gi,
      '',
    )
    .replace(/&#8211;|–|—/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const match = cleaned.match(
    /(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?\s*-\s*(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})/,
  );

  if (!match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, startDay, startMonthName, maybeStartYear, endDay, endMonthName, endYear] = match;
  const startMonth = months[startMonthName.toLowerCase()];
  const endMonth = months[endMonthName.toLowerCase()];
  const startYear = maybeStartYear ?? endYear;

  if (!startMonth || !endMonth) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const startDate = `${startYear}-${startMonth}-${String(startDay).padStart(2, '0')}`;
  const endDate = `${endYear}-${endMonth}-${String(endDay).padStart(2, '0')}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:30:00+09:00`,
    calendarEndsAt: `${endDate}T18:00:00+09:00`,
  };
}

function parseEnglishSingleDate(dateText) {
  const months = {
    january: '01',
    jan: '01',
    february: '02',
    feb: '02',
    march: '03',
    mar: '03',
    april: '04',
    apr: '04',
    may: '05',
    june: '06',
    jun: '06',
    july: '07',
    jul: '07',
    august: '08',
    aug: '08',
    september: '09',
    sep: '09',
    sept: '09',
    october: '10',
    oct: '10',
    november: '11',
    nov: '11',
    december: '12',
    dec: '12',
  };

  const cleaned = decodeHtml(dateText)
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const monthDayYear = cleaned.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (monthDayYear) {
    const [, monthName, day, year] = monthDayYear;
    const month = months[monthName.toLowerCase()];

    if (!month) {
      return {
        startDate: null,
        endDate: null,
        calendarStartsAt: null,
        calendarEndsAt: null,
      };
    }

    const date = `${year}-${month}-${String(day).padStart(2, '0')}`;
    return {
      startDate: date,
      endDate: date,
      calendarStartsAt: `${date}T10:00:00+09:00`,
      calendarEndsAt: `${date}T18:00:00+09:00`,
    };
  }

  const dayMonthYear = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (dayMonthYear) {
    const [, day, monthName, year] = dayMonthYear;
    const month = months[monthName.toLowerCase()];

    if (!month) {
      return {
        startDate: null,
        endDate: null,
        calendarStartsAt: null,
        calendarEndsAt: null,
      };
    }

    const date = `${year}-${month}-${String(day).padStart(2, '0')}`;
    return {
      startDate: date,
      endDate: date,
      calendarStartsAt: `${date}T10:00:00+09:00`,
      calendarEndsAt: `${date}T18:00:00+09:00`,
    };
  }

  return {
    startDate: null,
    endDate: null,
    calendarStartsAt: null,
    calendarEndsAt: null,
  };
}

function toDateInTimeZone(value, timeZone = 'Asia/Tokyo') {
  return new Intl.DateTimeFormat('sv-SE', { timeZone }).format(value);
}

function toJapanDate(value) {
  return toDateInTimeZone(value);
}

function shiftDateOnlyByYears(dateOnly, deltaYears) {
  const normalized = normalizeDateOnly(dateOnly);
  if (!normalized) return null;

  const utcDate = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(utcDate.getTime())) return null;

  utcDate.setUTCFullYear(utcDate.getUTCFullYear() + deltaYears);
  return utcDate.toISOString().slice(0, 10);
}

function getLatestEventDateOnly(event) {
  const candidates = [
    normalizeDateOnly(event?.end_date ?? event?.calendar_ends_at),
    normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at),
    ...(Array.isArray(event?.occurrence_dates)
      ? event.occurrence_dates.map((value) => normalizeDateOnly(value))
      : []),
  ].filter(Boolean);

  if (!candidates.length) return null;
  return [...candidates].sort().at(-1) ?? null;
}

function hasVerifiedOpenEndedSchedule(event) {
  const schedule = validateScheduleSegments(event);
  return schedule.valid && schedule.schedule_type === 'open_ended';
}

function hasVerifiedEventDate(event) {
  if (normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at)) return true;
  return (
    Array.isArray(event?.occurrence_dates) &&
    event.occurrence_dates.some((value) => normalizeDateOnly(value))
  );
}

function normalizeEventDatePrecision(event) {
  return event?.is_all_day === false
    ? event
    : {
        ...event,
        calendar_starts_at: null,
        calendar_ends_at: null,
      };
}

function dateExtractionOrigin(detailHtml, source, event, usedGenericExtractor) {
  const configuredDate = selectorTextValues(detailHtml, selectorsFor(source, 'date'))[0];
  if (
    configuredDate &&
    normalizeHumanDateText(configuredDate) === normalizeHumanDateText(event?.date_text)
  ) {
    return 'configured_selector';
  }

  const eventStart = normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at);
  if (
    eventStart &&
    extractJsonLdDateText(detailHtml, event?.source_url).some(
      (value) => parseGenericDateRange(value).startDate === eventStart,
    )
  ) {
    return 'json_ld';
  }

  if (
    eventStart &&
    selectElements(detailHtml, 'time').some((element) => {
      const value = extractTagAttribute(element, 'datetime') ?? stripTags(element);
      return parseGenericDateRange(value).startDate === eventStart;
    })
  ) {
    return 'time_element';
  }

  if (!usedGenericExtractor) return 'source_specific_extractor';

  const matchesStart = (value) =>
    eventStart && parseGenericDateRange(value ?? '').startDate === eventStart;
  const semanticDateElements = selectElements(
    detailHtml,
    '[class*=date], [id*=date], [class*=period], [id*=period], [class*=schedule], [id*=schedule]',
  );
  if (semanticDateElements.some((element) => matchesStart(stripTags(element)))) {
    return 'semantic_element';
  }
  if (
    ['og:description', 'description', 'og:title'].some((name) =>
      matchesStart(extractMeta(detailHtml, name)),
    )
  ) {
    return 'metadata';
  }
  if (selectorTextValues(detailHtml, ['main', 'article']).some(matchesStart)) {
    return 'article_content';
  }

  return 'page_fallback';
}

function recordDateExtraction(diagnostics, detailHtml, source, event, usedGenericExtractor) {
  if (!diagnostics || diagnostics.date_extractions.length >= 20) return;

  const parsed = parseGenericDateRange(event?.date_text ?? '');
  const startDate = normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at);
  diagnostics.date_extractions.push({
    url: event?.source_url ?? null,
    raw: String(event?.date_text ?? '').slice(0, 300),
    normalized: normalizeHumanDateText(event?.date_text).slice(0, 300),
    origin:
      event?._date_origin ?? dateExtractionOrigin(detailHtml, source, event, usedGenericExtractor),
    parser: event?._date_parser ?? parsed.parserId ?? (startDate ? 'source_specific' : null),
    inferred_year: Boolean(
      startDate && !String(event?.date_text ?? '').includes(startDate.slice(0, 4)),
    ),
    start_date: startDate,
    end_date: normalizeDateOnly(event?.end_date ?? event?.calendar_ends_at),
  });
}

function getLatestEventYearHint(event, detailUrl) {
  const haystacks = [
    typeof event?.date_text === 'string' ? event.date_text : '',
    typeof detailUrl === 'string' ? detailUrl : '',
  ];

  const years = haystacks
    .flatMap((value) =>
      [...decodeHtml(value).matchAll(/(?:^|[^\d])(20\d{2})(?!\d)/g)].map((match) =>
        Number(match[1]),
      ),
    )
    .filter((value) => Number.isFinite(value));

  if (!years.length) return null;
  return Math.max(...years);
}

function extractYearFromUrl(url) {
  const match = url.match(/\/(20\d{2})\//);
  return match ? match[1] : null;
}

function toDateOnly(year, month, day) {
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseSibasiDateRange(text, detailUrl) {
  const inferredYear = extractYearFromUrl(detailUrl);

  const explicitRange = text.match(
    /(?:日時|日程|会期)[：:\s]*((\d{4})年(\d{1,2})月(\d{1,2})日[^。\n]{0,40}?[〜～\-－]\s*(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日)/u,
  );
  if (explicitRange) {
    const [, matchedText, startYear, startMonth, startDay, endYear, endMonth, endDay] =
      explicitRange;
    return {
      dateText: matchedText.trim(),
      startDate: toDateOnly(startYear, startMonth, startDay),
      endDate: toDateOnly(endYear ?? startYear, endMonth, endDay),
    };
  }

  const shortRange = text.match(
    /(?:日時|日程|会期|を)\s*[：:\s]*?(\d{1,2})\/(\d{1,2})\s*[〜～\-－]\s*(?:(\d{1,2})\/)?(\d{1,2})/u,
  );
  if (shortRange && inferredYear) {
    const [, startMonth, startDay, maybeEndMonth, endDay] = shortRange;
    const endMonth = maybeEndMonth ?? startMonth;
    return {
      dateText: shortRange[0].replace(/^(?:日時|日程|会期|を)\s*[：:\s]*/u, '').trim(),
      startDate: toDateOnly(inferredYear, startMonth, startDay),
      endDate: toDateOnly(inferredYear, endMonth, endDay),
    };
  }

  const explicitSingle = text.match(/(?:日時|日程|会期)[：:\s]*((\d{4})年(\d{1,2})月(\d{1,2})日)/u);
  if (explicitSingle) {
    const [, matchedText, year, month, day] = explicitSingle;
    return {
      dateText: matchedText.trim(),
      startDate: toDateOnly(year, month, day),
      endDate: toDateOnly(year, month, day),
    };
  }

  const shortSingle = text.match(/(?:日時|日程|会期)[：:\s]*((\d{1,2})月(\d{1,2})日)/u);
  if (shortSingle && inferredYear) {
    const [, matchedText, month, day] = shortSingle;
    return {
      dateText: matchedText.trim(),
      startDate: toDateOnly(inferredYear, month, day),
      endDate: toDateOnly(inferredYear, month, day),
    };
  }

  return {
    dateText: 'See source page',
    startDate: null,
    endDate: null,
  };
}

function parseGenericDateRange(dateText) {
  const normalized = normalizeHumanDateText(dateText);
  const parsers = [
    parseBilingualDateRange,
    parseJapaneseDateRange,
    parseSlashDateRange,
    parseDottedDateRange,
    parseEnglishMonthDateRangeWithOptionalStartYear,
    parseEnglishMonthDateRangeWithWeekdays,
    parseEnglishMonthDateRange,
    parseEnglishDayMonthYearRange,
    parseJapaneseSingleDate,
    parseSlashSingleDate,
    parseEnglishSingleDate,
  ];

  for (const parser of parsers) {
    const parsed = parser(normalized);
    const [startYear, startMonth, startDay] = parsed?.startDate?.split('-') ?? [];
    const [endYear, endMonth, endDay] = parsed?.endDate?.split('-') ?? [];
    if (
      parsed?.startDate &&
      parsed?.endDate &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.startDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.endDate) &&
      isValidDateParts(startYear, startMonth, startDay) &&
      isValidDateParts(endYear, endMonth, endDay) &&
      parsed.endDate >= parsed.startDate
    ) {
      return { ...parsed, parserId: parser.name };
    }
  }

  return {
    startDate: null,
    endDate: null,
    calendarStartsAt: null,
    calendarEndsAt: null,
    parserId: null,
  };
}

function normalizeUrl(value, baseUrl) {
  try {
    const sanitizedValue = value.replaceAll('\u0000', '').replaceAll('＆', '&');
    const url = new URL(sanitizedValue, baseUrl);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

const MIN_CONTENT_IMAGE_HEIGHT_PX = 100;
const MIN_CONTENT_IMAGE_WIDTH_PX = 100;
const MAX_IMAGES_PER_EVENT = 5;
const MAX_IMAGE_DIMENSION_PROBES_PER_EVENT = 5;
const IMAGE_DIMENSION_PROBE_BYTES = 65536;

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function parseTagAttributes(tagHtml) {
  const attributes = {};

  for (const match of tagHtml.matchAll(/([:@a-zA-Z0-9_-]+)\s*=\s*(["'])(.*?)\2/g)) {
    attributes[match[1].toLowerCase()] = match[3];
  }

  return attributes;
}

function parsePositiveInteger(value) {
  if (!value) return null;
  const match = String(value).match(/\d+/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseCssPixelDimension(style, propertyName) {
  if (!style) return null;

  const pattern = new RegExp(`(?:^|;)\\s*${propertyName}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, 'i');
  const parsed = Number(style.match(pattern)?.[1]);

  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function getImageAttributeDimensions(attributes) {
  if (!attributes) return { width: null, height: null };

  return {
    width:
      parsePositiveInteger(attributes.width) ??
      parsePositiveInteger(attributes['data-width']) ??
      parsePositiveInteger(attributes['data-original-width']) ??
      parseCssPixelDimension(attributes.style, 'width'),
    height:
      parsePositiveInteger(attributes.height) ??
      parsePositiveInteger(attributes['data-height']) ??
      parsePositiveInteger(attributes['data-original-height']) ??
      parseCssPixelDimension(attributes.style, 'height'),
  };
}

function parseLargestSrcsetCandidate(value) {
  if (!value) return null;

  return String(value)
    .split(',')
    .map((item) => {
      const [url, descriptor = ''] = item.trim().split(/\s+/);
      const match = descriptor.match(/^(\d+(?:\.\d+)?)(w|x)$/i);
      const amount = Number(match?.[1] ?? 0);
      const unit = match?.[2]?.toLowerCase() ?? null;

      return {
        url: url || null,
        width: unit === 'w' && amount > 0 ? Math.round(amount) : null,
        rank: unit === 'w' ? amount : unit === 'x' ? amount * 100000 : 0,
      };
    })
    .filter((candidate) => candidate.url)
    .sort((left, right) => right.rank - left.rank)
    .at(0);
}

function imageCandidateFromTag(tagHtml, source = 'img') {
  const attributes = parseTagAttributes(tagHtml);
  const dimensions = getImageAttributeDimensions(attributes);
  const srcset = parseLargestSrcsetCandidate(attributes['data-srcset'] ?? attributes.srcset);
  const width = Math.max(dimensions.width ?? 0, srcset?.width ?? 0) || null;

  return {
    url:
      attributes['data-src'] ??
      attributes['data-original'] ??
      attributes['data-lazy-src'] ??
      srcset?.url ??
      attributes.src ??
      null,
    width,
    height: dimensions.height,
    source: attributes['data-crawl4ai-media'] ? 'crawl4ai-media' : source,
  };
}

function parseImageDimensionsFromUrl(url) {
  let parsedUrl;

  try {
    parsedUrl = new URL(url, 'https://example.invalid');
  } catch {
    parsedUrl = null;
  }

  const widthQuery = parsedUrl?.searchParams.get('w') ?? parsedUrl?.searchParams.get('width');
  const heightQuery = parsedUrl?.searchParams.get('h') ?? parsedUrl?.searchParams.get('height');
  const width = parsePositiveInteger(widthQuery);
  const height = parsePositiveInteger(heightQuery);

  if (width || height) return { width, height };

  const pathname = parsedUrl?.pathname ?? url;
  const dimensionsInFilename = [
    ...pathname.matchAll(
      /(?:^|[^a-z0-9])(\d{2,5})x(\d{2,5})(?=[^/]*\.(?:avif|gif|jpe?g|png|svg|webp)$)/gi,
    ),
  ].at(-1);

  return {
    width: parsePositiveInteger(dimensionsInFilename?.[1]),
    height: parsePositiveInteger(dimensionsInFilename?.[2]),
  };
}

function getImageCandidateDimensions(candidate, url) {
  const urlDimensions = parseImageDimensionsFromUrl(url);

  return {
    width: parsePositiveInteger(candidate.width) ?? urlDimensions.width,
    height: parsePositiveInteger(candidate.height) ?? urlDimensions.height,
  };
}

function isSmallImageCandidate(candidate, url) {
  const { width, height } = getImageCandidateDimensions(candidate, url);

  return Boolean(
    (width && width < MIN_CONTENT_IMAGE_WIDTH_PX) ||
    (height && height < MIN_CONTENT_IMAGE_HEIGHT_PX),
  );
}

function readUInt24LE(buffer, offset) {
  if (offset + 3 > buffer.length) return null;
  return buffer[offset] + (buffer[offset + 1] << 8) + (buffer[offset + 2] << 16);
}

function parseSvgDimension(value) {
  const match = String(value ?? '')
    .trim()
    .match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function parseSvgDimensions(buffer) {
  const text = buffer.toString('utf8', 0, Math.min(buffer.length, 4096));
  const svgTag = text.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgTag) return null;

  const attributes = parseTagAttributes(svgTag);
  const viewBox = attributes.viewbox
    ?.trim()
    .split(/[\s,]+/)
    .map((value) => Number(value));

  return {
    width:
      parseSvgDimension(attributes.width) ??
      (viewBox?.length === 4 && Number.isFinite(viewBox[2]) ? Math.round(viewBox[2]) : null),
    height:
      parseSvgDimension(attributes.height) ??
      (viewBox?.length === 4 && Number.isFinite(viewBox[3]) ? Math.round(viewBox[3]) : null),
  };
}

function parsePngDimensions(buffer) {
  if (buffer.length < 24 || buffer[0] !== 0x89 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseGifDimensions(buffer) {
  if (buffer.length < 10 || buffer.toString('ascii', 0, 3) !== 'GIF') {
    return null;
  }

  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function parseJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    return null;
  }

  let offset = 2;
  const frameMarkers = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ]);

  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    let marker = buffer[offset + 1];
    offset += 2;

    while (marker === 0xff && offset < buffer.length) {
      marker = buffer[offset];
      offset += 1;
    }

    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) break;

    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;

    if (frameMarkers.has(marker) && offset + 7 <= buffer.length) {
      return {
        height: buffer.readUInt16BE(offset + 3),
        width: buffer.readUInt16BE(offset + 5),
      };
    }

    offset += segmentLength;
  }

  return null;
}

function parseWebpDimensions(buffer) {
  if (
    buffer.length < 30 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;

    if (chunkType === 'VP8X' && dataOffset + 10 <= buffer.length) {
      return {
        width: (readUInt24LE(buffer, dataOffset + 4) ?? 0) + 1,
        height: (readUInt24LE(buffer, dataOffset + 7) ?? 0) + 1,
      };
    }

    if (chunkType === 'VP8 ' && dataOffset + 10 <= buffer.length) {
      return {
        width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff,
        height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff,
      };
    }

    if (chunkType === 'VP8L' && dataOffset + 5 <= buffer.length) {
      const b0 = buffer[dataOffset + 1];
      const b1 = buffer[dataOffset + 2];
      const b2 = buffer[dataOffset + 3];
      const b3 = buffer[dataOffset + 4];

      return {
        width: 1 + (((b1 & 0x3f) << 8) | b0),
        height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      };
    }

    offset = dataOffset + chunkSize + (chunkSize % 2);
  }

  return null;
}

function parseImageDimensionsFromBytes(bytes, contentType = '') {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);

  return (
    parsePngDimensions(buffer) ??
    parseJpegDimensions(buffer) ??
    parseGifDimensions(buffer) ??
    parseWebpDimensions(buffer) ??
    (/svg/i.test(contentType) || buffer.toString('utf8', 0, 256).includes('<svg')
      ? parseSvgDimensions(buffer)
      : null)
  );
}

function looksLikeSocialOrUiImage(url) {
  const isWpThemeExhibitionImage = /\/wp-content\/themes\/[^/]+\/img\/exhibitions\//i.test(url);

  return (
    /data:image|spacer|sprite|logo|icon|favicon|avatar|loader|loading|blank|pixel|tracking|analytics/i.test(
      url,
    ) ||
    /\/assets\/img\/(?:common|layout|icon)\//i.test(url) ||
    (!isWpThemeExhibitionImage && /\/wp-content\/themes\//i.test(url)) ||
    /(?:^|[\/_.-])(facebook|instagram|twitter|social|sns|share|line|youtube|pinterest|linkedin)(?:[\/_.-]|$)/i.test(
      url,
    ) ||
    /(?:^|[\/_.-])x[_-]?banner(?:[\/_.-]|$)/i.test(url)
  );
}

function looksLikeLowQualityImage(url) {
  const value = String(url ?? '');

  return (
    /(?:^|[/?&_.=-])(lqip|placeholder|low[-_]?res|blur_\d+)(?:[/?&_.=-]|$)/i.test(value) ||
    /(?:^|[,_/])(?:w|h)_(?:[1-9]\d?)(?:[,_/]|$)/i.test(value) ||
    /(?:^|[,_/])q_(?:[1-9]|10)(?:[,_/]|$)/i.test(value)
  );
}

function isUnsafeImageUrl(url) {
  return looksLikeSocialOrUiImage(url) || looksLikeLowQualityImage(url);
}

function scoreImageCandidate(candidate) {
  let score = 0;
  const url = candidate.url.toLowerCase();
  const width = candidate.width ?? 0;
  const height = candidate.height ?? 0;

  if (candidate.source === 'configured') score += 40;
  if (candidate.source === 'img') score += 20;
  if (candidate.source === 'crawl4ai-media') score += 10;
  if (candidate.source === 'og:image') score += 2;
  if (/wp-content\/uploads|\/uploads\/|\/media\/|\/images?\//i.test(url)) score += 15;
  if (/exhi|exhibition|event|program|museum|art|craft|gallery|film|schedule/i.test(url)) score += 8;
  if (width >= 256) score += 8;
  if (height >= 256) score += 8;
  if (width >= 512) score += 8;
  if (height >= 512) score += 8;
  if (width && height) score += Math.min(width * height, 1600000) / 100000;

  return score;
}

function finalizeImageUrls(candidates, baseUrl, { preserveOrder = false } = {}) {
  const accepted = [];

  for (const [index, candidate] of candidates.entries()) {
    const url = candidate?.url ? normalizeUrl(candidate.url, baseUrl) : null;
    if (!url) continue;

    const { width, height } = getImageCandidateDimensions(candidate, url);

    if (isUnsafeImageUrl(url) || isSmallImageCandidate(candidate, url)) continue;

    accepted.push({
      url,
      width,
      height,
      source: candidate.source ?? 'img',
      index,
      score: scoreImageCandidate({
        url,
        width,
        height,
        source: candidate.source ?? 'img',
      }),
    });
  }

  const deduped = new Map();
  for (const candidate of accepted) {
    const existing = deduped.get(candidate.url);
    if (!existing || candidate.score > existing.score) {
      deduped.set(candidate.url, candidate);
    }
  }

  const ranked = [...deduped.values()]
    .sort((left, right) =>
      preserveOrder
        ? left.index - right.index
        : right.score - left.score || left.index - right.index,
    )
    .map((candidate) => candidate.url)
    .slice(0, MAX_IMAGES_PER_EVENT);

  return ranked.length ? ranked : [];
}

function sourceShouldSkipOgImages(source) {
  return source?.skip_og_image === true;
}

function sourceAllowsUrl(source, url) {
  try {
    const host = new URL(url).hostname;
    return (source.allowed_domains ?? []).some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

function pathnameMatchesPattern(pathname, pattern) {
  const normalizedPathname = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const normalizedPattern = pattern.toLowerCase().replace(/\/+$/, '') || '/';
  return normalizedPathname.includes(normalizedPattern) && normalizedPathname !== normalizedPattern;
}

function urlMatchesEventPattern(url, pattern) {
  const parsed = new URL(url);
  return pattern.startsWith('?')
    ? parsed.search.toLowerCase().includes(pattern.toLowerCase())
    : pathnameMatchesPattern(parsed.pathname, pattern);
}

function getGenericDetailUrlRecencyHint(url) {
  const parsed = new URL(url);
  const haystack = `${parsed.pathname} ${parsed.search}`;
  const hints = [];

  for (const match of haystack.matchAll(/(20\d{2})[./_-](\d{1,2})(?:[./_-](\d{1,2}))?/g)) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3] ?? '1');

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      hints.push(year * 10000 + month * 100 + day);
    }
  }

  for (const match of haystack.matchAll(/(?:^|[\/=_-])(20\d{2})(?:[\/._-]|$)/g)) {
    hints.push(Number(match[1]) * 10000);
  }

  const postId = Number(parsed.searchParams.get('p') ?? '0');
  if (Number.isFinite(postId) && postId > 0) hints.push(postId);

  const pageId = Number(parsed.searchParams.get('page_id') ?? '0');
  if (Number.isFinite(pageId) && pageId > 0) hints.push(pageId);

  for (const match of haystack.matchAll(/(?:^|[\/=_-])(\d{5,})(?:[\/._-]|$)/g)) {
    hints.push(Number(match[1]));
  }

  return hints.length ? Math.max(...hints) : 0;
}

function scoreGenericDetailUrl(source, url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  const search = parsed.search.toLowerCase();
  if (/\.(?:jpe?g|png|gif|webp|svg|pdf|zip|css|js)$/i.test(pathname)) return 0;
  if (
    /\/(?:archive|archives|category|categories|tag|tags|event_category|access|about|contact|privacy|guide|faq|feed|form)(?:\/|$)/.test(
      pathname,
    ) ||
    /\/(?:customer_authentication|cart)(?:\/|$)/.test(pathname) ||
    /\/collections\/all(?:\/|$)/.test(pathname) ||
    /\/pages\/about(?:\/|$)/.test(pathname) ||
    /\/(?:search|list)\.cgi$/.test(pathname) ||
    /\/xmlrpc\.php$/.test(pathname) ||
    /\/wp-json\/?$/.test(pathname)
  ) {
    return 0;
  }
  if (
    parsed.searchParams.has('rest_route') ||
    parsed.searchParams.has('feed') ||
    parsed.searchParams.has('author')
  ) {
    return 0;
  }

  const patterns = (source.event_page_patterns ?? []).filter(
    (pattern) => pattern && pattern !== '/',
  );
  const patternScore = patterns.some((pattern) => urlMatchesEventPattern(url, pattern)) ? 8 : 0;
  const keywordScore =
    /event|exhibition|exhibit|program|live|schedule|news|journal|show|artist|展|催|公演/i.test(
      `${pathname} ${search}`,
    )
      ? 4
      : 0;
  const dateScore = /20\d{2}|202\d|\d{4}[./-]\d{1,2}/.test(`${pathname} ${search}`) ? 2 : 0;
  const depthScore = pathname.split('/').filter(Boolean).length > 1 ? 1 : 0;
  const queryScore = parsed.searchParams.has('p') ? 6 : 0;

  return patternScore + keywordScore + dateScore + depthScore + queryScore;
}

function extractConfiguredDetailUrls(listingHtml, listingUrl, source) {
  const listingLinkSelectors = selectorsFor(source, 'listing_links');
  if (!listingLinkSelectors.length) return [];

  return listingLinkSelectors
    .flatMap((selector) => selectElements(listingHtml, selector))
    .flatMap((element) => {
      const directHref = /^<a\b/i.test(element) ? extractTagAttribute(element, 'href') : null;
      const nestedHrefs = [...element.matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)].map(
        (match) => match[2],
      );

      return [directHref, ...nestedHrefs].filter(Boolean);
    })
    .map((href) => normalizeUrl(href, listingUrl))
    .filter(Boolean)
    .filter((url) => sourceAllowsUrl(source, url))
    .filter((url) => !sourceSkipsUrl(source, url))
    .filter((url) => url !== listingUrl);
}

function extractGenericDetailUrls(listingHtml, listingUrl, source, limit = 8) {
  const configuredUrls = extractConfiguredDetailUrls(listingHtml, listingUrl, source);
  const hasConfiguredListingSelectors = selectorsFor(source, 'listing_links').length > 0;

  if (hasConfiguredListingSelectors) {
    return [...new Set(configuredUrls)].slice(0, limit);
  }

  const urls = [...listingHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)]
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean)
    .filter((url) => sourceAllowsUrl(source, url))
    .filter((url) => !sourceSkipsUrl(source, url))
    .filter((url) => url !== listingUrl);

  const patterns = (source.event_page_patterns ?? []).filter(
    (pattern) => pattern && pattern !== '/',
  );
  const scoredUrls = [...new Set(urls)]
    .map((url) => ({
      url,
      score: scoreGenericDetailUrl(source, url),
      recencyHint: getGenericDetailUrlRecencyHint(url),
      matchesPattern: patterns.some((pattern) => urlMatchesEventPattern(url, pattern)),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.recencyHint - left.recencyHint ||
        left.url.localeCompare(right.url),
    )
    .slice(0, limit * 4);

  const preferredUrls = scoredUrls.filter((entry) => entry.matchesPattern);
  const finalUrls = (preferredUrls.length ? preferredUrls : scoredUrls)
    .slice(0, limit)
    .map((entry) => entry.url);

  return finalUrls.length ? finalUrls : [listingUrl];
}

function extractHongKongPalaceMuseumDetailUrls(listingHtml) {
  const today = toDateInTimeZone(new Date(), 'Asia/Hong_Kong');
  const eventGroups = [
    ...listingHtml.matchAll(/eventData\[['"](?:special|thematic)['"]\]\s*=\s*(\[[\s\S]*?\]);/g),
  ].flatMap((match) => {
    try {
      return JSON.parse(match[1]);
    } catch {
      return [];
    }
  });

  return eventGroups
    .filter((event) => normalizeDateOnly(event?.end) >= today)
    .map((event) => event?.url)
    .filter(Boolean);
}

function extractJpsHongKongDetailUrls(listingHtml, listingUrl) {
  return [...listingHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter((match) => /\bexhibition-item\b/i.test(match[1]))
    .filter((match) => !/\bPAST\b/i.test(match[1]))
    .filter((match) => /exhibition-location[^>]*>\s*Hong Kong\s*</i.test(match[2]))
    .map((match) => extractTagAttribute(`<a ${match[1]}>`, 'href'))
    .map((href) => normalizeUrl(href, listingUrl))
    .filter(Boolean);
}

function extractVillepinCurrentDetailUrls(listingHtml, listingUrl) {
  const currentStart = listingHtml.search(/Current Exhibitions/i);
  const currentHtml = currentStart === -1 ? listingHtml : listingHtml.slice(currentStart);
  const pastStart = currentHtml.search(/Past Exhibitions/i);
  const scopedHtml = pastStart === -1 ? currentHtml : currentHtml.slice(0, pastStart);

  return [...scopedHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)]
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean)
    .filter((url) => new URL(url).hostname.endsWith('villepinart.com'));
}

function extractTenChanceryCurrentDetailUrls(listingHtml, listingUrl) {
  const currentStart = listingHtml.search(/id=(["'])exhibitions-grid-current\1/i);
  const currentHtml = currentStart === -1 ? listingHtml : listingHtml.slice(currentStart);
  const pastStart = currentHtml.search(/id=(["'])exhibitions-grid-past\1/i);
  const scopedHtml = pastStart === -1 ? currentHtml : currentHtml.slice(0, pastStart);

  return [...scopedHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)]
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean)
    .filter((url) => /\/exhibitions\/[^/]+\/overview\/$/i.test(new URL(url).pathname));
}

function extractTwentyOneDetailUrls(listingHtml, listingUrl) {
  const articleStart = listingHtml.search(/<article\b[^>]*class=(["'])[^"']*\bmainArea\b[^"']*\1/i);
  const scopedHtml = articleStart === -1 ? listingHtml : listingHtml.slice(articleStart);
  const cutoff = scopedHtml.search(
    /<section\b[^>]*id=(["'])(?:About|PrevProgram)\1|PAST PROGRAM|これまでのプログラム/iu,
  );
  const currentHtml = cutoff === -1 ? scopedHtml : scopedHtml.slice(0, cutoff);

  const urls = [...currentHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)]
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean)
    .filter((url) => {
      const parsed = new URL(url);
      return (
        (parsed.hostname === 'www.2121designsight.jp' ||
          parsed.hostname === '2121designsight.jp') &&
        /^\/(?:en\/)?(?:program|gallery3)\/[^/]+\/$/i.test(parsed.pathname)
      );
    });

  return [...new Set(urls)];
}

const scaiLocationLabels = {
  'scai-the-bathhouse': 'SCAI THE BATHHOUSE',
  'scai-piramide': 'SCAI PIRAMIDE',
  'scai-park': 'SCAI PARK',
};

function extractScaiDetailUrlsFor(slug) {
  return (listingHtml, listingUrl) => {
    const label = scaiLocationLabels[slug];
    if (!label) return [];

    const locationMenus = [
      ...listingHtml.matchAll(
        /<li\b[^>]*class=(["'])[^"']*\bdropdown-submenu\b[^"']*\1[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>\s*<ul\b[^>]*class=(["'])[^"']*\bdropdown-menu\b[^"']*\3[^>]*>([\s\S]*?)<\/ul>/gi,
      ),
    ];
    const menu = locationMenus.find(
      (match) => stripTags(match[2]).replace(/\s+/g, ' ').trim().toUpperCase() === label,
    )?.[4];
    if (!menu) return [];

    const urls = [...menu.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)]
      .filter((match) => /(Current|Upcoming|現在の企画展|次回の企画展)/i.test(stripTags(match[1])))
      .map((match) => match[1].match(/<a\b[^>]+href=(["'])(.*?)\1/i)?.[2] ?? null)
      .filter(Boolean)
      .map((href) => normalizeUrl(href, listingUrl))
      .filter(Boolean)
      .filter((url) => {
        const parsed = new URL(url);
        return (
          (parsed.hostname === 'www.scaithebathhouse.com' ||
            parsed.hostname === 'scaithebathhouse.com') &&
          /\/(?:en|ja)\/exhibitions\/20\d{2}\//.test(parsed.pathname)
        );
      });

    return [...new Set(urls)];
  };
}

function extractOsakaGeidaiDetailUrls(listingHtml, listingUrl) {
  const urls = [...listingHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)]
    .filter((match) => stripTags(match[3]).includes('アート・展覧会'))
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean);

  return [...new Set(urls)];
}

function extractHyogoExhibitionItems(listingHtml) {
  return selectElements(listingHtml, '.exhibition-item');
}

function extractHyogoDateText(itemHtml, scheduleYear) {
  const text = stripTags(itemHtml).replace(/\s+/g, ' ').trim();
  const dateText = text.match(
    /(?:20\d{2}年)?\d{1,2}月\d{1,2}日[^\d]{0,20}?[-–—～〜－][^\d]{0,20}?(?:20\d{2}年)?\d{1,2}月\d{1,2}日/u,
  )?.[0];
  if (!dateText) return null;

  return /^20\d{2}年/u.test(dateText) ? dateText : `${scheduleYear}年${dateText}`;
}

function extractHyogoDetailUrls(listingHtml, listingUrl) {
  const scheduleYear = listingHtml.match(/(20\d{2})年\s*年間スケジュール/u)?.[1];
  if (!scheduleYear) return [];

  const today = toJapanDate(new Date());
  return extractHyogoExhibitionItems(listingHtml).flatMap((itemHtml, index) => {
    const dateText = extractHyogoDateText(itemHtml, scheduleYear);
    if (!dateText) return [];
    const parsedDates = parseGenericDateRange(dateText);
    if (!parsedDates.startDate) return [];
    if (
      classifyEventTiming(
        { start_date: parsedDates.startDate, end_date: parsedDates.endDate },
        today,
      ) === 'past'
    ) {
      return [];
    }
    return [`${listingUrl}#exhibition-${index}`];
  });
}

function extractSnowCurrentDetailUrls(_listingHtml, listingUrl) {
  return [listingUrl];
}

function extractFirstDateText(text) {
  const normalizedText = normalizeHumanDateText(text);
  const patterns = [
    new RegExp(
      `(?:${ENGLISH_MONTH_PATTERN})\\.?\\s+\\d{1,2}(?:,?\\s*\\d{4})?\\s*-\\s*(?:${ENGLISH_MONTH_PATTERN})\\.?\\s+\\d{1,2}(?:,?\\s*\\d{4})?`,
      'iu',
    ),
    new RegExp(
      `\\d{1,2}\\s+(?:${ENGLISH_MONTH_PATTERN})\\.?(?:,?\\s*\\d{4})?\\s*-\\s*\\d{1,2}\\s+(?:${ENGLISH_MONTH_PATTERN})\\.?(?:,?\\s*\\d{4})?`,
      'iu',
    ),
    /\d{4}年\d{1,2}月\d{1,2}日[\s\S]{0,40}?-[\s\S]{0,40}?(?:\d{4}年)?\d{1,2}月\d{1,2}日/u,
    /\d{4}[./-]\d{1,2}[./-]\d{1,2}[\s\S]{0,30}?-[\s\S]{0,30}?(?:\d{4}[./-])?\d{1,2}[./-]\d{1,2}/u,
    /(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2},\s*\d{4}/iu,
    /\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/iu,
    /\d{4}年\d{1,2}月\d{1,2}日/u,
    /\d{4}[./-]\d{1,2}[./-]\d{1,2}/u,
  ];

  for (const pattern of patterns) {
    const match = normalizedText.match(pattern);
    if (match) return match[0].replace(/\s+/g, ' ').trim();
  }

  return 'See source page';
}

function isEventJsonLdType(value) {
  const types = Array.isArray(value?.['@type']) ? value['@type'] : [value?.['@type']];
  return types.some((type) => typeof type === 'string' && /(?:event$|exhibition)/i.test(type));
}

function jsonLdPageIdentifiers(value) {
  return [value?.url, value?.['@id'], value?.mainEntity, value?.mainEntityOfPage]
    .flatMap((candidate) => (Array.isArray(candidate) ? candidate : [candidate]))
    .map((candidate) =>
      typeof candidate === 'string'
        ? candidate
        : typeof candidate?.['@id'] === 'string'
          ? candidate['@id']
          : null,
    )
    .filter(Boolean);
}

function jsonLdPageMatchScore(value, detailUrl) {
  const identifiers = jsonLdPageIdentifiers(value);
  if (!detailUrl || !identifiers.length) return 1;
  return jsonLdMatchesPage(value, detailUrl) ? 2 : 0;
}

function jsonLdMatchesPage(value, detailUrl) {
  if (!detailUrl) return true;

  const identifiers = jsonLdPageIdentifiers(value);
  if (!identifiers.length) return true;

  const expected = canonicalizeUrlWithoutHash(detailUrl);
  return identifiers.some((identifier) => {
    try {
      return canonicalizeUrlWithoutHash(new URL(identifier, detailUrl).toString()) === expected;
    } catch {
      return false;
    }
  });
}

function extractJsonLdDateCandidates(detailHtml, detailUrl = null) {
  const values = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;

    if (
      isEventJsonLdType(value) &&
      jsonLdMatchesPage(value, detailUrl) &&
      typeof value.startDate === 'string'
    ) {
      values.push({
        raw:
          typeof value.endDate === 'string'
            ? `${value.startDate} - ${value.endDate}`
            : value.startDate,
        name: typeof value.name === 'string' ? value.name : null,
      });
    }
    Object.values(value).forEach(visit);
  };

  for (const match of detailHtml.matchAll(
    /<script\b[^>]*type=(['"])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse(match[2]));
    } catch {
      // Invalid third-party JSON-LD. Continue with visible page content.
    }
  }

  return values;
}

function extractJsonLdDateText(detailHtml, detailUrl = null) {
  return extractJsonLdDateCandidates(detailHtml, detailUrl).map((candidate) => candidate.raw);
}

function isPublicationDateContext(value) {
  return /pubdate|publish(?:ed)?|posted|updated|datepublished|datemodified|投稿日|公開日|更新日/iu.test(
    String(value ?? ''),
  );
}

function stripDateSearchScripts(value) {
  return String(value ?? '').replace(
    /<(?:script|style|template|noscript)\b[^>]*>[\s\S]*?<\/(?:script|style|template|noscript)>/giu,
    ' ',
  );
}

function scoreDateCandidate({ raw, parsed, baseScore }) {
  let score = baseScore;
  if (parsed.startDate !== parsed.endDate) score += 8;
  if (/20\d{2}/.test(raw)) score += 4;
  if (/(?:date|dates|period|schedule|duration|会期|開催期間)/iu.test(raw)) score += 6;
  if (/(?:closed|closure|holiday|休館|休業)/iu.test(raw)) score -= 180;
  return score;
}

function buildDateCandidate(input, order) {
  const raw = String(input.raw ?? '').trim();
  if (!raw) return null;

  const text = extractFirstDateText(raw);
  if (text === 'See source page') return null;

  const parsed = parseGenericDateRange(text);
  if (!parsed.startDate) return null;

  return {
    raw,
    text,
    origin: input.origin,
    parserId: parsed.parserId,
    score: scoreDateCandidate({ raw, parsed, baseScore: input.baseScore }),
    order,
    parsed,
  };
}

function extractBestDateCandidate(detailHtml, detailUrl = null) {
  const inputs = [];
  const push = (raw, origin, baseScore) => {
    if (raw) inputs.push({ raw, origin, baseScore });
  };

  for (const candidate of extractJsonLdDateCandidates(detailHtml, detailUrl)) {
    push(candidate.raw, 'json_ld', 700);
  }

  for (const element of selectElements(detailHtml, 'time')) {
    if (isPublicationDateContext(element)) continue;
    const hasEventDateContext =
      /event|exhibition|schedule|period|duration|start|end|会期|開催/iu.test(element);
    push(
      extractTagAttribute(element, 'datetime') ?? stripTags(element),
      'time_element',
      hasEventDateContext ? 600 : 350,
    );
  }

  for (const element of selectElements(
    detailHtml,
    '[class*=date], [id*=date], [class*=period], [id*=period], [class*=schedule], [id*=schedule]',
  )) {
    if (isPublicationDateContext(element)) continue;
    push(stripTags(element), 'semantic_element', 500);
  }

  for (const selector of ['main', 'article']) {
    for (const element of selectElements(detailHtml, selector)) {
      push(stripTags(stripDateSearchScripts(element)), 'article_content', 400);
    }
  }

  for (const name of ['og:description', 'description', 'og:title']) {
    push(stripTags(extractMeta(detailHtml, name) ?? ''), 'metadata', 300);
  }

  push(stripTags(stripDateSearchScripts(detailHtml)), 'page_fallback', 100);

  return (
    inputs
      .map(buildDateCandidate)
      .filter(Boolean)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.order - right.order ||
          left.text.localeCompare(right.text),
      )[0] ?? null
  );
}

function extractBestDateText(detailHtml, detailUrl = null) {
  return extractBestDateCandidate(detailHtml, detailUrl)?.text ?? 'See source page';
}

function extractGenericImageUrls(detailHtml, detailUrl, options = {}) {
  const includeOgImage = options.includeOgImage !== false;
  const ogImage = extractMeta(detailHtml, 'og:image');
  const imageCandidates = [
    ...(includeOgImage && ogImage ? [{ url: ogImage, source: 'og:image' }] : []),
    ...[...detailHtml.matchAll(/<img\b[^>]*>/gi)].map((match) => imageCandidateFromTag(match[0])),
  ];

  return finalizeImageUrls(imageCandidates, detailUrl);
}

function extractClassBlock(html, className, tagName = '[a-z0-9]+') {
  const pattern = new RegExp(
    `<${tagName}[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    'i',
  );

  return html.match(pattern)?.[1] ?? null;
}

function extractDefinitionValue(html, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`<dt>${escaped}</dt>\\s*<dd>([\\s\\S]*?)</dd>`, 'i');

  return html.match(pattern)?.[1] ?? null;
}

function extractKacDetailUrls(listingHtml, listingUrl) {
  const matches = [
    ...listingHtml.matchAll(/https:\/\/www\.kac\.or\.jp\/(?:en\/)?events\/\d+\//g),
  ].map((match) => new URL(match[0], listingUrl).toString());

  if (!matches.length) {
    throw new Error('Could not find Kyoto Art Center event detail URLs on the listing page');
  }

  return [...new Set(matches)];
}

function extractFukudaDetailUrls(listingHtml, listingUrl) {
  const sectionHtml =
    listingHtml.match(/<section\b[^>]*id="exArv"[^>]*>([\s\S]*?)<\/section>/i)?.[1] ?? '';
  if (!sectionHtml) return [];

  return [
    ...new Set(
      [
        ...sectionHtml.matchAll(
          /<article\b[^>]*class="[^"]*\bpostbox\b[^"]*"[^>]*>([\s\S]*?)<\/article>/gi,
        ),
      ]
        .map((match) => match[1].match(/<a\b[^>]+href=(["'])(.*?)\1/i)?.[2])
        .map((href) => (href ? normalizeUrl(href, listingUrl) : null))
        .filter(Boolean)
        .filter((url) => /\/(?:en\/)?exhibition\/\d+/.test(new URL(url).pathname)),
    ),
  ];
}

function extractSibasiDetailUrls(listingPages, genericDetailLimit = 8) {
  const detailUrls = listingPages.flatMap(({ html, url }) => {
    const matches = [...html.matchAll(/<a\b[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => ({
        url: normalizeUrl(match[2], url),
        text: stripTags(match[3]).replace(/\s+/g, ' ').trim(),
      }))
      .filter((entry) => entry.url)
      .filter((entry) => /\/20\d{2}\/\d{2}\/\d{2}\//.test(new URL(entry.url).pathname))
      .filter(
        (entry) =>
          !/追加チケット|予約開始|会場限定|ご案内|ありがとうございました|item list|items/i.test(
            entry.text,
          ),
      );

    return matches.map((entry) => entry.url);
  });

  return [...new Set(detailUrls)].slice(0, genericDetailLimit * 2);
}

function extractArtCollaborationKyotoDetailUrls(_listingHtml, listingUrl) {
  return [listingUrl];
}

function extractCurationFairDetailUrls(listingHtml, listingUrl, source) {
  const city = source.slug.replace('curation-fair-', '');
  const year = currentYearInTokyo();
  const announcementUrl = [
    ...listingHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi),
  ]
    .map((match) => ({
      url: normalizeUrl(match[2], listingUrl),
      title: stripTags(match[3]).replace(/\s+/g, ' ').trim(),
    }))
    .find(
      ({ title }) =>
        /Announcement of CURATION\s*⇄\s*FAIR/iu.test(title) &&
        new RegExp(`\\b${city}\\b`, 'i').test(title) &&
        title.includes(year),
    )?.url;

  if (!announcementUrl) return [];
  return [
    normalizeUrl(source.event_info_urls?.[source.language] ?? announcementUrl, listingUrl),
  ].filter(Boolean);
}

function extractKoenKyotoDetailUrls(_listingHtml, listingUrl) {
  return [listingUrl];
}

function extractGalleryYamahonDetailUrls(_listingHtml, listingUrl) {
  return [listingUrl];
}

function extractKcuaDetailUrls(listingHtml, listingUrl) {
  return [
    ...new Set(
      [...listingHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)]
        .filter((match) => /<img\b[^>]+(?:src|data-src)=(["'])[^"']+\1/i.test(match[3]))
        .map((match) => normalizeUrl(match[2], listingUrl))
        .filter(
          (url) => url && /\/(?:en\/)?archives\/20\d{2}\/\d+\/?$/i.test(new URL(url).pathname),
        ),
    ),
  ];
}

function extractHosomiMuseumDetailUrls(_listingHtml, listingUrl) {
  return [listingUrl];
}

function extractKitanoDetailUrls(listingHtml, listingUrl) {
  return [
    ...listingHtml.matchAll(
      /<div\b[^>]*class=(['"])[^'"]*\bwrapper\b[^'"]*\1[^>]*id=(['"])(\d{9})\2/gi,
    ),
  ].map((match) => `${listingUrl}#${match[3]}`);
}

function extractIsseyMiyakeKuraDetailUrls(listingHtml, listingUrl) {
  return [
    ...listingHtml.matchAll(
      /<a\b[^>]*href=(['"])([^'"]*\/blogs\/kyotokura\/\d+)\1[^>]*class=(['"])[^'"]*\bnews\b[^'"]*\3[^>]*>([\s\S]*?)<\/a>/gi,
    ),
  ]
    .filter((match) =>
      /class=(['"])[^'"]*\b_tag\b[^'"]*\1[^>]*>\s*(?:ON VIEW|開催中)\s*</iu.test(match[4]),
    )
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean);
}

function extractSokyoDetailUrls(listingHtml, listingUrl) {
  const sections = ['current', 'upcoming'].flatMap((status) => {
    const start = listingHtml.indexOf(`id="exhibitions-grid-${status}"`);
    if (start === -1) return [];
    const rest = listingHtml.slice(start);
    const next = rest.slice(1).search(/id="exhibitions-grid-(?:current|upcoming|past)"/i);
    return [next === -1 ? rest : rest.slice(0, next + 1)];
  });

  return [
    ...new Set(
      sections
        .flatMap((section) => [
          ...section.matchAll(/<a\b[^>]*href=(['"])([^'"]*\/exhibitions\/[^'"]+\/overview\/)\1/gi),
        ])
        .map((match) => normalizeUrl(match[2], listingUrl))
        .filter(Boolean),
    ),
  ];
}

function extractGalleryTakeTwoItems(listingHtml) {
  const payload = listingHtml.match(
    /<script\b[^>]*id=(['"])wix-warmup-data\1[^>]*>([\s\S]*?)<\/script>/i,
  )?.[2];
  if (!payload) return [];

  try {
    const warmup = JSON.parse(payload);
    return Object.values(warmup?.appsWarmupData ?? {})
      .flatMap((app) => Object.entries(app ?? {}))
      .filter(([key]) => key.endsWith('_galleryData'))
      .flatMap(([, gallery]) => gallery?.items ?? []);
  } catch {
    return [];
  }
}

function extractGalleryTakeTwoDetailUrls(listingHtml, listingUrl) {
  return extractGalleryTakeTwoItems(listingHtml)
    .filter((item) => item?.itemId && item?.mediaUrl)
    .filter((item) => !/coming soon/i.test(item?.metaData?.fileName ?? ''))
    .map((item) => `${listingUrl}#${item.itemId}`);
}

function extractHosooDetailUrls(listingHtml, listingUrl) {
  const matches = [...listingHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)]
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean)
    .filter((url) => /\/(?:en\/)?exhibitions\/[^/]+\/?$/.test(new URL(url).pathname));

  if (!matches.length) {
    throw new Error('Could not find HOSOO exhibition detail URLs on the listing page');
  }

  return [...new Set(matches)];
}

function extractZenbiDetailUrls(listingHtml, listingUrl) {
  const blocks = [...listingHtml.matchAll(/<article id="exhibition-\d+"[\s\S]*?<\/article>/gi)].map(
    (match) => match[0],
  );

  const matches = blocks
    .map((block) => ({
      url: normalizeUrl(block.match(/<a href="([^"]+)"/i)?.[1] ?? '', listingUrl),
      term: stripTags(block.match(/<div class="exTerm[\s\S]*?>([\s\S]*?)<\/div>/i)?.[1] ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase(),
    }))
    .filter((entry) => entry.url)
    .filter((entry) => /\/exhibition\//.test(new URL(entry.url).pathname));

  const preferred = matches.filter((entry) => /current|upcoming|開催中|開催予定/.test(entry.term));
  const urls = [
    ...new Set((preferred.length ? preferred : matches.slice(0, 2)).map((entry) => entry.url)),
  ];

  if (!urls.length) {
    throw new Error('Could not find ZENBI exhibition detail URLs on the listing page');
  }

  return urls;
}

function extractTakaIshiiDetailUrls(listingHtml, listingUrl) {
  const kyotoLocationPattern =
    /taka\s+ishii\s+gallery\s+kyoto|kyoto\s*\(yada-cho\)|yada-cho|タカ・イシイギャラリー\s*京都|京都(?:矢田町)?/i;
  const sectionMatches = [...listingHtml.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)];
  const matches = sectionMatches
    .filter((sectionMatch) => kyotoLocationPattern.test(stripTags(sectionMatch[0])))
    .flatMap((sectionMatch) => [...sectionMatch[0].matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)])
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean)
    .filter((url) => /\/(?:en\/)?archives\/\d+\/?$/.test(new URL(url).pathname));

  if (!matches.length) {
    throw new Error('Could not find Taka Ishii Gallery Kyoto detail URLs on the listing page');
  }

  return [...new Set(matches)];
}

function extractKyohakuDetailUrls(listingHtml, listingUrl) {
  const matches = [...listingHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      url: normalizeUrl(match[2], listingUrl),
      text: stripTags(match[3]).replace(/\s+/g, ' ').trim(),
    }))
    .filter((entry) => entry.url)
    .filter((entry) => /(Current|Upcoming)/i.test(entry.text))
    .filter((entry) => /Exhibition/i.test(entry.text))
    .filter((entry) =>
      sourceAllowsUrl(
        {
          allowed_domains: ['www.kyohaku.go.jp', 'kyohaku.go.jp'],
        },
        entry.url,
      ),
    )
    .filter((entry) => /\/exhibitions\//i.test(new URL(entry.url).pathname));

  const urls = [...new Set(matches.map((entry) => entry.url))];

  if (!urls.length) {
    throw new Error(
      'Could not find Kyoto National Museum exhibition detail URLs on the listing page',
    );
  }

  return urls.slice(0, 2);
}

function extractKacEvent(detailHtml, source, detailUrl) {
  const titleMatch = detailHtml.match(/<h1 class="sectionTitle">([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : null;

  if (!title) {
    throw new Error('Could not extract event title from Kyoto Art Center detail page');
  }

  const dateText = extractSectionValue(detailHtml, '開催日時') ?? 'See source page';
  const venueName = extractSectionValue(detailHtml, '会場');
  const genre = extractSectionValue(detailHtml, 'ジャンル');
  const category = extractSectionValue(detailHtml, 'カテゴリー');
  const descriptionBlock =
    detailHtml.match(/<p><br>([\s\S]*?)<\/p>/i)?.[1] ??
    extractMeta(detailHtml, 'og:description') ??
    '';

  const imageUrls = finalizeImageUrls(
    [
      { url: extractMeta(detailHtml, 'og:image'), source: 'og:image' },
      ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"/gi)].map(
        (match) => ({
          url: match[1],
          source: 'img',
        }),
      ),
    ],
    detailUrl,
  );
  const primaryImageUrl = imageUrls[0] ?? null;

  const categories = [
    ...new Set(
      [genre, category]
        .flatMap((value) => (value ? value.split(/[／/、,]/) : []))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];

  const parsedDates = parseJapaneseDateRange(dateText);
  const addressText = venueName ?? source.address_text ?? source.name;
  const directionsQuery = source.directions_query ?? `${addressText} Kyoto`;

  return {
    title,
    categories,
    description: stripTags(descriptionBlock),
    institution_name: source.name,
    venue_name: venueName,
    address_text: addressText,
    directions_query: directionsQuery,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: primaryImageUrl,
    image_urls: imageUrls,
    source_url: detailUrl,
  };
}

function extractSibasiEvent(detailHtml, source, detailUrl) {
  const title = stripTags(detailHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/\s*[–-]\s*sibasi$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!title) {
    throw new Error('Could not extract event title from Sibasi detail page');
  }

  const pageText = stripTags(detailHtml);
  const parsedDates = parseSibasiDateRange(pageText, detailUrl);
  const imageUrls = extractGenericImageUrls(detailHtml, detailUrl);

  return {
    title,
    categories: flattenTaxonomy(source.taxonomy),
    description: extractGenericDescription(detailHtml),
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: source.directions_query ?? `${source.name}, Kyoto`,
    date_text: parsedDates.dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.startDate ? `${parsedDates.startDate}T00:00:00+09:00` : null,
    calendar_ends_at: parsedDates.endDate ? `${parsedDates.endDate}T23:59:00+09:00` : null,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
  };
}

function extractHosooEvent(detailHtml, source, detailUrl) {
  const title = stripTags(
    detailHtml.match(/<div class="c-title">[\s\S]*?<h3 class="title">([\s\S]*?)<\/h3>/i)?.[1] ??
      extractMeta(detailHtml, 'og:title') ??
      '',
  )
    .replace(/\s*[|｜-]\s*HOSOO GALLERY$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!title) {
    throw new Error('Could not extract event title from HOSOO detail page');
  }

  const subtitle = stripTags(detailHtml.match(/<p class="subtitle">([\s\S]*?)<\/p>/i)?.[1] ?? '');
  const dateText =
    stripTags(
      detailHtml.match(/<dt class="term">Dates<\/dt><dd class="desc">([\s\S]*?)<\/dd>/i)?.[1] ?? '',
    ) || 'See source page';
  const hoursText =
    stripTags(
      detailHtml.match(/<dt class="term">Hours<\/dt><dd class="desc">([\s\S]*?)<\/dd>/i)?.[1] ?? '',
    ) || null;
  const venueName =
    stripTags(
      detailHtml.match(/<dt class="term">Venue<\/dt><dd class="desc">([\s\S]*?)<\/dd>/i)?.[1] ?? '',
    ) || source.name;

  const description = [...detailHtml.matchAll(/<p class="cmt">([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 4)
    .join('\n\n');

  const imageUrls = finalizeImageUrls(
    [
      { url: extractMeta(detailHtml, 'og:image'), source: 'og:image' },
      ...[
        ...detailHtml.matchAll(/<img\b[^>]+(?:src|data-src)="([^"]*\/img\/exhibitions\/[^"]+)"/gi),
      ]
        .map((match) => match[1])
        .filter((url) => !/\/profile[_-]/i.test(url))
        .map((url) => ({
          url,
          source: 'img',
        })),
    ],
    detailUrl,
  );

  const parsedDates = parseEnglishDayMonthYearRange(dateText);
  const categories = ['exhibition', 'gallery'];
  if (subtitle) categories.push(subtitle.toLowerCase());

  return {
    title,
    categories: [...new Set(categories.filter(Boolean))],
    description: description || extractGenericDescription(detailHtml),
    institution_name: source.name,
    venue_name: venueName,
    address_text: venueName,
    directions_query: source.directions_query ?? `${venueName}, Kyoto`,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: hoursText,
    end_time_text: null,
    is_all_day: !hoursText,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
  };
}

function extractArtroEvent(detailHtml, source, detailUrl) {
  const titleHtml =
    detailHtml.match(
      /<h2\b[^>]*class="[^"]*\bmainVisual__infoTitle\b[^"]*"[^>]*>([\s\S]*?)<\/h2>/i,
    )?.[1] ?? '';
  const titleParts = [...titleHtml.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const title =
    titleParts[1] ??
    titleParts[0] ??
    stripTags(detailHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '')
      .replace(/\s*-\s*ARTRO$/i, '')
      .trim();

  if (!title) {
    throw new Error('Could not extract event title from ARTRO detail page');
  }

  const artist = titleParts[0] && titleParts[0] !== title ? titleParts[0] : null;
  const dateText =
    stripTags(
      detailHtml.match(
        /<p\b[^>]*class="[^"]*\bmainVisual__infoDate\b[^"]*"[^>]*>[\s\S]*?<time[^>]*>([\s\S]*?)<\/time>/i,
      )?.[1] ??
        detailHtml.match(
          /<p\b[^>]*class="[^"]*\bsection__colExInfoDate\b[^"]*"[^>]*>[\s\S]*?<time[^>]*>([\s\S]*?)<\/time>/i,
        )?.[1] ??
        '',
    ) || 'See source page';
  const parsedDates = parseGenericDateRange(dateText);
  const mainHtml = detailHtml.slice(Math.max(0, detailHtml.indexOf('<main')));
  const description = [...mainHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter((value) => value.length > 80)
    .slice(0, 2)
    .join('\n\n');
  const mainVisualImageStart = detailHtml.search(/<div\b[^>]*class="[^"]*\bmainVisual__image\b/i);
  const mainVisualImageEnd = detailHtml.indexOf(
    '<!-- ////////////////////////////// mainVisual END -->',
    mainVisualImageStart,
  );
  const imageHtml =
    mainVisualImageStart >= 0 && mainVisualImageEnd > mainVisualImageStart
      ? detailHtml.slice(mainVisualImageStart, mainVisualImageEnd)
      : detailHtml;
  const imageUrls = finalizeImageUrls(
    [
      ...imageHtml.matchAll(
        /<img\b[^>]+(?:src|data-src)="([^"]*(?:\/cms_wp\/wp-content\/uploads\/|\/wp-content\/uploads\/)[^"]+)"/gi,
      ),
    ].map((match) => ({
      url: match[1],
      source: 'img',
    })),
    detailUrl,
  );

  return {
    title,
    categories: ['exhibition', 'gallery'],
    description: description || extractGenericDescription(detailHtml),
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: source.directions_query ?? `${source.name}, Kyoto`,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
    metadata: artist ? { artist } : undefined,
  };
}

function extractZenbiEvent(detailHtml, source, detailUrl) {
  const titleJa = stripTags(
    detailHtml.match(/<span class="exTitle">([\s\S]*?)<\/span>/i)?.[1] ?? '',
  );
  const titleEn = stripTags(
    detailHtml.match(/<span class="exTitle_en">([\s\S]*?)<\/span>/i)?.[1] ?? '',
  );
  const subtitleEn = stripTags(
    detailHtml.match(/<span class="exSubtitle_en">([\s\S]*?)<\/span>/i)?.[1] ?? '',
  );
  const exhibitionType = stripTags(
    detailHtml.match(/<span class="exCat_en">([\s\S]*?)<\/span>/i)?.[1] ?? '',
  );
  const title = [titleEn, subtitleEn].filter(Boolean).join(': ') || titleJa;

  if (!title) {
    throw new Error('Could not extract event title from ZENBI detail page');
  }

  const dateText =
    stripTags(detailHtml.match(/<span class="exPeriod">([\s\S]*?)<\/span>/i)?.[1] ?? '') ||
    'See source page';
  const description = stripTags(
    detailHtml.match(/<div class="exIntro(?:_en)?[^"]*">([\s\S]*?)<\/div>/i)?.[1] ??
      detailHtml.match(/<div class="exIntro[^"]*">([\s\S]*?)<\/div>/i)?.[1] ??
      '',
  );
  const hoursText =
    stripTags(detailHtml.match(/<p class="exOpen en">([\s\S]*?)<\/p>/i)?.[1] ?? '') || null;
  const imageUrls = finalizeImageUrls(
    [
      ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"/gi)].map(
        (match) => ({
          url: match[1],
          source: 'img',
        }),
      ),
    ],
    detailUrl,
  );
  const parsedDates = parseDottedDateRange(dateText);

  return {
    title,
    categories: [
      ...new Set(['exhibition', 'museum', exhibitionType.toLowerCase()].filter(Boolean)),
    ],
    description: description || extractGenericDescription(detailHtml),
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: source.directions_query ?? `${source.name}, Kyoto`,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: hoursText,
    end_time_text: null,
    is_all_day: !hoursText,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
  };
}

function extractTakaIshiiEvent(detailHtml, source, detailUrl) {
  const title = stripTags(
    selectorTextValues(detailHtml, ['.heading02'])[0] ??
      detailHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ??
      extractMeta(detailHtml, 'og:title') ??
      '',
  )
    .replace(/\s*[|｜/].*$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!title) {
    throw new Error('Could not extract event title from Taka Ishii Gallery detail page');
  }

  const pageText = stripTags(detailHtml);
  const dateText = pageText.match(/Dates:\s*([^\n]+)/i)?.[1]?.trim() ?? 'See source page';
  const locationText = pageText.match(/Location:\s*([^\n]+)/i)?.[1]?.trim() ?? source.name;
  const appointmentText = pageText.match(/Appointment required\.[^\n]*/i)?.[0] ?? null;
  const description = extractGenericDescription(detailHtml);
  const imageUrls = finalizeImageUrls(
    [
      ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"/gi)].map(
        (match) => ({
          url: match[1],
          source: 'img',
        }),
      ),
    ],
    detailUrl,
  );
  const parsedDates = parseEnglishMonthDateRangeWithOptionalStartYear(dateText);

  return {
    title,
    categories: ['exhibition', 'gallery'],
    description: appointmentText ? `${appointmentText}\n\n${description}`.trim() : description,
    institution_name: source.name,
    venue_name: locationText,
    address_text: source.address_text ?? locationText,
    directions_query: source.directions_query ?? `${locationText}, Kyoto`,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
  };
}

function extractKyohakuEvent(detailHtml, source, detailUrl) {
  const title = stripTags(
    detailHtml.match(/<dt>Exhibition Title<\/dt>\s*<dd>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? '',
  );

  if (!title) {
    throw new Error('Could not extract event title from Kyoto National Museum detail page');
  }

  const dateText =
    stripTags(detailHtml.match(/<dt>Period<\/dt>\s*<dd>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? '')
      .split('\n')[0]
      .trim() || 'See source page';

  const descriptionSection =
    detailHtml.match(
      /<h2 class="titleBg gold large" id="Contents02">Description of Exhibition<\/h2>([\s\S]*?)(?:<div class="imgPosition">|<h3|<div class="wallBelt|<footer)/i,
    )?.[1] ?? '';

  const description = [...descriptionSection.matchAll(/<p>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]))
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 3)
    .join('\n\n');

  const venueName =
    stripTags(detailHtml.match(/<dt>Venue<\/dt>\s*<dd>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? '') ||
    source.name;

  const imageCandidates = [
    ...detailHtml.matchAll(/<img[^>]+src="([^"]*\/exhibitions\/[^"]+)"/gi),
  ].map((match) => ({
    url: match[1],
    source: 'img',
  }));
  const nonFlyerImageCandidates = imageCandidates.slice(1);
  const acceptedImageUrls = new Set(finalizeImageUrls(nonFlyerImageCandidates, detailUrl));
  const imageUrls = [
    ...new Set(
      nonFlyerImageCandidates
        .map((candidate) => normalizeUrl(candidate.url, detailUrl))
        .filter((url) => url && acceptedImageUrls.has(url)),
    ),
  ].slice(0, MAX_IMAGES_PER_EVENT);

  const parsedDates = parseEnglishMonthDateRange(dateText);

  return {
    title,
    categories: ['exhibition', 'museum', 'special-exhibition'],
    description: description || extractGenericDescription(detailHtml),
    institution_name: source.name,
    venue_name: venueName,
    address_text: source.address_text ?? source.name,
    directions_query: source.directions_query ?? `${source.name}, Kyoto`,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: '9:00-17:30',
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
  };
}

function extractKyoceraDetailUrls(listingHtml, listingUrl) {
  const matches = [
    ...listingHtml.matchAll(
      /(?:https:\/\/kyotocity-kyocera\.museum)?\/(?:en\/)?exhibition\/\d{8}-\d{8}/g,
    ),
  ].map((match) => new URL(match[0], listingUrl).toString());

  if (!matches.length) {
    throw new Error(
      'Could not find Kyoto City KYOCERA Museum of Art detail URLs on the listing page',
    );
  }

  return [...new Set(matches)];
}

function parseDddScheduleEntries(listingHtml, listingUrl) {
  return [
    ...listingHtml.matchAll(
      /<div class="ttl-cmn-exhibition-wrap[\s\S]*?<\/div><!-- \/ttl-cmn-exhibition-wrap -->/gi,
    ),
  ]
    .map((match) => {
      const block = match[0];
      const href = block.match(/<a href="([^"]+)"/i)?.[1] ?? null;
      const seriesTitle = stripTags(
        block.match(/<span class="ttl01">([\s\S]*?)<\/span>/i)?.[1] ?? '',
      );
      const title = stripTags(block.match(/<span class="ttl02">([\s\S]*?)<\/span>/i)?.[1] ?? '');
      const dateText =
        stripTags(block.match(/<p class="date">([\s\S]*?)<\/p>/i)?.[1] ?? '') || 'See source page';

      return {
        href: href ? normalizeUrl(href, listingUrl) : null,
        seriesTitle,
        title,
        dateText,
      };
    })
    .filter((entry) => entry.title);
}

function extractDddDetailUrls(listingHtml, listingUrl) {
  return parseDddScheduleEntries(listingHtml, listingUrl)
    .slice(0, 2)
    .map((entry, index) => entry.href ?? `${listingUrl}#ddd-schedule-${index + 1}`);
}

function extractKyoceraFooterAddress(detailHtml) {
  const footerInfo = detailHtml.match(/<p class="footer_info">([\s\S]*?)<\/p>/i)?.[1];
  if (!footerInfo) return null;

  const lines = stripTags(footerInfo)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) => /\bKyoto\b/.test(line) && /\d{3}-\d{4}/.test(line)) ?? null;
}

function extractKyoceraEvent(detailHtml, source, detailUrl) {
  const titleBlock = extractClassBlock(detailHtml, 'exhibition_title', 'h1');
  const titleLines = titleBlock
    ? stripTags(titleBlock)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  const title = titleLines[0] ?? null;

  if (!title) {
    throw new Error('Could not extract event title from Kyoto City KYOCERA Museum of Art page');
  }

  const subtitleBlocks = [
    ...detailHtml.matchAll(/<p class="exhibition_subTitle">([\s\S]*?)<\/p>/gi),
  ]
    .map((match) => stripTags(match[1]))
    .filter(Boolean);

  const dateText =
    stripTags(extractClassBlock(detailHtml, 'exhibition_date', 'p') ?? '') || 'See source page';
  const venueName =
    stripTags(extractClassBlock(detailHtml, 'exhibition_venue', 'p') ?? '')
      .replace(/^Venue\s*\[/i, '')
      .replace(/\]$/i, '')
      .trim() || null;
  const heading = stripTags(extractClassBlock(detailHtml, 'cont_heading', 'h3') ?? '');
  const descriptionHtml =
    detailHtml.match(
      /<div class="tab_cont_inner cont_col2 post_catch">[\s\S]*?<div class="cont_desc">([\s\S]*?)<\/div>/i,
    )?.[1] ??
    extractDefinitionValue(detailHtml, 'Period') ??
    extractMeta(detailHtml, 'og:description') ??
    '';

  const timeText = stripTags(extractDefinitionValue(detailHtml, 'Time') ?? '') || null;
  const mainContentHtml =
    detailHtml.match(
      /<main\b(?=[^>]*\bcontMain\b)(?=[^>]*\bcont_post\b)[^>]*>([\s\S]*?)<\/main>/i,
    )?.[1] ?? '';
  const allImageUrls = finalizeImageUrls(
    [
      ...[...mainContentHtml.matchAll(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"/gi)].map(
        (match) => ({
          url: match[1],
          source: 'img',
        }),
      ),
    ],
    detailUrl,
  );
  const imageUrls = allImageUrls;
  const primaryImageUrl = imageUrls[0] ?? null;

  const normalizedCategories = [
    'exhibition',
    'museum',
    ...subtitleBlocks.map((value) => value.toLowerCase()),
  ];
  const categories = [...new Set(normalizedCategories.filter(Boolean))];
  const parsedDates = parseKyoceraDateRange(dateText);
  const addressText = extractKyoceraFooterAddress(detailHtml) ?? source.address_text ?? source.name;
  const directionsQuery =
    source.directions_query ??
    (venueName ? `${venueName}, ${source.name}, Kyoto` : `${source.name}, Kyoto`);

  return {
    title,
    categories,
    description: stripTags(`${heading}\n\n${descriptionHtml}`),
    institution_name: source.name,
    venue_name: venueName,
    address_text: addressText,
    directions_query: directionsQuery,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: timeText,
    end_time_text: null,
    is_all_day: !timeText,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: primaryImageUrl,
    image_urls: imageUrls,
    source_url: detailUrl,
  };
}

function extractDddEvent(detailHtml, source, detailUrl) {
  const scheduleMatch = detailUrl.match(/#ddd-schedule-(\d+)$/);

  if (scheduleMatch) {
    const index = Number(scheduleMatch[1]) - 1;
    const entry = parseDddScheduleEntries(detailHtml, detailUrl.replace(/#.*$/, ''))[index];

    if (!entry) {
      throw new Error(`Could not extract DDD schedule entry ${index + 1}`);
    }

    const parsedDates = parseGenericDateRange(entry.dateText);

    return {
      external_id: `ddd-schedule-${index + 1}`,
      title: entry.title,
      categories: ['exhibition', 'gallery', 'design'],
      description: entry.seriesTitle || 'Upcoming exhibition listed on the DDD schedule page.',
      institution_name: source.name,
      venue_name: source.name,
      address_text: source.address_text ?? source.name,
      directions_query: source.directions_query ?? source.name,
      date_text: entry.dateText,
      start_date: parsedDates.startDate,
      end_date: parsedDates.endDate,
      start_time_text: null,
      end_time_text: null,
      is_all_day: true,
      timezone: 'Asia/Tokyo',
      ...buildScheduleFields({
        startDate: parsedDates.startDate,
        endDate: parsedDates.endDate,
      }),
      calendar_starts_at: parsedDates.calendarStartsAt,
      calendar_ends_at: parsedDates.calendarEndsAt,
      primary_image_url: null,
      image_urls: [],
      source_url: detailUrl.replace(/#.*$/, ''),
    };
  }

  const title = stripTags(
    detailHtml.match(/<span class="ttl-cmn-01">([\s\S]*?)<\/span>/i)?.[1] ??
      extractMeta(detailHtml, 'og:title') ??
      '',
  )
    .replace(/\s+\|\s+kyoto ddd gallery$/i, '')
    .trim();

  if (!title) {
    throw new Error('Could not extract DDD exhibition title');
  }

  const dateText =
    stripTags(detailHtml.match(/<p class="date">([\s\S]*?)<\/p>/i)?.[1] ?? '') || 'See source page';
  const parsedDates = parseGenericDateRange(dateText);
  const description = stripTags(
    extractMeta(detailHtml, 'og:description') ??
      detailHtml.match(/<div class="txt">[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] ??
      '',
  ).slice(0, 1200);
  const imageUrl =
    finalizeImageUrls(
      [{ url: extractMeta(detailHtml, 'og:image'), source: 'og:image' }],
      detailUrl,
    )[0] ?? null;

  return {
    title,
    categories: ['exhibition', 'gallery', 'design'],
    description,
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: source.directions_query ?? source.name,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrl,
    image_urls: imageUrl ? [imageUrl] : [],
    source_url: detailUrl,
  };
}

function extractMomakDetailUrls(listingHtml, listingUrl) {
  const matches = [...listingHtml.matchAll(/https:\/\/www\.momak\.go\.jp\/English\/\?p=(\d+)/g)]
    .map((match) => {
      const id = Number(match[1]);
      return id > 0 ? new URL(match[0], listingUrl).toString() : null;
    })
    .filter(Boolean);

  if (!matches.length) {
    throw new Error('Could not find MoMAK detail URLs on the listing page');
  }

  return [...new Set(matches)];
}

function extractMomakAddress(accessHtml) {
  const match = accessHtml.match(
    /<h3 class="access">The National Museum of Modern Art, Kyoto<\/h3>\s*<p>([\s\S]*?)<\/p>/i,
  );

  if (!match) return null;
  return stripTags(match[1]);
}

function extractMomakGoogleMapsUrl(accessHtml) {
  return (
    accessHtml.match(/<a class="map-link" href="([^"]+)"/i)?.[1] ??
    'https://www.google.com/maps/place/National+Museum+of+Modern+Art,+Kyoto'
  );
}

function extractSenOkuDetailUrls(listingHtml, listingUrl) {
  const matches = [
    ...listingHtml.matchAll(/https:\/\/(?:www\.)?sen-oku\.or\.jp\/program\/[A-Za-z0-9_./-]+/g),
  ]
    .map((match) => new URL(match[0], listingUrl).toString())
    .filter((url) => /\/program\/[^/]+\/?$/.test(url));

  if (!matches.length) {
    throw new Error('Could not find Sen-Oku Hakukokan Museum detail URLs on the listing page');
  }

  return [...new Set(matches)];
}

function extractSenOkuAddress(accessHtml) {
  const postalCode = stripTags(accessHtml.match(/〒\s*&nbsp;\s*(\d{3}-\d{4})/i)?.[1] ?? '');
  const streetAddress = stripTags(
    accessHtml.match(/<div class="address">\s*〒[\s\S]*?<br>\s*([\s\S]*?)\s*<\/div>/i)?.[1] ?? '',
  );

  if (!postalCode && !streetAddress) return null;
  return [postalCode, streetAddress].filter(Boolean).join(' ');
}

function extractMomakEvent(detailHtml, source, detailUrl, context = {}) {
  const scTitle = detailHtml.match(/<section id="scTitle"[\s\S]*?<\/section>/i)?.[0] ?? '';
  const scTitleParagraphs = [...scTitle.matchAll(/<p>([\s\S]*?)<\/p>/gi)].map((match) =>
    stripTags(match[1]),
  );
  const title = scTitleParagraphs[1] ?? '';

  if (!title) {
    throw new Error('Could not extract event title from MoMAK detail page');
  }

  const dateText =
    scTitleParagraphs.find((paragraph) => /\d{4}\.\d{2}\.\d{2}/.test(paragraph)) ??
    'See source page';

  const description = stripTags(
    detailHtml.match(/<div class="description">[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] ?? '',
  );

  const uniqueImageUrls = finalizeImageUrls(
    [
      {
        url: detailHtml.match(/<section id="scMainImg"[\s\S]*?<img src="([^"]+)"/i)?.[1],
        source: 'img',
      },
      ...[...detailHtml.matchAll(/<img src="([^"]*wp-content\/uploads[^"]+)"/gi)].map((match) => ({
        url: match[1],
        source: 'img',
      })),
    ],
    detailUrl,
  );

  const parsedDates = parseMomakDateRange(dateText);
  const addressText =
    (context.accessHtml ? extractMomakAddress(context.accessHtml) : null) ??
    source.address_text ??
    source.name;
  const directionsQuery =
    source.directions_query ?? extractMomakGoogleMapsUrl(context.accessHtml ?? '');

  return {
    title,
    categories: ['exhibition', 'museum', 'modern-art'],
    description,
    institution_name: source.name,
    venue_name: source.name,
    address_text: addressText,
    directions_query: directionsQuery,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: '10:00-18:00',
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: uniqueImageUrls[0] ?? null,
    image_urls: uniqueImageUrls,
    source_url: detailUrl,
  };
}

function extractSenOkuEvent(detailHtml, source, detailUrl, context = {}) {
  const catchHtml =
    detailHtml.match(
      /<div class="catchArea wrap">[\s\S]*?<div class="catch">([\s\S]*?)<\/div>\s*<div class="dataSetList">/i,
    )?.[1] ?? '';
  const titleHtml =
    catchHtml.match(/<font\b[^>]*>([\s\S]*?)<\/font>/i)?.[1] ??
    catchHtml.replace(/<span\b[^>]*>[\s\S]*?<\/span>/gi, '');
  const title = stripTags(titleHtml);

  if (!title) {
    throw new Error('Could not extract event title from Sen-Oku Hakukokan Museum page');
  }

  const dateParts = [
    ...detailHtml.matchAll(/<span class="num">(\d{4}\.\d{1,2}\.\d{1,2})<\/span>/gi),
  ].map((match) => match[1]);
  const dateText =
    dateParts.length > 1
      ? `${dateParts[0]} - ${dateParts[1]}`
      : (dateParts[0] ?? 'See source page');
  const venueName =
    stripTags(detailHtml.match(/<div class="spot">([\s\S]*?)<\/div>/i)?.[1] ?? '') || source.name;
  const description = stripTags(
    detailHtml.match(/<div class="leadArea">\s*<p class="copy">\s*([\s\S]*?)<\/p>/i)?.[1] ??
      extractMeta(detailHtml, 'og:description') ??
      '',
  );

  const allImageUrls = finalizeImageUrls(
    [
      ...(sourceShouldSkipOgImages(source)
        ? []
        : [{ url: extractMeta(detailHtml, 'og:image'), source: 'og:image' }]),
      ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"/gi)].map(
        (match) => ({
          url: match[1],
          source: 'img',
        }),
      ),
    ],
    detailUrl,
    { preserveOrder: true },
  );
  const uniqueImageUrls = allImageUrls.length > 1 ? allImageUrls.slice(0, -1) : allImageUrls;
  const parsedDates = parseDottedDateRange(dateText);
  const addressText =
    (context.accessHtml ? extractSenOkuAddress(context.accessHtml) : null) ??
    source.address_text ??
    source.name;

  return {
    title,
    categories: ['exhibition', 'museum'],
    description,
    institution_name: source.name,
    venue_name: venueName,
    address_text: addressText,
    directions_query: source.directions_query ?? 'https://maps.app.goo.gl/xh91N3FpPHUAhiqZA',
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: uniqueImageUrls[0] ?? null,
    image_urls: uniqueImageUrls,
    source_url: detailUrl,
  };
}

function cleanTitleCandidate(value, source) {
  let title = stripTags(String(value ?? ''))
    .replace(/\s*[|｜\-–—]\s*KYOTOGRAPHIE 京都国際写真祭$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  for (const sourceName of [source?.name, ...Object.values(source?.names ?? {})].filter(Boolean)) {
    const escapedSourceName = String(sourceName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    title = title.replace(new RegExp(`\\s*[|｜\\-–—]\\s*${escapedSourceName}$`, 'i'), '').trim();
  }

  return title;
}

function extractJsonLdEventTitles(detailHtml, detailUrl = null) {
  const titles = [];
  let index = 0;
  const visit = (value, matchesParentMainEntity = false) => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item, matchesParentMainEntity));
    if (!value || typeof value !== 'object') return;

    if (isEventJsonLdType(value)) {
      const ownScore = jsonLdPageMatchScore(value, detailUrl);
      if (typeof value.name === 'string' && ownScore > 0) {
        titles.push({
          value: value.name,
          score: Math.max(ownScore, matchesParentMainEntity ? 2 : 0),
          index,
        });
        index += 1;
      }
      return;
    }

    const nodeMatchesPage = jsonLdPageMatchScore(value, detailUrl) === 2;
    if (value.mainEntity) visit(value.mainEntity, matchesParentMainEntity || nodeMatchesPage);
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'mainEntity') visit(child, false);
    }
  };

  for (const match of detailHtml.matchAll(
    /<script\b[^>]*type=(['"])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse(match[2]));
    } catch {
      // Invalid third-party JSON-LD. Continue with visible page content.
    }
  }

  return titles
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((candidate) => candidate.value);
}

function titleQualityWarnings(value, source) {
  const title = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return ['missing'];

  const warnings = [];
  const normalizedTitle = title.normalize('NFKC').replace(/\s+/g, ' ').trim();
  const unprefixedTitle = normalizedTitle.replace(/^(?:category|tag)\s*:\s*/iu, '').trim();
  if (/^(?:category|tag)\s*:/iu.test(normalizedTitle)) warnings.push('taxonomy_label');
  if (
    /^(?:(?:current|upcoming|past|future|special)\s+)?(?:exhibitions?|events?)$|^(?:event|exhibition)\s+(?:information|schedule)$|^news(?:\s*(?:&|and)\s*topics)?$|^mail\s+news$|^(?:information|schedule|program|archive|blog|current|upcoming|past|coming soon|top\s*\/\s*coming soon(?:\s*-\s*top)?)$|^(?:展覧会(?:情報|スケジュール)?|展示(?:情報)?|イベント(?:情報)?|開催中(?:の展覧会)?|開催予定(?:の展覧会)?|今後の開催予定|これからの展覧会|これまでの展覧会|次回の展示|みどころ)$/iu.test(
      unprefixedTitle,
    )
  ) {
    warnings.push('generic_label');
  }

  const normalizedTitleKey = normalizedTitle.toLocaleLowerCase();
  const sourceNames = [source?.name, ...Object.values(source?.names ?? {})]
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => name.normalize('NFKC').toLocaleLowerCase());
  if (sourceNames.includes(normalizedTitleKey)) warnings.push('matches_source_name');

  const parsedDate = parseGenericDateRange(extractFirstDateText(title));
  const nonDateText = title
    .normalize('NFKC')
    .replace(
      /(?:current|upcoming|past|special|exhibitions?|events?|event information|schedule|program|archive|展覧会(?:情報)?|展示(?:情報)?|イベント(?:情報)?|開催中|開催予定)/giu,
      '',
    )
    .replace(
      /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/giu,
      '',
    )
    .replace(/(?:京都|大阪|東京|kyoto|osaka|tokyo|ginza|roppongi|shinjuku|shibuya)/giu, '')
    .replace(/[0-9年月日時分日月火水木金土曜祝〜~～–—.,/\\:\-|｜\s()[\]（）]+/gu, '');
  if (parsedDate.startDate && !nonDateText) warnings.push('date_or_location_only');
  if (/^(?:京都|大阪|東京|kyoto|osaka|tokyo|ginza|roppongi|shinjuku|shibuya)$/iu.test(title)) {
    warnings.push('location_only');
  }

  return [...new Set(warnings)];
}

function extractGenericTitleInfo(detailHtml, source, detailUrl = null) {
  const candidates = [
    ...selectorTextValues(detailHtml, selectorsFor(source, 'title')).map((value) => ({
      value,
      origin: 'configured_selector',
    })),
    ...selectorTextValues(detailHtml, [
      '[itemtype*="Event"] [itemprop="name"]',
      '[typeof*="Event"] [property="name"]',
    ]).map((value) => ({
      value,
      origin: 'structured_dom',
    })),
    ...selectorTextValues(detailHtml, ['article h1', 'article h2', 'article h3', 'main h1']).map(
      (value) => ({
        value,
        origin: 'scoped_heading',
      }),
    ),
    ...extractJsonLdEventTitles(detailHtml, detailUrl).map((value) => ({
      value,
      origin: 'json_ld',
    })),
    ...selectorTextValues(detailHtml, ['main h2', 'main h3']).map((value) => ({
      value,
      origin: 'scoped_heading',
    })),
    ...selectorTextValues(detailHtml, ['h1']).map((value) => ({
      value,
      origin: 'page_heading',
    })),
    { value: decodeHtml(extractMeta(detailHtml, 'og:title') ?? ''), origin: 'og_title' },
    {
      value: stripTags(detailHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ''),
      origin: 'document_title',
    },
  ]
    .map((candidate) => ({
      ...candidate,
      title: cleanTitleCandidate(candidate.value, source),
    }))
    .filter((candidate, index, all) => {
      if (!candidate.title) return false;
      return all.findIndex((item) => item.title === candidate.title) === index;
    })
    .map((candidate) => ({
      ...candidate,
      warnings: titleQualityWarnings(candidate.title, source),
    }));

  const selected = candidates.find((candidate) => !candidate.warnings.length) ?? candidates[0];
  const title = selected?.title || source.name;

  return {
    title,
    origin: selected?.origin ?? 'source_fallback',
    warnings: selected?.warnings ?? titleQualityWarnings(title, source),
    candidates: candidates.slice(0, 8).map(({ title: candidateTitle, origin, warnings }) => ({
      title: candidateTitle,
      origin,
      warnings,
    })),
  };
}

function assessEventTitle(eventData, source, fallbackOrigin = 'source_specific_extractor') {
  const title = String(eventData?.title ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const warnings = titleQualityWarnings(title, source);

  return {
    ...eventData,
    title,
    _title_origin: eventData?._title_origin ?? fallbackOrigin,
    _title_warnings: warnings,
    _title_valid: warnings.length === 0,
  };
}

function hasValidEventTitle(eventData) {
  return eventData?._title_valid !== false && titleQualityWarnings(eventData?.title).length === 0;
}

function normalizeDescriptionComparison(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function cleanDescriptionCandidate(value) {
  return decodeHtml(String(value ?? ''))
    .replace(/\r/g, '')
    .replace(/\n\s*\n/g, '\uE000')
    .replace(/\s+/g, ' ')
    .replaceAll('\uE000', '\n\n')
    .trim()
    .slice(0, 1200);
}

function descriptionQualityWarnings(value, eventData = {}, source = {}) {
  const description = cleanDescriptionCandidate(value);
  if (!description) return ['missing'];

  const warnings = [];
  const normalized = normalizeDescriptionComparison(description);
  if (normalized.length < 6) warnings.push('too_short');
  if (/(?:copyright|all rights reserved|privacy policy|cookie policy)/iu.test(description)) {
    warnings.push('site_boilerplate');
  }
  if (
    description.length <= 200 &&
    /(?:掲載作品|\d+(?:\.\d+)?\s*(?:cm|mm)?\s*[×x]\s*\d+(?:\.\d+)?)/iu.test(description)
  ) {
    warnings.push('image_caption');
  }
  const structuredValues = [
    eventData.title,
    eventData.date_text,
    eventData.venue_name,
    eventData.institution_name,
    eventData.address_text,
    source.name,
    ...Object.values(source.names ?? {}),
  ]
    .map(normalizeDescriptionComparison)
    .filter((item) => item.length >= 3)
    .sort((a, b) => b.length - a.length);

  if (structuredValues.includes(normalized)) warnings.push('matches_structured_field');
  if (
    /^(?:current|upcoming|past|future|coming soon|exhibitions?|events?|schedule|program|archive|hours?(?:\s*&\s*admissions?)?|admissions?|access|location|展覧会(?:情報)?|展示(?:情報)?|イベント(?:情報)?|開催中|開催予定|会期|会場|開館時間)$/iu.test(
      description,
    )
  ) {
    warnings.push('generic_label');
  }

  const structuredLabels =
    description.match(
      /(?:会期|開催期間|日時|時間|場所|会場|休廊|休館|入場|備考|助成金|exhibition|venue|dates?|period|hours?|location|admission|schedule)\s*[|｜:：]?/giu,
    ) ?? [];
  if (
    description.length <= 500 &&
    structuredLabels.length >= 2 &&
    !/[。.!?！？]/u.test(description)
  ) {
    warnings.push('structured_fields_only');
  }

  let remainder = normalized;
  for (const structuredValue of structuredValues) {
    remainder = remainder.replaceAll(structuredValue, '');
  }
  remainder = remainder.replace(
    /(?:会期|開催期間|日時|時間|場所|会場|休廊|休館|入場無料?|備考|助成金|exhibition|venue|dates?|period|hours?|location|open|closed|admission|schedule)/giu,
    '',
  );
  if (
    description.length <= 500 &&
    remainder.length <= Math.max(4, Math.floor(normalized.length * 0.08)) &&
    structuredValues.some((item) => normalized.includes(item))
  ) {
    warnings.push('structured_fields_only');
  }

  const dateText = extractFirstDateText(description);
  if (dateText !== 'See source page') {
    const dateRemainder = description
      .replace(dateText, '')
      .replace(
        /\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/giu,
        '',
      )
      .replace(/(?:会期|開催期間|日時|時間|休廊|休館|年月日|曜日?)/gu, '')
      .replace(/[\d\s\p{P}\p{S}年月日時分日月火水木金土曜祝]/gu, '');
    if (normalizeDescriptionComparison(dateRemainder).length < 6) warnings.push('date_only');
  }

  if (/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\d{1,2}:\d{2}/iu.test(description)) {
    const hoursRemainder = description
      .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/giu, '')
      .replace(/\d{1,2}:\d{2}/gu, '')
      .replace(
        /(?:hours?|open|closed|last entry|fridays?|saturdays?|sundays?|weekdays?|時間|開館|閉館|入館|最終)/giu,
        '',
      )
      .replace(/[\d\s\p{P}\p{S}年月日時分日月火水木金土曜祝]/gu, '');
    if (normalizeDescriptionComparison(hoursRemainder).length < 10) warnings.push('hours_only');
  }

  if (
    description.length <= 300 &&
    /(?:official (?:web)?site|公式(?:ウェブ)?サイト|(?:サイト|ページ)です[。.]?$)/iu.test(
      description,
    )
  ) {
    warnings.push('site_boilerplate');
  }

  return [...new Set(warnings)];
}

function extractJsonLdEventDescriptions(detailHtml) {
  const descriptions = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object') return;

    const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
    if (
      types.some((type) => typeof type === 'string' && /(?:Event|Exhibition)$/i.test(type)) &&
      typeof value.description === 'string'
    ) {
      descriptions.push(value.description);
    }
    Object.values(value).forEach(visit);
  };

  for (const match of String(detailHtml ?? '').matchAll(
    /<script\b[^>]*type=(['"])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      visit(JSON.parse(match[2]));
    } catch {
      // Invalid third-party JSON-LD. Continue with visible page content.
    }
  }

  return descriptions;
}

function descriptionMatchesTitle(value, eventData, source) {
  const description = String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase();
  const ignoredTerms = new Set([
    'art',
    'event',
    'exhibition',
    'gallery',
    'museum',
    'special',
    'title',
    '展覧会',
    '展示',
    ...String(source?.name ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u),
  ]);
  const terms = String(eventData?.title ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length >= 3 && !/^\d+$/u.test(term) && !ignoredTerms.has(term));

  return terms.some((term) => description.includes(term));
}

function looksLikeDescriptionProse(value) {
  return (
    /\b(?:is|are|was|were|will|presents?|features?|explores?|brings?|gathers?|introduces?|showcases?|examines?|includes?|focuses?|traces?|continues?)\b/iu.test(
      value,
    ) || /(?:です|ます|ました|します|されます|紹介します|開催します|展示します|展覧会)/u.test(value)
  );
}

function extractBodyDescription(html, eventData, source) {
  if (!html) return null;

  const scopedHtml = selectElements(html, 'main, article');
  const fragments = scopedHtml.length ? scopedHtml : [html];
  const paragraphs = fragments
    .flatMap((fragment) => [...fragment.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)])
    .map((match) => cleanDescriptionCandidate(stripTags(match[1])))
    .filter((value) => normalizeDescriptionComparison(value).length >= 20)
    .filter((value, index, all) => all.indexOf(value) === index)
    .filter((value) => descriptionQualityWarnings(value, eventData, source).length === 0)
    .filter(
      (value) =>
        descriptionMatchesTitle(value, eventData, source) || looksLikeDescriptionProse(value),
    )
    .map((value, index) => ({
      value,
      index,
      score:
        Math.min(normalizeDescriptionComparison(value).length, 200) +
        (descriptionMatchesTitle(value, eventData, source) ? 300 : 0) +
        (/[。.!?！？]/u.test(value) ? 50 : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((paragraph) => paragraph.value);

  return paragraphs.slice(0, 2).join('\n\n') || null;
}

function resolveEventDescription(eventData, source, page = {}) {
  const html = page.html ?? '';
  const configuredDescription = selectorTextValues(html, selectorsFor(source, 'description'))
    .slice(0, 2)
    .join('\n\n');
  const existingOrigin = eventData?._description_origin ?? 'source_specific_extractor';
  const existingCandidate = { value: eventData?.description, origin: existingOrigin };
  const candidates = [
    { value: configuredDescription, origin: 'configured_selector' },
    ...(existingOrigin === 'source_specific_extractor' ? [existingCandidate] : []),
    { value: extractBodyDescription(page.fitHtml, eventData, source), origin: 'crawl4ai_fit' },
    {
      value: extractBodyDescription(page.cleanedHtml, eventData, source),
      origin: 'crawl4ai_cleaned',
    },
    { value: extractBodyDescription(html, eventData, source), origin: 'page_body' },
    ...extractJsonLdEventDescriptions(html).map((value) => ({ value, origin: 'json_ld' })),
    { value: extractMeta(html, 'og:description'), origin: 'og_description' },
    { value: extractMeta(html, 'description'), origin: 'meta_description' },
    ...(existingOrigin === 'source_specific_extractor' ? [] : [existingCandidate]),
  ]
    .map((candidate) => ({
      ...candidate,
      value: cleanDescriptionCandidate(candidate.value),
    }))
    .filter((candidate, index, all) => {
      if (!candidate.value) return false;
      const normalized = normalizeDescriptionComparison(candidate.value);
      return (
        all.findIndex(
          (item) => item.value && normalizeDescriptionComparison(item.value) === normalized,
        ) === index
      );
    })
    .map((candidate) => ({
      ...candidate,
      warnings: descriptionQualityWarnings(candidate.value, eventData, source),
    }));
  const selected = candidates.find((candidate) => candidate.warnings.length === 0);
  const rejected = candidates.filter((candidate) => candidate.warnings.length > 0);
  const initialWarnings = descriptionQualityWarnings(eventData?.description, eventData, source);

  return {
    ...eventData,
    description: selected?.value ?? null,
    _description_origin: selected?.origin ?? 'missing',
    _description_warnings: selected ? [] : initialWarnings,
    _description_valid: Boolean(selected),
    _description_recovered:
      Boolean(selected) && Boolean(eventData?.description) && initialWarnings.length > 0,
    _description_rejections: rejected.slice(0, 5).map((candidate) => ({
      origin: candidate.origin,
      warnings: candidate.warnings,
    })),
  };
}

function hasValidEventDescription(eventData) {
  return (
    eventData?._description_valid !== false && Boolean(String(eventData?.description ?? '').trim())
  );
}

function withSourceSpecificDescriptionOrigin(eventData) {
  if (!eventData?.description) return eventData;

  return {
    ...eventData,
    _description_origin: 'source_specific_extractor',
  };
}

function extractGenericDescription(detailHtml) {
  const metaDescription =
    extractMeta(detailHtml, 'og:description') ?? extractMeta(detailHtml, 'description');

  if (metaDescription) return stripTags(metaDescription).slice(0, 1200);

  const paragraphs = [...detailHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]))
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .filter((value) => value.length > 40);

  return paragraphs.slice(0, 2).join('\n\n').slice(0, 1200);
}

function extractConfiguredImageUrls(detailHtml, detailUrl, source) {
  const imageSelectors = selectorsFor(source, 'images');
  if (!imageSelectors.length) return [];

  const candidates = imageSelectors
    .flatMap((selector) => selectElements(detailHtml, selector))
    .flatMap((element) => [...element.matchAll(/<img\b[^>]*>/gi)])
    .map((match) => imageCandidateFromTag(match[0], 'configured'));

  return finalizeImageUrls(candidates, detailUrl, { preserveOrder: true });
}

function extractGenericEvent(detailHtml, source, detailUrl) {
  const timezone = source.timezone ?? timeZoneForCity(source.city);
  const utcOffset = timezone === 'Asia/Hong_Kong' ? '+08:00' : '+09:00';
  const withUtcOffset = (value) => value?.replace(/(?:Z|[+-]\d{2}:\d{2})$/, utcOffset) ?? null;
  const titleInfo = extractGenericTitleInfo(detailHtml, source, detailUrl);
  const configuredDescription = selectorTextValues(detailHtml, selectorsFor(source, 'description'))
    .slice(0, 2)
    .join('\n\n');
  const configuredDateText = selectorTextValues(detailHtml, selectorsFor(source, 'date'))[0];
  const configuredImageUrls = extractConfiguredImageUrls(detailHtml, detailUrl, source);
  const discoveredDate = configuredDateText
    ? null
    : extractBestDateCandidate(detailHtml, detailUrl);
  const dateText = configuredDateText || discoveredDate?.text || 'See source page';
  const parsedDates = discoveredDate?.parsed ?? parseGenericDateRange(dateText);
  const imageUrls = configuredImageUrls.length
    ? configuredImageUrls
    : extractGenericImageUrls(detailHtml, detailUrl, {
        includeOgImage: !sourceShouldSkipOgImages(source),
      });
  const directionsQuery = source.directions_query ?? `${source.name}, Kyoto`;

  const event = {
    title: titleInfo.title,
    categories: flattenTaxonomy(source.taxonomy),
    description: configuredDescription || extractGenericDescription(detailHtml),
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: directionsQuery,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone,
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: withUtcOffset(parsedDates.calendarStartsAt),
    calendar_ends_at: withUtcOffset(parsedDates.calendarEndsAt),
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
    extraction_confidence: 0.25,
    _title_origin: titleInfo.origin,
    _title_warnings: titleInfo.warnings,
    _title_valid: titleInfo.warnings.length === 0,
    _title_candidates: titleInfo.candidates,
    _description_origin: configuredDescription ? 'configured_selector' : 'generic_fallback',
    _date_origin: configuredDateText ? 'configured_selector' : (discoveredDate?.origin ?? null),
    _date_parser: parsedDates.parserId ?? null,
  };

  return resolveEventDescription(event, source, { html: detailHtml });
}

function extractKitanoEvent(detailHtml, source, detailUrl) {
  const eventId = new URL(detailUrl).hash.slice(1);
  const start = detailHtml.search(
    new RegExp(
      `<div\\b[^>]*class=(['"])[^'"]*\\bwrapper\\b[^'"]*\\1[^>]*id=(['"])${eventId}\\2`,
      'i',
    ),
  );
  const rest = start === -1 ? '' : detailHtml.slice(start);
  const next = rest
    .slice(1)
    .search(/<div\b[^>]*class=(['"])[^'"]*\bwrapper\b[^'"]*\1[^>]*id=(['"])\d{9}\2/i);
  const eventHtml = next === -1 ? rest : rest.slice(0, next + 1);
  const title = stripTags(eventHtml.match(/<h5\b[^>]*>([\s\S]*?)<\/h5>/i)?.[1] ?? '');
  const dateText = stripTags(
    eventHtml.match(/<h5\b[^>]*>[\s\S]*?<\/h5>\s*<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '',
  );
  const parsedDates = parseGenericDateRange(dateText);
  const description = stripTags(
    eventHtml.match(/<div\b[^>]*class=(['"])[^'"]*\bmt-3\b[^'"]*\1[^>]*>([\s\S]*?)<\/div>/i)?.[2] ??
      '',
  );
  const imageTag = eventHtml.match(/<img\b[^>]*>/i)?.[0] ?? '';
  const imageUrl = normalizeUrl(extractTagAttribute(imageTag, 'src'), detailUrl);

  return {
    ...extractGenericEvent(eventHtml, source, detailUrl),
    external_id: eventId,
    title,
    description,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    ...buildScheduleFields({ startDate: parsedDates.startDate, endDate: parsedDates.endDate }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrl,
    image_urls: imageUrl ? [imageUrl] : [],
    extraction_confidence: 0.95,
  };
}

function extractGalleryTakeTwoEvent(detailHtml, source, detailUrl) {
  const eventId = new URL(detailUrl).hash.slice(1);
  const item = extractGalleryTakeTwoItems(detailHtml).find(
    (candidate) => candidate?.itemId === eventId,
  );
  const title = item?.metaData?.title?.trim() ?? source.name;
  const description = item?.metaData?.description?.trim() ?? null;
  const dateText = description?.split('\n')[0]?.trim() ?? 'See source page';
  const parsedDates = parseGenericDateRange(dateText);
  const imageUrl = item?.mediaUrl ? `https://static.wixstatic.com/media/${item.mediaUrl}` : null;

  return {
    ...extractGenericEvent('', source, detailUrl),
    external_id: eventId,
    title,
    description,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    ...buildScheduleFields({ startDate: parsedDates.startDate, endDate: parsedDates.endDate }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrl,
    image_urls: imageUrl ? [imageUrl] : [],
    extraction_confidence: 0.95,
  };
}

function extractPolaMuseumAnnexEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const phases = [
    ...String(event.date_text ?? '').matchAll(
      /(?:前期|後期)[：:]\s*([\s\S]*?)(?=(?:前期|後期)[：:]|$)/gu,
    ),
  ]
    .map((match) => parseGenericDateRange(match[1]))
    .filter((phase) => phase.startDate && phase.endDate);
  const hasSplitSchedule = phases.length >= 2;
  const startDate = hasSplitSchedule ? phases[0].startDate : event.start_date;
  const endDate = hasSplitSchedule ? phases.at(-1).endDate : event.end_date;

  return {
    ...event,
    start_date: startDate,
    end_date: endDate,
    ...buildScheduleFields({ startDate, endDate }),
    ...(hasSplitSchedule
      ? {
          schedule_segments: phases.map((phase) => ({
            is_all_day: true,
            start_date: phase.startDate,
            end_date: phase.endDate,
          })),
        }
      : {}),
    calendar_starts_at: hasSplitSchedule ? phases[0].calendarStartsAt : event.calendar_starts_at,
    calendar_ends_at: hasSplitSchedule ? phases.at(-1).calendarEndsAt : event.calendar_ends_at,
    extraction_confidence: startDate && endDate ? 0.95 : 0.5,
    _date_origin: 'source_specific_extractor',
    _date_parser: hasSplitSchedule ? 'parseGenericDateRange:phases' : event._date_parser,
  };
}

function extractIsseyMiyakeKuraEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const heading =
    [...detailHtml.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)]
      .map((match) => stripTags(match[1]))
      .find((value) =>
        /20\d{2}\.\d{2}\.\d{2}\s*\|\s*ISSEY MIYAKE KYOTO\s*\|\s*KURA/i.test(value),
      ) ?? '';
  const dateText = heading.match(/20\d{2}\.\d{2}\.\d{2}/)?.[0] ?? event.date_text;
  const parsedDate = parseGenericDateRange(dateText);
  const startDate = parsedDate.startDate;
  const title = heading
    .replace(/^.*?20\d{2}\.\d{2}\.\d{2}\s*\|\s*ISSEY MIYAKE KYOTO\s*\|\s*KURA\s*/i, '')
    .trim();
  const imageUrls = extractGenericImageUrls(detailHtml, detailUrl, { includeOgImage: false })
    .filter((url) => /KURA_/i.test(url))
    .slice(0, 4);

  return {
    ...event,
    title: title || event.title,
    date_text: `${dateText} — ON VIEW`,
    start_date: startDate,
    end_date: null,
    ...buildScheduleFields({ startDate }),
    schedule_segments: startDate
      ? [{ is_all_day: true, start_date: startDate, end_date: null }]
      : [],
    calendar_starts_at: null,
    calendar_ends_at: null,
    primary_image_url: imageUrls[0] ?? event.primary_image_url,
    image_urls: imageUrls.length ? imageUrls : event.image_urls,
    extraction_confidence: 0.9,
    _date_origin: 'source_specific_extractor',
    _date_parser: parsedDate.parserId,
  };
}

function extractStandingPineEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const title = event.title.split('|')[0]?.trim();

  return {
    ...event,
    title: title || event.title,
  };
}

function extractParcoHallEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const sourceFirstImageUrl = sourceShouldSkipOgImages(source)
    ? null
    : (finalizeImageUrls(
        [{ url: extractMeta(detailHtml, 'og:image'), source: 'og:image' }],
        detailUrl,
        { preserveOrder: true },
      )[0] ?? null);
  const firstImageUrl = sourceFirstImageUrl ?? event.image_urls?.[0] ?? null;

  return {
    ...event,
    primary_image_url: firstImageUrl,
    image_urls: firstImageUrl ? [firstImageUrl] : [],
  };
}

function extractLeicaKyotoEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const parsedDates = parseGenericDateRange(
    event.date_text.replace(/\s+to\s+/i, ' – ').replace(/[～〜]/g, ' – '),
  );

  return {
    ...event,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    extraction_confidence: parsedDates.startDate ? 0.8 : event.extraction_confidence,
  };
}

function extractTwentyOneDefinitionValue(detailHtml, labels) {
  for (const match of detailHtml.matchAll(
    /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi,
  )) {
    const label = stripTags(match[1]).replace(/\s+/g, ' ').trim();
    if (labels.includes(label)) {
      return stripTags(match[2]).replace(/\s+/g, ' ').trim() || null;
    }
  }

  return null;
}

function extractTwentyOneHeadingTitle(detailHtml) {
  return (
    stripTags(
      detailHtml.match(
        /<div\b[^>]*class=(["'])[^"']*\bcntTtl\b[^"']*\1[^>]*>\s*<h3\b[^>]*>([\s\S]*?)<\/h3>/i,
      )?.[2] ?? '',
    )
      .replace(/\s+/g, ' ')
      .trim() || null
  );
}

function extractTwentyOneEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const title =
    extractTwentyOneDefinitionValue(detailHtml, ['Title', 'タイトル']) ??
    extractTwentyOneHeadingTitle(detailHtml) ??
    event.title;
  const dateText = extractTwentyOneDefinitionValue(detailHtml, ['Date', '会期']) ?? event.date_text;
  const parsedDates = parseGenericDateRange(dateText);

  return {
    ...event,
    title,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    extraction_confidence: parsedDates.startDate ? 0.8 : event.extraction_confidence,
  };
}

function parseScaiOpenEndedDateRange(dateText, detailUrl) {
  const inferredYear = extractYearFromUrl(detailUrl);
  const cleaned = decodeHtml(dateText)
    .replace(/\([^)]*\)/g, '')
    .replace(
      /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?,?\s+/gi,
      '',
    )
    .replace(/&#8211;|–|—|－|ー/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const englishMatch = cleaned.match(/^(\d{1,2})\s+([A-Za-z]+)\s*-\s*$/);
  const japaneseMatch = cleaned.match(/^(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日\s*-\s*$/u);
  const parsedStart = englishMatch
    ? parseEnglishSingleDate(`${englishMatch[1]} ${englishMatch[2]} ${inferredYear ?? ''}`)
    : japaneseMatch
      ? parseJapaneseSingleDate(
          `${japaneseMatch[1] ?? inferredYear}年${japaneseMatch[2]}月${japaneseMatch[3]}日`,
        )
      : null;
  const startDate = parsedStart?.startDate ?? null;

  return {
    startDate,
    endDate: null,
    calendarStartsAt: null,
    calendarEndsAt: null,
    openEnded: Boolean(startDate),
    parserId: startDate ? 'parseScaiOpenEndedDateRange' : null,
  };
}

function parseScaiDateRange(dateText, detailUrl) {
  const openEnded = parseScaiOpenEndedDateRange(dateText, detailUrl);
  if (openEnded.startDate) return openEnded;

  return parseGenericDateRange(dateText);
}

function extractScaiTitleInfo(detailHtml) {
  const titleInfoStart = detailHtml.search(/class=(["'])[^"']*\btitle_info\b[^"']*\1/i);
  const titleInfoHtml =
    titleInfoStart === -1 ? detailHtml : detailHtml.slice(titleInfoStart, titleInfoStart + 5000);
  const title = stripTags(titleInfoHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const dateText = stripTags(
    titleInfoHtml.match(
      /<div\b[^>]*class=(["'])[^"']*\bduration\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/i,
    )?.[2] ?? '',
  )
    .replace(/\s+/g, ' ')
    .trim();

  return { title, dateText };
}

function extractScaiEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const titleInfo = extractScaiTitleInfo(detailHtml);
  const title = titleInfo.title || event.title;
  const dateText = titleInfo.dateText || event.date_text;
  const parsedDates = parseScaiDateRange(dateText, detailUrl);
  const scheduleFields = buildScheduleFields({
    startDate: parsedDates.startDate,
    endDate: parsedDates.endDate,
  });
  const sourceFirstImageUrl = sourceShouldSkipOgImages(source)
    ? null
    : (finalizeImageUrls(
        [{ url: extractMeta(detailHtml, 'og:image'), source: 'og:image' }],
        detailUrl,
        { preserveOrder: true },
      )[0] ?? null);
  const firstImageUrl =
    sourceFirstImageUrl ?? event.image_urls?.[0] ?? event.primary_image_url ?? null;

  return {
    ...event,
    title,
    date_text: dateText,
    primary_image_url: firstImageUrl,
    image_urls: firstImageUrl ? [firstImageUrl] : [],
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    ...scheduleFields,
    ...(parsedDates.openEnded
      ? {
          schedule_segments: [
            {
              is_all_day: true,
              start_date: parsedDates.startDate,
              end_date: null,
            },
          ],
        }
      : {}),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    extraction_confidence: parsedDates.startDate ? 0.78 : event.extraction_confidence,
    _date_origin: 'source_specific_extractor',
    _date_parser: parsedDates.parserId ?? 'parseGenericDateRange',
  };
}

function extractSnowContentHtml(detailHtml) {
  return (
    detailHtml.match(/<div\b[^>]*id=(["'])boxEX1\1[^>]*>([\s\S]*?)<\/div>/i)?.[2] ?? detailHtml
  );
}

function extractSnowContemporaryEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const contentHtml = extractSnowContentHtml(detailHtml);
  const heading = stripTags(contentHtml.match(/<strong\b[^>]*>([\s\S]*?)<\/strong>/i)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  const title = heading.match(/["“]([^"”]+)["”]/u)?.[1]?.trim() || event.title;
  const dateText =
    stripTags(contentHtml)
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .find((line) => /^session[：:]/i.test(line)) ?? event.date_text;
  const parsedDates = parseGenericDateRange(dateText);
  const [, startTime, endTime] = dateText.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/) ?? [];

  return {
    ...event,
    title,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: startTime ?? event.start_time_text,
    end_time_text: endTime ?? event.end_time_text,
    is_all_day: startTime ? false : event.is_all_day,
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at:
      parsedDates.startDate && startTime
        ? `${parsedDates.startDate}T${startTime}:00+09:00`
        : parsedDates.calendarStartsAt,
    calendar_ends_at:
      parsedDates.endDate && endTime
        ? `${parsedDates.endDate}T${endTime}:00+09:00`
        : parsedDates.calendarEndsAt,
    extraction_confidence: parsedDates.startDate ? 0.78 : event.extraction_confidence,
  };
}

function extractHakariContentHtml(detailHtml) {
  const contentStart = detailHtml.search(/<div\b[^>]*class=["'][^"']*\bpost_content\b/i);
  if (contentStart === -1) return detailHtml;

  const scopedHtml = detailHtml.slice(contentStart);
  const contentEnd = scopedHtml.search(/<footer\b|<div\b[^>]*\bid=["']comments["']/i);
  return contentEnd === -1 ? scopedHtml : scopedHtml.slice(0, contentEnd);
}

function extractHakariImageUrls(detailHtml, detailUrl) {
  const contentHtml = extractHakariContentHtml(detailHtml);
  const imageUrls = [];

  for (const match of contentHtml.matchAll(/<img\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const { width, height } = getImageAttributeDimensions(attributes);
    const candidateUrl =
      attributes['data-src'] ??
      attributes['data-original'] ??
      attributes['data-lazy-src'] ??
      attributes.src ??
      null;
    const url = candidateUrl ? normalizeUrl(candidateUrl, detailUrl) : null;
    if (!url) continue;
    if (looksLikeSocialOrUiImage(url)) continue;
    if (isSmallImageCandidate({ url, width, height, source: 'img' }, url)) continue;
    if (!imageUrls.includes(url)) imageUrls.push(url);
  }

  return imageUrls.slice(0, MAX_IMAGES_PER_EVENT);
}

function extractHakariDescription(detailHtml) {
  const paragraphs = [
    ...extractHakariContentHtml(detailHtml).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi),
  ]
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const introIndex = paragraphs.findIndex((paragraph) =>
    /^(?:このたび[、,]?\s*hakari contemporary|hakari contemporary (?:is pleased|presents|will present))/iu.test(
      paragraph,
    ),
  );

  if (introIndex === -1) return null;

  const description = [];
  for (const paragraph of paragraphs.slice(introIndex)) {
    if (
      description.length &&
      /^hakari contemporary (?:is pleased|presents|will present)/iu.test(paragraph)
    ) {
      break;
    }
    description.push(paragraph);
    if (description.length === 5) break;
  }

  return description.join('\n\n').slice(0, 1200) || null;
}

function extractHakariDateText(detailHtml) {
  const contentText = stripTags(extractHakariContentHtml(detailHtml));
  const monthRange = contentText.match(
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}\s*[-–—]\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2},\s*20\d{2}\b/i,
  );

  return monthRange?.[0].replace(/\b([A-Za-z]{3,4})\./g, '$1') ?? null;
}

function extractHakariEvent(detailHtml, source, detailUrl) {
  let event = extractGenericEvent(detailHtml, source, detailUrl);
  const dateText = extractHakariDateText(detailHtml);

  if (dateText && (!event.start_date || /^\d{4}-\d{2}-\d{2}$/.test(event.date_text))) {
    const parsedDates = parseGenericDateRange(dateText);
    if (parsedDates.startDate) {
      event = {
        ...event,
        date_text: dateText,
        start_date: parsedDates.startDate,
        end_date: parsedDates.endDate,
        ...buildScheduleFields({
          startDate: parsedDates.startDate,
          endDate: parsedDates.endDate,
        }),
        calendar_starts_at: parsedDates.calendarStartsAt,
        calendar_ends_at: parsedDates.calendarEndsAt,
      };
    }
  }

  const imageUrls = extractHakariImageUrls(detailHtml, detailUrl).slice(2);

  return {
    ...event,
    description: extractHakariDescription(detailHtml) ?? event.description,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    extraction_confidence: event.start_date ? 0.55 : event.extraction_confidence,
  };
}

function extractSamacEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const firstImageUrl = event.image_urls?.[0] ?? event.primary_image_url ?? null;

  return {
    ...event,
    primary_image_url: firstImageUrl,
    image_urls: firstImageUrl ? [firstImageUrl] : [],
  };
}

function extractTezukayamaEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const galleryHtml = selectElements(detailHtml, '.p-event-gallery')[0] ?? '';
  const imageUrls = [
    ...new Set(
      [...galleryHtml.matchAll(/<a\b[^>]*>/gi)]
        .map((match) => parseTagAttributes(match[0]))
        .filter((attributes) =>
          (attributes.class ?? '').split(/\s+/).includes('c-image-gallery-item'),
        )
        .map((attributes) => normalizeUrl(attributes.href, detailUrl))
        .filter(Boolean),
    ),
  ].slice(0, MAX_IMAGES_PER_EVENT);

  return {
    ...event,
    primary_image_url: imageUrls[0] ?? event.primary_image_url,
    image_urls: imageUrls.length ? imageUrls : event.image_urls,
  };
}

function inferBaikenYear(detailHtml) {
  const imageYear = detailHtml.match(/\/uploads\/(?:exhibition|post)\/(20\d{2})\//)?.[1];
  if (imageYear) return Number(imageYear);

  const publishedYear = extractMeta(detailHtml, 'article:published_time')?.match(
    /^(20\d{2})-/,
  )?.[1];
  return publishedYear ? Number(publishedYear) : null;
}

function parseBaikenDateRange(dateText, fallbackYear) {
  const normalized = decodeHtml(dateText)
    .replace(/\s+/g, '')
    .replace(/[‐‑‒–—―〜～]/g, '-');
  const fullRange = normalized.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日(?:\([^)]*\))?-(?:(\d{4})年)?(?:(\d{1,2})月)?(\d{1,2})日/u,
  );
  const monthRange = normalized.match(
    /(\d{1,2})月(\d{1,2})日(?:\([^)]*\))?-(?:(\d{1,2})月)?(\d{1,2})日(?:\([^)]*\))?/u,
  );

  const match = fullRange ?? monthRange;
  if (!match) {
    return {
      dateText: null,
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const startYear = Number(fullRange ? match[1] : fallbackYear);
  if (!Number.isFinite(startYear)) {
    return {
      dateText: null,
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const startMonth = Number(fullRange ? match[2] : match[1]);
  const startDay = Number(fullRange ? match[3] : match[2]);
  const endYearRaw = fullRange ? Number(match[4]) : null;
  const endMonth = Number(fullRange ? (match[5] ?? startMonth) : (match[3] ?? startMonth));
  const endDay = Number(fullRange ? match[6] : match[4]);
  const endYear = Number.isFinite(endYearRaw)
    ? endYearRaw
    : startYear + (endMonth < startMonth ? 1 : 0);
  const startDate = toDateOnly(startYear, startMonth, startDay);
  const endDate = toDateOnly(endYear, endMonth, endDay);

  return {
    dateText: fullRange
      ? `${startYear}年${startMonth}月${startDay}日-${endYear}年${endMonth}月${endDay}日`
      : `${startMonth}月${startDay}日-${endMonth}月${endDay}日`,
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:00:00+09:00`,
    calendarEndsAt: `${endDate}T18:00:00+09:00`,
  };
}

function cleanBaikenTitle(title) {
  return decodeHtml(title)
    .replace(
      /\s*(?:\d{4}年)?\d{1,2}月\d{1,2}日(?:\([^)]*\))?\s*[〜～\-－]\s*(?:(?:\d{4}年)?\d{1,2}月)?\d{1,2}日(?:\([^)]*\))?/u,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

function extractBaikenEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const rawTitle =
    selectorTextValues(detailHtml, ['.detail-box .post-title', '.post-title'])[0] ?? event.title;
  const description = selectorTextValues(detailHtml, ['.des-box']).slice(0, 2).join('\n\n');
  const dateCandidates = [
    selectorTextValues(detailHtml, ['.field-date'])[0],
    rawTitle,
    extractMeta(detailHtml, 'og:title'),
    decodeURIComponent(detailUrl),
  ].filter(Boolean);
  const fallbackYear = inferBaikenYear(detailHtml);
  const parsedDates =
    dateCandidates
      .map((candidate) => parseBaikenDateRange(candidate, fallbackYear))
      .find((candidate) => candidate.startDate) ?? parseBaikenDateRange('', fallbackYear);
  const title = cleanBaikenTitle(rawTitle) || source.name;
  const imageUrls = (event.image_urls ?? []).slice(0, 6);

  return {
    ...event,
    title,
    description: description || event.description,
    date_text: parsedDates.dateText ?? event.date_text,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? event.primary_image_url,
    image_urls: imageUrls,
    extraction_confidence: parsedDates.startDate ? 0.45 : event.extraction_confidence,
  };
}

function extractOyamazakiEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const articleImageUrls = extractConfiguredImageUrls(detailHtml, detailUrl, {
    ...source,
    selectors: {
      ...(source.selectors ?? {}),
      images: '.p-exhibitionArticle img',
    },
  });
  const imageUrls = (articleImageUrls.length ? articleImageUrls : (event.image_urls ?? [])).slice(
    1,
  );
  const normalizedDateText = event.date_text.replace(/\bto\b/gi, ' - ');
  const parsedDates = parseOyamazakiDateRange(normalizedDateText);
  const hasParsedDates = Boolean(parsedDates.startDate || parsedDates.endDate);

  return {
    ...event,
    start_date: hasParsedDates ? parsedDates.startDate : event.start_date,
    end_date: hasParsedDates ? parsedDates.endDate : event.end_date,
    ...(hasParsedDates
      ? buildScheduleFields({
          startDate: parsedDates.startDate,
          endDate: parsedDates.endDate,
        })
      : {}),
    calendar_starts_at: hasParsedDates ? parsedDates.calendarStartsAt : event.calendar_starts_at,
    calendar_ends_at: hasParsedDates ? parsedDates.calendarEndsAt : event.calendar_ends_at,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    extraction_confidence: 0.55,
  };
}

function parseOyamazakiDateRange(dateText) {
  const normalized = decodeHtml(dateText)
    .replace(/\s+/g, ' ')
    .replace(/[‐‑‒–—―〜～－]/g, '-')
    .trim();
  const japaneseRange = normalized.match(
    /(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日[^-]{0,30}-\s*(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})日/u,
  );

  if (japaneseRange) {
    const [, sy, sm, sd, explicitEy, em, ed] = japaneseRange;
    const inferredEndYear = explicitEy ?? (Number(em) < Number(sm) ? String(Number(sy) + 1) : sy);
    const startDate = toDateOnly(sy, sm, sd);
    const endDate = toDateOnly(inferredEndYear, em, ed);

    return {
      startDate,
      endDate,
      calendarStartsAt: `${startDate}T10:00:00+09:00`,
      calendarEndsAt: `${endDate}T17:00:00+09:00`,
    };
  }

  return parseGenericDateRange(normalized);
}

function extractKyotographieFestivalSchedule(planHtml) {
  const pageText = stripTags(planHtml).replace(/\s+/g, ' ').trim();
  const match = pageText.match(
    /KYOTOGRAPHIE\s+(20\d{2})\s+runs from\s+(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+)?(\d{1,2})\s+([A-Za-z]+)\s+to\s+(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+)?(\d{1,2})\s+([A-Za-z]+)/i,
  );

  if (!match) {
    return {
      dateText: null,
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, year, startWeekday, startDay, startMonth, endWeekday, endDay, endMonth] = match;
  const dateText = `${startWeekday ? `${startWeekday} ` : ''}${startDay} ${startMonth} - ${endWeekday ? `${endWeekday} ` : ''}${endDay} ${endMonth}, ${year}`;
  const parsedDates = parseEnglishDayMonthYearRange(
    `${startDay} ${startMonth} ${year} - ${endDay} ${endMonth} ${year}`,
  );

  return {
    dateText,
    ...parsedDates,
  };
}

function extractKyotographieEvent(detailHtml, source, detailUrl, sourceContext = {}) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const imageUrls = (event.image_urls ?? []).slice(0, 3);
  const festivalSchedule = sourceContext.festivalSchedule ?? {};
  const hasFestivalSchedule = Boolean(festivalSchedule.startDate && festivalSchedule.endDate);

  return {
    ...event,
    date_text: hasFestivalSchedule ? festivalSchedule.dateText : event.date_text,
    start_date: hasFestivalSchedule ? festivalSchedule.startDate : event.start_date,
    end_date: hasFestivalSchedule ? festivalSchedule.endDate : event.end_date,
    ...buildScheduleFields({
      startDate: hasFestivalSchedule ? festivalSchedule.startDate : event.start_date,
      endDate: hasFestivalSchedule ? festivalSchedule.endDate : event.end_date,
    }),
    calendar_starts_at: hasFestivalSchedule
      ? festivalSchedule.calendarStartsAt
      : event.calendar_starts_at,
    calendar_ends_at: hasFestivalSchedule
      ? festivalSchedule.calendarEndsAt
      : event.calendar_ends_at,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    extraction_confidence: hasFestivalSchedule ? 0.45 : event.extraction_confidence,
  };
}

function parseAckDateRange(dateText) {
  const months = {
    january: '01',
    jan: '01',
    february: '02',
    feb: '02',
    march: '03',
    mar: '03',
    april: '04',
    apr: '04',
    may: '05',
    june: '06',
    jun: '06',
    july: '07',
    jul: '07',
    august: '08',
    aug: '08',
    september: '09',
    sep: '09',
    sept: '09',
    october: '10',
    oct: '10',
    november: '11',
    nov: '11',
    december: '12',
    dec: '12',
  };
  const cleaned = decodeHtml(dateText)
    .replace(/\b(?:Mon|Tue|Tues|Wed|Thu|Thurs|Fri|Sat|Sun)\.?\s*/gi, '')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const match = cleaned.match(
    /([A-Za-z]+)\s+(\d{1,2})\s*-\s*(?:([A-Za-z]+)\s+)?(\d{1,2}),\s*(20\d{2})/,
  );

  if (!match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, startMonthName, startDay, endMonthName, endDay, year] = match;
  const startMonth = months[startMonthName.toLowerCase()];
  const endMonth = months[(endMonthName ?? startMonthName).toLowerCase()];

  if (!startMonth || !endMonth) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const startDate = `${year}-${startMonth}-${String(startDay).padStart(2, '0')}`;
  const endDate = `${year}-${endMonth}-${String(endDay).padStart(2, '0')}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T00:00:00+09:00`,
    calendarEndsAt: `${endDate}T23:59:59+09:00`,
  };
}

function extractAckItemLines(detailHtml, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `<h2[^>]*class="[^"]*m-item_heading[^"]*"[^>]*>\\s*${escapedHeading}\\s*<\\/h2>[\\s\\S]*?<div[^>]*class="[^"]*m-item_body[^"]*"[^>]*>\\s*<p[^>]*>([\\s\\S]*?)<\\/p>`,
    'i',
  );

  return stripTags(detailHtml.match(pattern)?.[1] ?? '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !/^Google map$/i.test(line));
}

function extractAckItemText(detailHtml, heading) {
  return extractAckItemLines(detailHtml, heading).join(' ');
}

function extractArtCollaborationKyotoEvent(detailHtml, source, detailUrl) {
  const dateText =
    extractAckItemText(detailHtml, 'Dates') ||
    stripTags(
      detailHtml.match(/alt="([^"]*Art Collaboration Kyoto[^"]*20\d{2}[^"]*)"/i)?.[1] ?? '',
    );
  const parsedDates = parseAckDateRange(dateText);
  const aboutDescription = stripTags(
    detailHtml.match(/<p[^>]*class="about-overview"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? '',
  )
    .replace(/\s+/g, ' ')
    .trim();
  const description = aboutDescription || stripTags(extractMeta(detailHtml, 'description') ?? '');
  const venueLines = extractAckItemLines(detailHtml, 'Venue');
  const venueName = venueLines[0] ?? 'Kyoto International Conference Center';
  const addressText =
    venueLines.find((line) => /Kyoto\s+\d{3}-\d{4}\s+Japan/i.test(line)) ?? venueName;
  const ogImage = extractMeta(detailHtml, 'og:image');
  const imageUrls = ogImage ? [normalizeUrl(ogImage, detailUrl)].filter(Boolean) : [];
  const year = parsedDates.startDate?.slice(0, 4) ?? dateText.match(/20\d{2}/)?.[0] ?? '';

  return {
    title: `Art Collaboration Kyoto${year ? ` ${year}` : ''}`,
    categories: ['fair', 'art'],
    description,
    institution_name: source.name,
    venue_name: venueName || 'Kyoto International Conference Center',
    address_text: addressText || 'Takaragaike, Sakyo-ku, Kyoto 606-0001 Japan',
    directions_query: source.directions_query ?? 'Kyoto International Conference Center, Kyoto',
    date_text: dateText || 'See source page',
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
    extraction_confidence: parsedDates.startDate ? 0.8 : 0.35,
  };
}

function extractGalleryYamahonEvent(detailHtml, source, detailUrl) {
  const englishHeading = [...detailHtml.matchAll(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi)]
    .map((match) => stripTags(match[1]))
    .map((value) =>
      value
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    )
    .find((lines) => /^No\.\s*\d+/i.test(lines[0] ?? ''));

  if (!englishHeading) {
    throw new Error('Could not find Gallery Yamahon English exhibition heading');
  }

  const [title, dateText = 'See source page', ...headingDetails] = englishHeading;
  const yearHint =
    detailHtml.match(/(20\d{2})年/)?.[1] ??
    detailHtml.match(/datetime=["'](20\d{2})/)?.[1] ??
    currentYearInTokyo();
  const parseableDateText = `${dateText.replace(/\b([A-Za-z]{3})\./g, '$1')}, ${yearHint}`;
  const parsedDates = parseEnglishMonthDateRangeWithOptionalStartYear(parseableDateText);
  const timeText =
    headingDetails.find((line) => /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/.test(line)) ?? null;
  const timeMatch = timeText?.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);
  const startTimeText = timeMatch?.[1] ?? null;
  const endTimeText = timeMatch?.[2] ?? null;
  const venueName =
    headingDetails
      .find((line) => /^MAP\s*:/i.test(line))
      ?.replace(/^MAP\s*:\s*/i, '')
      .trim() || source.name;
  const paragraphs = [...detailHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const description =
    paragraphs.find((paragraph) => /^We are pleased\b/i.test(paragraph)) ??
    paragraphs.find(
      (paragraph) =>
        paragraph.length > 80 &&
        paragraph.replace(/[^\x00-\x7F]/g, '').length / paragraph.length > 0.75,
    ) ??
    '';
  const imageUrls = extractGenericImageUrls(detailHtml, detailUrl);
  const calendarStartsAt =
    parsedDates.startDate && startTimeText
      ? `${parsedDates.startDate}T${startTimeText}:00+09:00`
      : parsedDates.calendarStartsAt;
  const calendarEndsAt =
    parsedDates.endDate && endTimeText
      ? `${parsedDates.endDate}T${endTimeText}:00+09:00`
      : parsedDates.calendarEndsAt;

  return {
    title,
    categories: ['exhibition'],
    description,
    institution_name: source.name,
    venue_name: venueName,
    address_text: source.address_text ?? venueName,
    directions_query: source.directions_query ?? `${venueName}, Kyoto`,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: startTimeText,
    end_time_text: endTimeText,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: calendarStartsAt,
    calendar_ends_at: calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
    extraction_confidence: 0.75,
  };
}

function extractKyotophonieEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const firstImageUrl = event.image_urls?.[0] ?? null;

  return {
    ...event,
    primary_image_url: firstImageUrl,
    image_urls: firstImageUrl ? [firstImageUrl] : [],
  };
}

function getKankakariPublishedYear(detailHtml) {
  const publishedYear =
    extractMeta(detailHtml, 'article:published_time')?.match(/^(20\d{2})-/)?.[1] ??
    detailHtml.match(/"datePublished"\s*:\s*"(20\d{2})-/)?.[1];

  return publishedYear ? Number(publishedYear) : null;
}

function cleanKankakariTitle(rawTitle, dateIndex = -1) {
  const title = decodeHtml(rawTitle).replace(/\s+/g, ' ').trim();

  return (
    (dateIndex > 0 ? title.slice(0, dateIndex) : title).replace(/\s*[-–—]\s*$/u, '').trim() || title
  );
}

function parseKankakariDateRange(text, fallbackYear = null) {
  const normalized = decodeHtml(text)
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[−–—〜～－]/g, '-')
    .trim();
  const pattern =
    /(?:(20\d{2})\s*[.\/年]\s*)?(\d{1,2})\s*[.\/月]\s*(\d{1,2})(?:日)?\s*(?:[a-z]{3,}|[日月火水木金土](?:曜)?(?:日)?)?\s*-\s*(?:(?:(20\d{2})\s*[.\/年]\s*)?(\d{1,2})\s*[.\/月]\s*)?(\d{1,2})(?:日)?/iu;
  const match = normalized.match(pattern);

  if (!match) return null;

  const [fullMatch, explicitStartYear, sm, sd, explicitEndYear, maybeEndMonth, ed] = match;
  const startMonth = Number(sm);
  const startDay = Number(sd);
  const endMonth = maybeEndMonth ? Number(maybeEndMonth) : startMonth;
  const endDay = Number(ed);
  const startYear = Number(explicitStartYear ?? fallbackYear);

  if (!Number.isFinite(startYear)) return null;

  const endYear = explicitEndYear
    ? Number(explicitEndYear)
    : endMonth < startMonth
      ? startYear + 1
      : startYear;
  const startDate = toDateOnly(startYear, startMonth, startDay);
  const endDate = toDateOnly(endYear, endMonth, endDay);

  return {
    dateText: `${startDate} - ${endDate}`,
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T13:00:00+09:00`,
    calendarEndsAt: `${endDate}T18:00:00+09:00`,
    matchIndex: match.index ?? -1,
    matchedText: fullMatch,
  };
}

function extractKankakariEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const firstImageUrl = event.image_urls?.[0] ?? null;
  const rawTitle =
    decodeHtml(extractMeta(detailHtml, 'og:title') ?? '') || event.title || source.name;
  const publishedYear = getKankakariPublishedYear(detailHtml);
  const dateCandidates = [event.description, rawTitle, event.title, detailUrl].filter(Boolean);
  const rawTitleDate = parseKankakariDateRange(rawTitle, publishedYear);
  const parsedDates =
    dateCandidates
      .map((candidate) => parseKankakariDateRange(candidate, publishedYear))
      .find(Boolean) ?? null;
  const cleanTitle = cleanKankakariTitle(rawTitle, rawTitleDate?.matchIndex);

  return {
    ...event,
    title: cleanTitle,
    ...(parsedDates
      ? {
          date_text: parsedDates.dateText,
          start_date: parsedDates.startDate,
          end_date: parsedDates.endDate,
          calendar_starts_at: parsedDates.calendarStartsAt,
          calendar_ends_at: parsedDates.calendarEndsAt,
          ...buildScheduleFields({
            startDate: parsedDates.startDate,
            endDate: parsedDates.endDate,
          }),
        }
      : {}),
    primary_image_url: firstImageUrl,
    image_urls: firstImageUrl ? [firstImageUrl] : [],
  };
}

function extractKusakabeEvent(detailHtml, source, detailUrl) {
  const eventHtml =
    [...detailHtml.matchAll(/<section\b[^>]*>[\s\S]*?<\/section>/gi)].find((match) =>
      /\d{4}年\s*\d{1,2}月\s*\d{1,2}日/u.test(stripTags(match[0]).normalize('NFKC')),
    )?.[0] ?? detailHtml;
  const paragraphs = [...eventHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => ({
      index: match.index,
      text: stripTags(match[1])
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    }))
    .filter(({ text }) => text);
  const dateParagraphIndex = paragraphs.findIndex(({ text }) =>
    /\d{4}年\s*\d{1,2}月\s*\d{1,2}日/u.test(text.normalize('NFKC')),
  );
  const dateText = paragraphs[dateParagraphIndex]?.text.normalize('NFKC') ?? 'See source page';
  const parsedDates = parseGenericDateRange(dateText);
  const title =
    paragraphs
      .slice(0, dateParagraphIndex)
      .map(({ text }) => text)
      .filter((text) => !/^Kusakabe gallery\s*$/i.test(text))
      .at(-1) ?? source.name;
  const timeText = paragraphs
    .slice(dateParagraphIndex + 1)
    .find(({ text }) => /\b\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}\b/.test(text))?.text;
  const [, startTime = null, endTime = null] =
    timeText?.match(/\b(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})\b/) ?? [];
  const imageTag = eventHtml.match(/<wow-image\b[^>]*data-image-info=(['"])(.*?)\1[^>]*>/i)?.[0];
  const imageInfo = imageTag ? decodeHtml(parseTagAttributes(imageTag)['data-image-info']) : null;
  let imageUrl = null;

  try {
    const uri = JSON.parse(imageInfo)?.imageData?.uri;
    imageUrl = uri ? `https://static.wixstatic.com/media/${uri}` : null;
  } catch {
    imageUrl = null;
  }

  const imageIndex = imageTag ? eventHtml.indexOf(imageTag) : -1;
  const description = paragraphs
    .filter(({ index }) => imageIndex !== -1 && index > imageIndex)
    .map(({ text }) => text)
    .join('\n\n');

  return {
    title,
    categories: flattenTaxonomy(source.taxonomy),
    description,
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: source.directions_query ?? `${source.name}, Kyoto`,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: startTime,
    end_time_text: endTime,
    is_all_day: !startTime,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at:
      parsedDates.startDate && startTime
        ? `${parsedDates.startDate}T${startTime}:00+09:00`
        : parsedDates.calendarStartsAt,
    calendar_ends_at:
      parsedDates.endDate && endTime
        ? `${parsedDates.endDate}T${endTime}:00+09:00`
        : parsedDates.calendarEndsAt,
    primary_image_url: imageUrl,
    image_urls: imageUrl ? [imageUrl] : [],
    source_url: detailUrl,
    extraction_confidence: parsedDates.startDate && imageUrl ? 0.9 : 0.4,
  };
}

function extractHyogoEvent(detailHtml, source, detailUrl) {
  const externalId = new URL(detailUrl).hash.slice(1);
  const index = Number(externalId.match(/^exhibition-(\d+)$/)?.[1]);
  const itemHtml = extractHyogoExhibitionItems(detailHtml)[index];
  if (!itemHtml) throw new Error(`Could not find Hyogo exhibition ${index}`);

  const scheduleYear = detailHtml.match(/(20\d{2})年\s*年間スケジュール/u)?.[1];
  const dateText = extractHyogoDateText(itemHtml, scheduleYear);
  const parsedDates = parseGenericDateRange(dateText ?? '');
  const rawTitle = itemHtml.match(
    /<h3\b[^>]*class=(['"])[^'"]*\bexhibition-title\b[^'"]*\1[^>]*>([\s\S]*?)<\/h3>/i,
  )?.[2];
  const title = stripTags(
    (rawTitle ?? source.name)
      .replace(/<span\b[^>]*class=(['"])[^'"]*\bexhibition-subtitle\b[^'"]*\1[^>]*>[\s\S]*$/i, '')
      .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
  const description = selectorTextValues(itemHtml, ['.exhibition-body']).join('\n\n').trim();
  const imageUrls = extractGenericImageUrls(itemHtml, detailUrl, { includeOgImage: false });

  return {
    external_id: externalId,
    title,
    categories: flattenTaxonomy(source.taxonomy),
    description,
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: source.directions_query ?? `${source.name}, Kobe`,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
    extraction_confidence: parsedDates.startDate ? 0.9 : 0.4,
  };
}

function extractFukudaTableValue(detailHtml, labels) {
  for (const rowMatch of detailHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const rowHtml = rowMatch[1];
    const header = stripTags(rowHtml.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i)?.[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!labels.some((label) => header.toLowerCase().includes(label.toLowerCase()))) {
      continue;
    }

    const valueHtml = rowHtml.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '';
    const value = stripTags(valueHtml)
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .find(Boolean);
    if (value) return value;
  }

  return null;
}

function parseFukudaEnglishDateRange(dateText) {
  const months = {
    january: '01',
    february: '02',
    march: '03',
    april: '04',
    may: '05',
    june: '06',
    july: '07',
    august: '08',
    september: '09',
    october: '10',
    november: '11',
    december: '12',
  };
  const cleaned = decodeHtml(dateText)
    .replace(/\([^)]*\)/g, '')
    .replace(/[–—～〜]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const match = cleaned.match(
    /([A-Za-z]+)\s+(\d{1,2})(?:,\s*)?\s*(\d{4})?\s*-\s*([A-Za-z]+)\s+(\d{1,2})(?:,\s*)?\s*(\d{4})/i,
  );
  if (!match) return null;

  const [, startMonthName, startDay, maybeStartYear, endMonthName, endDay, endYear] = match;
  const startMonth = months[startMonthName.toLowerCase()];
  const endMonth = months[endMonthName.toLowerCase()];
  const startYear = maybeStartYear ?? endYear;
  if (!startMonth || !endMonth) return null;

  const startDate = `${startYear}-${startMonth}-${String(startDay).padStart(2, '0')}`;
  const endDate = `${endYear}-${endMonth}-${String(endDay).padStart(2, '0')}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:00:00+09:00`,
    calendarEndsAt: `${endDate}T17:00:00+09:00`,
  };
}

function parseFukudaDateRange(dateText) {
  const normalized = decodeHtml(dateText)
    .replace(/(\d{4})年\s+/g, '$1年')
    .replace(/\s+/g, ' ')
    .trim();
  const japaneseDates = parseJapaneseDateRange(normalized);
  if (japaneseDates.startDate) return japaneseDates;

  const englishDates = parseFukudaEnglishDateRange(normalized);
  if (englishDates?.startDate) return englishDates;

  return parseGenericDateRange(normalized);
}

function extractFukudaHeroImage(detailHtml, detailUrl) {
  const styleImage = detailHtml.match(
    /id="eyeVisual"[^>]+style=(["'])[^"']*url\((["']?)(.*?)\2\)[^"']*\1/i,
  )?.[3];
  const imageUrls = [
    styleImage ? normalizeUrl(styleImage, detailUrl) : null,
    extractMeta(detailHtml, 'og:image')
      ? normalizeUrl(extractMeta(detailHtml, 'og:image'), detailUrl)
      : null,
    ...extractGenericImageUrls(detailHtml, detailUrl, { includeOgImage: false }),
  ].filter(Boolean);

  return imageUrls[0] ?? null;
}

function extractFukudaEvent(detailHtml, source, detailUrl) {
  const title =
    extractFukudaTableValue(detailHtml, ['タイトル', 'Title']) ??
    stripTags(
      detailHtml.match(/<h1\b[^>]*class="[^"]*\btitle\b[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '',
    ) ??
    source.name;
  const dateText =
    extractFukudaTableValue(detailHtml, ['会期', 'Dates']) ??
    extractBestDateText(detailHtml, detailUrl);
  const parsedDates = parseFukudaDateRange(dateText);
  const description = [
    ...detailHtml.matchAll(/<div\b[^>]*class="[^"]*\bpostBody\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi),
  ]
    .flatMap((match) => [...match[1].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)])
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter((value) => value.length > 40)
    .slice(0, 2)
    .join('\n\n');
  const imageUrl = extractFukudaHeroImage(detailHtml, detailUrl);
  const directionsQuery = source.directions_query ?? `${source.name}, Kyoto`;

  return {
    title,
    categories: flattenTaxonomy(source.taxonomy),
    description: description || extractGenericDescription(detailHtml),
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: directionsQuery,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrl,
    image_urls: imageUrl ? [imageUrl] : [],
    source_url: detailUrl,
    extraction_confidence: parsedDates.startDate ? 0.86 : 0.45,
  };
}

function stripHtmlComments(html) {
  return String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

function extractRakuMuseumDetailUrls(listingHtml, listingUrl) {
  const html = stripHtmlComments(listingHtml);
  const isEnglishExhibitionIndex = /\/e\/museum\/exhibition\//.test(new URL(listingUrl).pathname);

  if (isEnglishExhibitionIndex) {
    const tabHtml = html.match(/<ul\b[^>]*id="ex-tab"[^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? '';
    const tabUrls = [...tabHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)]
      .filter((match) => !/past/i.test(stripTags(match[3])))
      .map((match) => match[2])
      .filter((href) => href && href !== '#')
      .map((href) => normalizeUrl(href, listingUrl))
      .filter(Boolean);

    return [...new Set([listingUrl, ...tabUrls])];
  }

  const infoHtml =
    html.match(/<div\b[^>]*class="[^"]*\binfo\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? html;
  const eventUrls = [...infoHtml.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)]
    .map((match) => match[1])
    .filter((ddHtml) => /会\s*期/.test(stripTags(ddHtml)))
    .flatMap((ddHtml) =>
      [...ddHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)].map((match) => match[2]),
    )
    .map((href) => normalizeUrl(href, listingUrl))
    .filter(Boolean)
    .filter((url) => /\/museum\/exhibition\//.test(new URL(url).pathname));

  return [...new Set(eventUrls)];
}

function buildRakuMuseumEvent(source, detailUrl, fields) {
  const parsedDates = parseGenericDateRange(fields.dateText);
  const directionsQuery = source.directions_query ?? `${source.name}, Kyoto`;

  return {
    title: fields.title || source.name,
    categories: flattenTaxonomy(source.taxonomy),
    description: fields.description || null,
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: directionsQuery,
    date_text: fields.dateText || 'See source page',
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: fields.imageUrl ?? null,
    image_urls: fields.imageUrl ? [fields.imageUrl] : [],
    source_url: detailUrl,
    extraction_confidence: 0.82,
  };
}

function extractRakuMuseumDateText(text) {
  const compact = text.replace(/\s+/g, ' ').trim();
  const JapaneseDate = compact.match(
    /会\s*期[:：]\s*\d{4}年\d{1,2}月\d{1,2}日[^。]+?\d{1,2}月\d{1,2}日[^。\n]*/u,
  );
  if (JapaneseDate) return JapaneseDate[0].trim();

  const parsed = parseGenericDateRange(compact);
  return parsed.startDate ? compact : null;
}

function extractRakuMuseumTabEvent(detailHtml, source, detailUrl) {
  const html = stripHtmlComments(detailHtml);
  const h4Html = html.match(/<h4\b[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ?? '';
  if (!h4Html) return null;

  const spanTexts = [...h4Html.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const dateText = spanTexts.map(extractRakuMuseumDateText).find(Boolean);
  if (!dateText) return null;

  const title = spanTexts
    .filter((text) => text !== dateText)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const description = [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter((value) => value.length > 40)
    .slice(0, 2)
    .join('\n\n');
  const firstImageUrl =
    extractGenericImageUrls(html, detailUrl, {
      includeOgImage: false,
    })[0] ?? null;

  return buildRakuMuseumEvent(source, detailUrl, {
    title,
    dateText,
    description,
    imageUrl: firstImageUrl,
  });
}

function extractRakuMuseumHomeInfoEvent(detailHtml, source, detailUrl) {
  const html = stripHtmlComments(detailHtml);
  const infoHtml =
    html.match(/<div\b[^>]*class="[^"]*\binfo\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '';
  if (!infoHtml) return null;

  for (const match of infoHtml.matchAll(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    const ddHtml = match[1];
    const text = stripTags(ddHtml);
    const dateText = extractRakuMuseumDateText(text);
    if (!dateText) continue;

    const linkHtml = ddHtml.match(/<a\b[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '';
    const title = stripTags(linkHtml)
      .replace(/^「|」$/g, '')
      .trim();
    if (!title) continue;

    return buildRakuMuseumEvent(source, detailUrl, {
      title,
      dateText,
      description: text.replace(dateText, '').replace(title, '').trim(),
      imageUrl: null,
    });
  }

  return null;
}

function extractRakuMuseumEvent(detailHtml, source, detailUrl) {
  const siteEvent =
    getSourceLocale(source) === 'ja'
      ? extractRakuMuseumHomeInfoEvent(detailHtml, source, detailUrl)
      : extractRakuMuseumTabEvent(detailHtml, source, detailUrl);
  return siteEvent ?? null;
}

function extractKoenMainHtml(detailHtml) {
  return detailHtml.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? detailHtml;
}

function parseKoenDateRange(dateText) {
  const cleaned = decodeHtml(dateText)
    .replace(/[～〜–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  const match = cleaned.match(
    /(20\d{2})[./](\d{1,2})[./](\d{1,2})(?:\([^)]*\))?\s*-\s*(?:(20\d{2})[./])?(?:(\d{1,2})[./])?(\d{1,2})(?:\([^)]*\))?/u,
  );

  if (!match) return parseDottedDateRange(cleaned);

  const [, sy, sm, sd, explicitEy, explicitEm, ed] = match;
  const ey = explicitEy ?? sy;
  const em = explicitEm ?? sm;
  const startDate = toDateOnly(sy, sm, sd);
  const endDate = toDateOnly(ey, em, ed);
  const timeMatch = cleaned.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  const startTime = timeMatch?.[1] ?? '11:00';
  const endTime = timeMatch?.[2] ?? '18:00';

  return {
    startDate,
    endDate,
    startTime,
    endTime,
    calendarStartsAt: `${startDate}T${startTime}:00+09:00`,
    calendarEndsAt: `${endDate}T${endTime}:00+09:00`,
  };
}

function extractKoenImageUrls(mainHtml, detailUrl) {
  return [
    ...new Set(
      [...mainHtml.matchAll(/<img\b[^>]*>/gi)]
        .map((match) => {
          const attributes = parseTagAttributes(match[0]);
          const rawUrl =
            attributes.src ??
            attributes['data-src'] ??
            attributes['data-original'] ??
            attributes['data-lazy-src'] ??
            null;
          return rawUrl ? normalizeUrl(decodeHtml(rawUrl), detailUrl) : null;
        })
        .filter(Boolean),
    ),
  ];
}

function extractKoenEvent(detailHtml, source, detailUrl) {
  const mainHtml = extractKoenMainHtml(detailHtml);
  const lines = stripTags(mainHtml)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const title =
    lines.find(
      (line) =>
        !/^event information$/i.test(line) &&
        !/^開催日時\s*[:：]/u.test(line) &&
        !/^開催場所\s*[:：]/u.test(line) &&
        !/^〒?\d{3}-\d{4}/.test(line),
    ) ?? source.name;
  const dateText =
    lines.find((line) => /^開催日時\s*[:：]/u.test(line)) ??
    lines.find((line) => parseKoenDateRange(line).startDate) ??
    extractBestDateText(mainHtml, detailUrl);
  const parsedDates = parseKoenDateRange(dateText);
  const description = lines
    .filter((line) => !/^event information$/i.test(line))
    .filter((line) => line !== title)
    .join('\n');
  const imageUrls = extractKoenImageUrls(mainHtml, detailUrl);
  const directionsQuery = source.directions_query ?? `${source.name}, Kyoto`;

  return {
    title,
    categories: flattenTaxonomy(source.taxonomy),
    description: description || extractGenericDescription(mainHtml),
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: directionsQuery,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: parsedDates.startTime ?? null,
    end_time_text: parsedDates.endTime ?? null,
    is_all_day: !parsedDates.startTime,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
    extraction_confidence: parsedDates.startDate ? 0.82 : 0.4,
  };
}

function extractMtkEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const descriptionBlock = extractClassBlock(detailHtml, 'ex__detail', 'div') ?? '';
  const description = [...descriptionBlock.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((value) => !/^[-–—]+$/.test(value))
    .filter((value) => !/^photo by\b/i.test(value))
    .join('\n\n');
  const sliderHtml =
    detailHtml.match(
      /<div class="ex__slider-main ex__slider">[\s\S]*?<div class="swiper-wrapper">([\s\S]*?)<\/div>\s*<\/div>/i,
    )?.[1] ??
    detailHtml.match(/<div class="swiper-wrapper">([\s\S]*?)<\/div>/i)?.[1] ??
    '';

  const sliderImageUrls = finalizeImageUrls(
    [...sliderHtml.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((match) => ({
      url: match[1],
      source: 'mtk-swiper',
    })),
    detailUrl,
  );

  const firstImageUrl = sliderImageUrls[0] ?? null;

  return {
    ...event,
    description: description || event.description,
    primary_image_url: firstImageUrl,
    image_urls: firstImageUrl ? [firstImageUrl] : [],
  };
}

function extractGalleryUnfoldDetailUrls(listingHtml, listingUrl) {
  // The archive page lists all exhibitions newest-first. Only the most recent
  // item has images and content; upcoming entries are placeholders, so we take one.
  const matches = [...listingHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)]
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean)
    .filter((url) => {
      try {
        const { hostname, pathname } = new URL(url);
        return hostname === 'galleryunfold.com' && pathname !== '/archive' && pathname.length > 1;
      } catch {
        return false;
      }
    });

  const unique = [...new Set(matches)];

  if (!unique.length) {
    throw new Error('Could not find Gallery Unfold archive detail URLs');
  }

  return unique.slice(0, 1);
}

function extractChushinDetailUrls(listingHtml, listingUrl) {
  const canonicalUrl = new URL(listingUrl);
  canonicalUrl.hash = '';
  const sections = [...listingHtml.matchAll(/<section\b[^>]*\bid=(["'])(exh\d{3,})\1[^>]*>/gi)]
    .map((match) => match[2])
    .filter(Boolean);

  return [...new Set(sections)].map((sectionId) => `${canonicalUrl.toString()}#${sectionId}`);
}

function extractChushinSectionHtml(detailHtml, sectionId) {
  const escapedId = sectionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const sectionPattern = new RegExp(
    `<section\\b[^>]*\\bid=(["'])${escapedId}\\1[^>]*>[\\s\\S]*?(?=<section\\b|</main>|$)`,
    'i',
  );

  return detailHtml.match(sectionPattern)?.[0] ?? null;
}

function parseChushinDateRange(dateText) {
  const cleaned = dateText.normalize('NFKC').replace(/\s+/g, ' ');
  const range = cleaned.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日[\s\S]{0,20}?[~～〜\-－][\s\S]{0,20}?(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/u,
  );

  if (!range) {
    return parseGenericDateRange(dateText);
  }

  const [, sy, sm, sd, maybeEndYear, em, ed] = range;
  const ey = maybeEndYear ?? sy;
  const startDate = toDateOnly(sy, sm, sd);
  const endDate = toDateOnly(ey, em, ed);

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:00:00+09:00`,
    calendarEndsAt: `${endDate}T17:00:00+09:00`,
  };
}

function extractChushinEvent(detailHtml, source, detailUrl) {
  const sectionId = new URL(detailUrl).hash.replace(/^#/, '');
  const sectionHtml = sectionId ? extractChushinSectionHtml(detailHtml, sectionId) : null;
  const eventHtml = sectionHtml ?? detailHtml;
  const rawTitle = eventHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ?? source.name;
  const title = stripTags(rawTitle.replace(/<rt\b[^>]*>[\s\S]*?(?:<\/rt>|<\/ruby>)/gi, ''))
    .replace(/\s*終了\s*$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
  const dateText = stripTags(
    eventHtml.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? 'See source page',
  )
    .replace(/\s+/g, ' ')
    .trim();
  const parsedDates = parseChushinDateRange(dateText);
  const description = [...eventHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  const imageUrls = extractGenericImageUrls(eventHtml, detailUrl);
  const directionsQuery = source.directions_query ?? `${source.name}, Kyoto`;

  return {
    external_id: sectionId,
    title,
    categories: flattenTaxonomy(source.taxonomy),
    description,
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: directionsQuery,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
    extraction_confidence: sectionHtml ? 0.78 : 0.35,
  };
}

function extractCurationFairEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const pageText = stripTags(detailHtml).replace(/\s+/g, ' ').trim();
  const dateText =
    pageText.match(/Dates:\s*[^.]{0,140}?20\d{2}/i)?.[0] ??
    pageText.match(/会期[：:]\s*20\d{2}年\d{1,2}月\d{1,2}日[^。]{0,80}?\d{1,2}日/u)?.[0] ??
    event.date_text;
  const parsedDates = parseGenericDateRange(dateText);
  const description = [...detailHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 80)
    .slice(0, 2)
    .join('\n\n');

  return {
    ...event,
    title: source.name,
    description: description || event.description,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    extraction_confidence: parsedDates.startDate ? 0.82 : event.extraction_confidence,
  };
}

function extractKuramonzenEvent(detailHtml, source, detailUrl) {
  // Truncate at "Others exhibitions" carousel to prevent related articles from polluting extraction
  const othersIdx = detailHtml.search(/<h2[^>]*>\s*Others\s+exhibitions/i);
  const mainHtml = othersIdx >= 0 ? detailHtml.slice(0, othersIdx) : detailHtml;

  const title =
    stripTags(mainHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '')
      .replace(/\s+/g, ' ')
      .trim() ||
    stripTags(detailHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '')
      .replace(/\s*[|\-–]\s*Kuramonzen.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

  if (!title) {
    throw new Error('Could not extract event title from Kuramonzen detail page');
  }

  // Prefer <strong> containing a dotted YYYY.MM.DD date over generic date extraction —
  // the publication date (English "Month DD, YYYY") appears earlier in the DOM and would
  // otherwise win.
  const strongTexts = [...mainHtml.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/gi)]
    .map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const rawDateText =
    strongTexts.find((t) => /\d{4}\.\d{1,2}\.\d{1,2}/.test(t)) ??
    extractBestDateText(mainHtml, detailUrl);
  const parsedDates = parseGenericDateRange(rawDateText);

  // og:image is unique per Shopify article — use it as the authoritative image source
  const ogImage = extractMeta(detailHtml, 'og:image');
  const imageUrls = finalizeImageUrls(
    [
      ...(ogImage ? [{ url: ogImage, source: 'og:image' }] : []),
      ...[...mainHtml.matchAll(/<img\b[^>]*>/gi)].map((match) => {
        const attrs = parseTagAttributes(match[0]);
        const { width, height } = getImageAttributeDimensions(attrs);
        return { url: attrs.src ?? attrs['data-src'] ?? null, width, height, source: 'img' };
      }),
    ],
    detailUrl,
  );

  const description = [...mainHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => stripTags(m[1]).replace(/\s+/g, ' ').trim())
    .filter((t) => t.length > 40 && !/^\d{4}\.\d{1,2}\.\d{1,2}/.test(t))
    .slice(0, 3)
    .join('\n\n');

  return {
    title,
    categories: ['exhibition', 'gallery'],
    description: description || extractGenericDescription(mainHtml),
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: source.directions_query ?? `${source.name}, Kyoto`,
    date_text: rawDateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: 'Asia/Tokyo',
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
  };
}

const detailUrlExtractors = {
  '10-chancery-lane-gallery': extractTenChanceryCurrentDetailUrls,
  '21-21-design-sight': extractTwentyOneDetailUrls,
  'art-gallery-kitano': extractKitanoDetailUrls,
  'art-collaboration-kyoto': extractArtCollaborationKyotoDetailUrls,
  'chushin-bijutsu': extractChushinDetailUrls,
  'curation-fair-kyoto': extractCurationFairDetailUrls,
  'curation-fair-tokyo': extractCurationFairDetailUrls,
  'dnp-foundation-for-cultural-promotion-gallery-ddd': extractDddDetailUrls,
  'fukuda-art-museum': extractFukudaDetailUrls,
  'gallery-take-two': extractGalleryTakeTwoDetailUrls,
  'gallery-yamahon': extractGalleryYamahonDetailUrls,
  'ginza-graphic-gallery': extractDddDetailUrls,
  'hong-kong-palace-museum': extractHongKongPalaceMuseumDetailUrls,
  'hosomi-museum': extractHosomiMuseumDetailUrls,
  'hosoo-gallery': extractHosooDetailUrls,
  'hyogo-prefectural-museum-of-art': extractHyogoDetailUrls,
  'issey-miyake-kyoto-kura': extractIsseyMiyakeKuraDetailUrls,
  'jps-gallery-hong-kong': extractJpsHongKongDetailUrls,
  'koen-kyoto': extractKoenKyotoDetailUrls,
  'kusakabe-gallery': extractKoenKyotoDetailUrls,
  kcua: extractKcuaDetailUrls,
  'kyoto-art-center': extractKacDetailUrls,
  'kyoto-national-museum': extractKyohakuDetailUrls,
  'kyoto-city-kyocera-museum-of-art': extractKyoceraDetailUrls,
  momak: extractMomakDetailUrls,
  'osaka-geidai-whatsnew': extractOsakaGeidaiDetailUrls,
  'pola-museum-annex': extractHosomiMuseumDetailUrls,
  'raku-museum': extractRakuMuseumDetailUrls,
  'scai-the-bathhouse': extractScaiDetailUrlsFor('scai-the-bathhouse'),
  'scai-piramide': extractScaiDetailUrlsFor('scai-piramide'),
  'scai-park': extractScaiDetailUrlsFor('scai-park'),
  'sen-oku-hakukokan': extractSenOkuDetailUrls,
  'snow-contemporary': extractSnowCurrentDetailUrls,
  'sokyo-kyoto': extractSokyoDetailUrls,
  'taka-ishii-gallery': extractTakaIshiiDetailUrls,
  villepin: extractVillepinCurrentDetailUrls,
  zenbi: extractZenbiDetailUrls,
  'gallery-unfold': extractGalleryUnfoldDetailUrls,
};

const eventExtractors = {
  '21-21-design-sight': extractTwentyOneEvent,
  'art-gallery-kitano': extractKitanoEvent,
  artro: extractArtroEvent,
  'art-collaboration-kyoto': extractArtCollaborationKyotoEvent,
  'chushin-bijutsu': extractChushinEvent,
  'curation-fair-kyoto': extractCurationFairEvent,
  'curation-fair-tokyo': extractCurationFairEvent,
  'dnp-foundation-for-cultural-promotion-gallery-ddd': extractDddEvent,
  'fukuda-art-museum': extractFukudaEvent,
  'gallery-baiken': extractBaikenEvent,
  'gallery-take-two': extractGalleryTakeTwoEvent,
  'gallery-yamahon': extractGalleryYamahonEvent,
  'ginza-graphic-gallery': extractDddEvent,
  'hakari-contemporary': extractHakariEvent,
  'hosoo-gallery': extractHosooEvent,
  'hyogo-prefectural-museum-of-art': extractHyogoEvent,
  'issey-miyake-kyoto-kura': extractIsseyMiyakeKuraEvent,
  'koen-kyoto': extractKoenEvent,
  'kyoto-art-center': extractKacEvent,
  'kyoto-national-museum': extractKyohakuEvent,
  'kyoto-city-kyocera-museum-of-art': extractKyoceraEvent,
  kyotographie: extractKyotographieEvent,
  kyotophonie: extractKyotophonieEvent,
  kankakari: extractKankakariEvent,
  kuramonzen: extractKuramonzenEvent,
  'kusakabe-gallery': extractKusakabeEvent,
  'leica-gallery-kyoto': extractLeicaKyotoEvent,
  'nakanoshima-museum-of-art-osaka': extractSamacEvent,
  'osaka-geidai-whatsnew': extractSamacEvent,
  'parco-hall-shinsaibashi': extractParcoHallEvent,
  'pola-museum-annex': extractPolaMuseumAnnexEvent,
  'raku-museum': extractRakuMuseumEvent,
  samac: extractSamacEvent,
  momak: extractMomakEvent,
  mtk: extractMtkEvent,
  'oyamazaki-villa-museum': extractOyamazakiEvent,
  'scai-the-bathhouse': extractScaiEvent,
  'scai-piramide': extractScaiEvent,
  'scai-park': extractScaiEvent,
  'sen-oku-hakukokan': extractSenOkuEvent,
  sibasi: extractSibasiEvent,
  'snow-contemporary': extractSnowContemporaryEvent,
  'standing-pine-tokyo': extractStandingPineEvent,
  'taka-ishii-gallery': extractTakaIshiiEvent,
  'tezukayama-gallery': extractTezukayamaEvent,
  zenbi: extractZenbiEvent,
};

function extractSourceSpecificDetailUrls(detailUrlExtractor, listingPages, source) {
  if (!detailUrlExtractor || !listingPages.length) return [];

  const pages = source?.slug === '21-21-design-sight' ? listingPages : listingPages.slice(0, 1);

  return [
    ...new Set(
      pages.flatMap((listingPage) => detailUrlExtractor(listingPage.html, listingPage.url, source)),
    ),
  ];
}

const sourceSpecificSkipMatchers = {
  kankakari(eventData) {
    return classifyEventTiming(eventData, toJapanDate(new Date())) === 'past' ? 'past event' : null;
  },
  'koen-kyoto'(eventData) {
    return classifyEventTiming(eventData, toJapanDate(new Date())) === 'past' ? 'past event' : null;
  },
  'kyoto-city-kyocera-museum-of-art'(eventData) {
    return /(\bCollection Room\b|コレクションルーム)/iu.test(eventData?.title ?? '')
      ? 'title contains Collection Room'
      : null;
  },
  momak(eventData) {
    return /\bcalendar\b/i.test(eventData?.title ?? '') ? 'title contains calendar' : null;
  },
  'para-site'(eventData) {
    return classifyEventTiming(eventData, toDateInTimeZone(new Date(), 'Asia/Hong_Kong')) === 'past'
      ? 'past event'
      : null;
  },
  'galerie-du-monde'(eventData) {
    return /\b(?:gdm\s+)?Taipei\b/i.test(eventData?.title ?? '') ? 'title contains Taipei' : null;
  },
  'sin-sin-fine-art'(eventData) {
    return classifyEventTiming(eventData, toDateInTimeZone(new Date(), 'Asia/Hong_Kong')) === 'past'
      ? 'past event'
      : null;
  },
};

function getSourceSpecificSkipReason(source, eventData) {
  const matcher = sourceSpecificSkipMatchers[source.slug];
  return matcher ? matcher(eventData) : null;
}

const sourceContextLoaders = {
  async momak({ userAgent, env, crawlContext, diagnostics, source, crawlRun }) {
    const accessPage = await fetchHtml(
      'https://www.momak.go.jp/English/guide/access.html',
      userAgent,
      env,
      {
        renderMode: 'never',
        context: crawlContext,
      },
    );
    recordFetchedPage(diagnostics, accessPage);
    await upsertRawPage(env, source.id, crawlRun.id, 'detail', accessPage);

    return {
      sourceContext: { accessHtml: accessPage.html },
      pagesFetched: 1,
    };
  },
  async 'sen-oku-hakukokan'({ userAgent, env, crawlContext, diagnostics, source, crawlRun }) {
    const accessPage = await fetchHtml(
      'https://sen-oku.or.jp/kyoto/facility/access',
      userAgent,
      env,
      {
        renderMode: 'never',
        context: crawlContext,
      },
    );
    recordFetchedPage(diagnostics, accessPage);
    await upsertRawPage(env, source.id, crawlRun.id, 'detail', accessPage);

    return {
      sourceContext: { accessHtml: accessPage.html },
      pagesFetched: 1,
    };
  },
  async kyotographie({ userAgent, env, crawlContext, diagnostics, source, crawlRun }) {
    const planPage = await fetchHtml(
      'https://www.kyotographie.jp/en/plan_your_visit/',
      userAgent,
      env,
      {
        renderMode: 'never',
        context: crawlContext,
      },
    );
    recordFetchedPage(diagnostics, planPage);
    await upsertRawPage(env, source.id, crawlRun.id, 'detail', planPage);

    return {
      sourceContext: {
        festivalSchedule: extractKyotographieFestivalSchedule(planPage.html),
      },
      pagesFetched: 1,
    };
  },
};

const rendererEnvKeys = [
  'PATH',
  'HOME',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'VIRTUAL_ENV',
  'PYTHONHOME',
  'PYTHONPATH',
  'PLAYWRIGHT_BROWSERS_PATH',
  'CRAWL4_AI_BASE_DIRECTORY',
  'XDG_CACHE_HOME',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
];

function buildRendererEnv(env = process.env) {
  return Object.fromEntries(
    rendererEnvKeys.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]),
  );
}

function runJsonCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs = 60000, maxOutputBytes = 20 * 1024 * 1024, ...spawnOptions } = options;
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
      killSignal: 'SIGKILL',
      ...spawnOptions,
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(error);
    };

    const appendOutput = (current, chunk) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > maxOutputBytes) {
        fail(new Error(`${command} output exceeded ${maxOutputBytes} bytes`));
        return current;
      }
      return `${current}${chunk}`;
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.on('error', fail);
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (signal) {
        reject(new Error(`${command} timed out after ${timeoutMs}ms`));
        return;
      }
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with status ${code}`));
        return;
      }

      try {
        const jsonLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? '';
        resolve(JSON.parse(jsonLine));
      } catch (error) {
        reject(new Error(`Could not parse ${command} JSON output: ${error.message}`));
      }
    });
  });
}

function appendCrawl4AiMediaHtml(html, mediaImages) {
  const imageTags = (mediaImages ?? [])
    .map((image) => {
      const src = image?.src ?? image?.url ?? image?.href ?? null;
      if (!src) return null;

      const candidate = { width: image.width, height: image.height };
      if (isUnsafeImageUrl(src) || isSmallImageCandidate(candidate, src)) return null;

      const dimensions = getImageCandidateDimensions(candidate, src);
      const width = dimensions.width ? ` width="${escapeHtmlAttribute(dimensions.width)}"` : '';
      const height = dimensions.height ? ` height="${escapeHtmlAttribute(dimensions.height)}"` : '';
      return `<img src="${escapeHtmlAttribute(src)}"${width}${height} data-crawl4ai-media="true">`;
    })
    .filter(Boolean)
    .join('');

  if (!imageTags) return html;
  return `${html}\n<div data-crawl4ai-media-images="true" hidden>${imageTags}</div>`;
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function buildStaticFetchHeaders(userAgent) {
  return {
    'user-agent': userAgent,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'ja,en-US;q=0.9,en;q=0.8',
    'cache-control': 'no-cache',
  };
}

function charsetFromContentType(value) {
  return String(value ?? '').match(/charset\s*=\s*["']?\s*([^\s;"']+)/i)?.[1] ?? null;
}

function charsetFromHtmlBytes(bytes) {
  const prefix = Buffer.from(bytes).subarray(0, 16384).toString('latin1');

  for (const match of prefix.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    if (attributes.charset) return attributes.charset;
    if (/^content-type$/i.test(attributes['http-equiv'] ?? '')) {
      const charset = charsetFromContentType(attributes.content);
      if (charset) return charset;
    }
  }

  return null;
}

function normalizeCharsetLabel(value) {
  const label = String(value ?? '')
    .trim()
    .toLowerCase();
  if (/^(?:shift[_-]?jis|sjis|x-sjis|windows-31j|ms932)$/i.test(label)) return 'shift_jis';
  return label || null;
}

function decodeHtmlResponseBytes(bytes, contentType = '') {
  const labels = [charsetFromContentType(contentType), charsetFromHtmlBytes(bytes), 'utf-8']
    .map(normalizeCharsetLabel)
    .filter((label, index, all) => label && all.indexOf(label) === index);

  for (const label of labels) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Unsupported third-party charset. Fall through to UTF-8.
    }
  }

  return new TextDecoder().decode(bytes);
}

function buildImageProbeHeaders(userAgent) {
  return {
    'user-agent': userAgent,
    accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    range: `bytes=0-${IMAGE_DIMENSION_PROBE_BYTES - 1}`,
  };
}

async function readResponsePrefix(response, byteLimit) {
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.subarray(0, byteLimit);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (total < byteLimit) {
      const { done, value } = await reader.read();
      if (done || !value) break;

      const chunk = Buffer.from(value);
      const remaining = byteLimit - total;
      chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
      total += Math.min(chunk.length, remaining);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return Buffer.concat(chunks, total);
}

async function fetchImageDimensions(url, userAgent, env, diagnostics = null) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getEnvNumber(env, 'CRAWLER_IMAGE_PROBE_TIMEOUT_MS', 10000),
  );

  try {
    await assertRobotsAllowed(url, userAgent, env, diagnostics);
    await waitForDomainDelay(url, env);
    const response = await fetchRemote(
      url,
      {
        headers: buildImageProbeHeaders(userAgent),
        signal: controller.signal,
      },
      lookupHost,
      fetch,
      async (redirectUrl) => {
        await assertRobotsAllowed(redirectUrl, userAgent, env, diagnostics);
        await waitForDomainDelay(redirectUrl, env);
      },
    );

    if (!response.ok && response.status !== 206) return null;

    const bytes = await readResponsePrefix(response, IMAGE_DIMENSION_PROBE_BYTES);
    return parseImageDimensionsFromBytes(bytes, response.headers.get('content-type') ?? '');
  } finally {
    clearTimeout(timeout);
  }
}

function classifyFetchResult({ response = null, html = '', error = null }) {
  if (error) {
    return error?.name === 'TimeoutError' || /timeout|aborted/i.test(error.message ?? '')
      ? 'timeout'
      : 'network_error';
  }

  if (!response) return 'network_error';

  const status = response.status;
  const contentType = response.headers.get('content-type') ?? '';
  const normalizedHtml = html.slice(0, 20000).toLowerCase();
  const htmlWithoutScripts = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ');
  const visibleText = stripTags(htmlWithoutScripts).replace(/\s+/g, ' ').trim();
  const visibleTextLower = visibleText.toLowerCase();
  const titleText = stripTags(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  if (status === 429) return 'rate_limited';
  if ([408, 425, 500, 502, 503, 504].includes(status)) return 'transient_error';
  if ([401, 403].includes(status)) return 'forbidden';
  if (!response.ok) return 'http_error';
  if (contentType && !/html|xml|text\/plain/i.test(contentType)) return 'not_html';

  const hasChallengeTitle =
    /\b(just a moment|access denied|attention required|captcha|security check|request blocked)\b/i.test(
      titleText,
    );
  const hasChallengeMarkup = /\b(cf-browser-verification|cf-chl-)\b/i.test(normalizedHtml);
  const hasShortChallengeText =
    visibleText.length < 2000 &&
    /\b(checking your browser|enable cookies|access denied|request blocked|captcha|cloudflare)\b/i.test(
      visibleTextLower,
    );

  if (hasChallengeTitle || hasChallengeMarkup || hasShortChallengeText) {
    return 'bot_challenge';
  }

  if (
    visibleText.length < 500 &&
    /enable javascript|requires javascript|javascript is disabled|<noscript|id=["'](__next|root|app)["']|data-reactroot|webpackJsonp|window\.__NUXT__/i.test(
      html,
    )
  ) {
    return 'js_shell';
  }

  if (html.trim().length < 200) return 'empty_or_suspicious';

  return 'ok';
}

function isRetryableFetchClassification(classification) {
  return ['timeout', 'network_error', 'rate_limited', 'transient_error'].includes(classification);
}

function shouldTryRenderFallback(fetched) {
  return ['js_shell', 'empty_or_suspicious'].includes(fetched?.metadata?.fetch_classification);
}

function getRetryAfterDelayMs(response) {
  const retryAfter = response?.headers?.get('retry-after');
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(retryAfter);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function getRetryDelayMs({ attempt, baseDelayMs, response = null, maxDelayMs = 60000 }) {
  const retryAfterDelayMs = getRetryAfterDelayMs(response);
  const delayMs =
    retryAfterDelayMs ??
    baseDelayMs * 2 ** Math.max(0, attempt - 1) +
      Math.floor(Math.random() * Math.min(baseDelayMs, 1000));
  return Math.min(delayMs, maxDelayMs);
}

function getRandomDelayMs(minDelayMs, maxDelayMs) {
  const lower = Math.max(0, Math.min(minDelayMs, maxDelayMs));
  const upper = Math.max(lower, maxDelayMs);
  return lower + Math.floor(Math.random() * (upper - lower + 1));
}

function createCrawlDiagnostics(env = {}) {
  return {
    fetched_static_count: 0,
    fetched_crawl4ai_count: 0,
    retry_count: 0,
    bot_challenge_count: 0,
    js_shell_count: 0,
    empty_or_suspicious_count: 0,
    missing_image_count: 0,
    skipped_past_count: 0,
    skipped_old_count: 0,
    skipped_missing_date_count: 0,
    skipped_missing_description_count: 0,
    skipped_invalid_title_count: 0,
    skipped_other_count: 0,
    crawl4ai_render_count: 0,
    crawl4ai_render_limit: getEnvNumber(env, 'CRAWL4AI_MAX_RENDERS_PER_SOURCE', 5),
    crawl4ai_render_skipped_count: 0,
    detail_limit_hit_count: 0,
    detail_page_cache_hit_count: 0,
    image_dimension_probe_count: 0,
    image_dimension_probe_rejected_count: 0,
    image_dimension_probe_failed_count: 0,
    robots_checked_count: 0,
    robots_blocked_count: 0,
    unhealthy_fetch_count: 0,
    date_extractions: [],
    title_extractions: [],
    title_render_retry_count: 0,
    description_extractions: [],
    description_recovered_count: 0,
    description_rejected_count: 0,
    description_missing_count: 0,
  };
}

function recordFetchedPage(diagnostics, fetched) {
  if (!diagnostics || !fetched?.metadata) return;

  if (fetched.metadata.fetched_via === 'crawl4ai') {
    diagnostics.fetched_crawl4ai_count += 1;
  } else if (fetched.metadata.fetched_via === 'fetch') {
    diagnostics.fetched_static_count += 1;
  }

  const classification = fetched.metadata.fetch_classification;
  if (classification === 'bot_challenge') diagnostics.bot_challenge_count += 1;
  if (classification === 'js_shell') diagnostics.js_shell_count += 1;
  if (classification === 'empty_or_suspicious') diagnostics.empty_or_suspicious_count += 1;
  if (
    classification &&
    !['ok', 'js_shell', 'empty_or_suspicious', 'bot_challenge'].includes(classification)
  ) {
    diagnostics.unhealthy_fetch_count += 1;
  }

  const attempts = Number(fetched.metadata.fetch_attempts ?? 1);
  if (Number.isFinite(attempts) && attempts > 1) {
    diagnostics.retry_count += attempts - 1;
  }

  const fallbackClassification = fetched.metadata.fallback_from?.fetch_classification;
  if (fallbackClassification === 'bot_challenge') diagnostics.bot_challenge_count += 1;
  if (fallbackClassification === 'js_shell') diagnostics.js_shell_count += 1;
  if (fallbackClassification === 'empty_or_suspicious') diagnostics.empty_or_suspicious_count += 1;
}

function recordSkippedEvent(diagnostics, reason) {
  if (!diagnostics) return;

  if (reason === 'missing image') {
    diagnostics.missing_image_count += 1;
  } else if (reason === 'past event') {
    diagnostics.skipped_past_count += 1;
  } else if (/older than/.test(reason ?? '')) {
    diagnostics.skipped_old_count += 1;
  } else if (reason === 'missing verifiable event date') {
    diagnostics.skipped_missing_date_count += 1;
  } else if (reason === 'missing valid description') {
    diagnostics.skipped_missing_description_count += 1;
  } else if (/^invalid event title/.test(reason ?? '')) {
    diagnostics.skipped_invalid_title_count += 1;
  } else {
    diagnostics.skipped_other_count += 1;
  }
}

function recordTitleExtraction(diagnostics, event) {
  if (!diagnostics || diagnostics.title_extractions.length >= 20) return;

  diagnostics.title_extractions.push({
    url: event?.source_url ?? null,
    title: event?.title ?? null,
    origin: event?._title_origin ?? 'unknown',
    valid: hasValidEventTitle(event),
    warnings: event?._title_warnings ?? [],
    candidates: event?._title_candidates ?? [],
  });
}

function recordDescriptionExtraction(diagnostics, event) {
  if (!diagnostics) return;

  if (event?._description_recovered) diagnostics.description_recovered_count += 1;
  if (!event?._description_valid && event?._description_rejections?.length) {
    diagnostics.description_rejected_count += 1;
  }
  if (!event?.description) diagnostics.description_missing_count += 1;
  if (diagnostics.description_extractions.length >= 20) return;

  diagnostics.description_extractions.push({
    url: event?.source_url ?? null,
    origin: event?._description_origin ?? 'unknown',
    valid: event?._description_valid !== false && Boolean(event?.description),
    recovered: Boolean(event?._description_recovered),
    rejections: event?._description_rejections ?? [],
  });
}

function pushSkippedEvent(skippedEvents, diagnostics, skippedEvent) {
  skippedEvents.push(skippedEvent);
  recordSkippedEvent(diagnostics, skippedEvent.reason);
}

function classifySourceOutcome({
  detailUrls = [],
  savedEvents = [],
  skippedEvents = [],
  diagnostics = {},
  usedGenericExtractor = false,
  sourceSlug = null,
}) {
  const hasFetchHealthIssue =
    diagnostics.bot_challenge_count > 0 ||
    diagnostics.js_shell_count > 0 ||
    diagnostics.empty_or_suspicious_count > 0 ||
    diagnostics.crawl4ai_render_skipped_count > 0 ||
    diagnostics.detail_limit_hit_count > 0 ||
    diagnostics.robots_blocked_count > 0 ||
    diagnostics.unhealthy_fetch_count > 0;

  if (!detailUrls.length) {
    if (hasFetchHealthIssue) return 'source_blocked';
    return emptyDetailUrlsMeanNoCurrentEventSources.has(sourceSlug)
      ? 'source_no_current_events'
      : 'source_empty';
  }

  if (
    diagnostics.skipped_invalid_title_count > 0 ||
    diagnostics.skipped_missing_description_count > 0 ||
    diagnostics.description_rejected_count > 0 ||
    diagnostics.description_missing_count > 0 ||
    (savedEvents.length > 0 &&
      (diagnostics.missing_image_count > 0 || diagnostics.skipped_missing_date_count > 0))
  ) {
    return 'source_needs_review';
  }

  if (savedEvents.length > 0 && hasFetchHealthIssue) return 'source_degraded';
  if (savedEvents.length > 0) return 'source_ok';
  if (hasFetchHealthIssue) return 'source_blocked';
  if (
    skippedEvents.length &&
    skippedEvents.every((event) => /past event|older than/.test(event.reason ?? ''))
  ) {
    return 'source_no_current_events';
  }
  if (
    missingDateCanMeanNoCurrentEventSources.has(sourceSlug) &&
    skippedEvents.length &&
    skippedEvents.every((event) =>
      /past event|older than|missing verifiable event date/.test(event.reason ?? ''),
    )
  ) {
    return 'source_no_current_events';
  }
  if (
    diagnostics.missing_image_count > 0 ||
    diagnostics.skipped_missing_date_count > 0 ||
    diagnostics.skipped_missing_description_count > 0
  ) {
    return 'source_needs_review';
  }
  return 'source_empty';
}

function crawlRunStatusForOutcome(sourceOutcome) {
  return ['source_ok', 'source_no_current_events'].includes(sourceOutcome)
    ? 'success'
    : sourceOutcome === 'source_failed'
      ? 'failed'
      : 'partial_success';
}

function shouldArchiveStaleEvents({
  sourceOutcome,
  diagnostics = {},
  skippedEvents = [],
  discoveryComplete = true,
}) {
  if (!discoveryComplete || !['source_ok', 'source_no_current_events'].includes(sourceOutcome)) {
    return false;
  }

  if (
    diagnostics.bot_challenge_count > 0 ||
    diagnostics.js_shell_count > 0 ||
    diagnostics.empty_or_suspicious_count > 0 ||
    diagnostics.crawl4ai_render_skipped_count > 0 ||
    diagnostics.detail_limit_hit_count > 0 ||
    diagnostics.robots_blocked_count > 0 ||
    diagnostics.unhealthy_fetch_count > 0
  ) {
    return false;
  }

  return skippedEvents.every((event) => /past event|older than/.test(event.reason ?? ''));
}

async function waitForDomainDelay(url, env) {
  const minDelayMs = getEnvNumber(env, 'CRAWLER_MIN_DELAY_MS', 1000);
  const maxDelayMs = getEnvNumber(env, 'CRAWLER_MAX_DELAY_MS', 3000);
  if (maxDelayMs <= 0) return;

  let hostname = null;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return;
  }

  const now = Date.now();
  const availableAt = domainFetchSchedule.get(hostname) ?? 0;
  const waitMs = Math.max(0, availableAt - now);
  const nextAvailableAt = Math.max(now, availableAt) + getRandomDelayMs(minDelayMs, maxDelayMs);
  domainFetchSchedule.set(hostname, nextAvailableAt);

  if (waitMs > 0) {
    await sleep(waitMs);
  }
}

async function assertRobotsAllowed(url, userAgent, env, diagnostics = null) {
  if (!envFlag(env, 'CRAWLER_RESPECT_ROBOTS_TXT', true)) return;

  const target = new URL(url);
  const cacheKey = `${target.origin}\n${String(userAgent).toLowerCase()}`;
  let robotsText = robotsPolicyCache.get(cacheKey);

  if (robotsText === undefined) {
    const robotsUrl = new URL('/robots.txt', target).toString();
    try {
      await waitForDomainDelay(robotsUrl, env);
      const response = await fetchRemote(
        robotsUrl,
        {
          headers: buildStaticFetchHeaders(userAgent),
          signal: AbortSignal.timeout(getEnvNumber(env, 'CRAWLER_ROBOTS_TIMEOUT_MS', 10000)),
        },
        lookupHost,
        fetch,
        async (redirectUrl) => {
          await waitForDomainDelay(redirectUrl, env);
        },
      );
      robotsText = response.ok
        ? (await response.text()).slice(0, 512 * 1024)
        : response.status >= 400 && response.status < 500
          ? ''
          : 'User-agent: *\nDisallow: /';
    } catch {
      // RFC 9309 requires complete disallow while robots.txt is unreachable.
      robotsText = 'User-agent: *\nDisallow: /';
    }
    robotsPolicyCache.set(cacheKey, robotsText);
    if (diagnostics) diagnostics.robots_checked_count += 1;
  }

  if (!isUrlAllowedByRobotsText(robotsText, userAgent, url)) {
    if (diagnostics) diagnostics.robots_blocked_count += 1;
    throw new Error(`robots.txt disallows crawler URL: ${url}`);
  }
}

async function resolveRendererNavigationUrl(
  url,
  userAgent,
  env,
  context = null,
  {
    lookup = lookupHost,
    fetchImpl = fetch,
    assertRobotsAllowedFn = assertRobotsAllowed,
    waitForDomainDelayFn = waitForDomainDelay,
  } = {},
) {
  const allowedDomains = context?.allowedDomains ?? [];
  const assertAllowedDomain = (candidateUrl) => {
    if (
      allowedDomains.length &&
      !sourceAllowsUrl({ allowed_domains: allowedDomains }, candidateUrl)
    ) {
      throw new Error(`Blocked crawler URL outside allowed domains: ${candidateUrl}`);
    }
  };
  let finalUrl = (await assertSafeRemoteUrl(url, lookup)).toString();

  assertAllowedDomain(finalUrl);
  await assertRobotsAllowedFn(finalUrl, userAgent, env, context?.diagnostics);
  await waitForDomainDelayFn(finalUrl, env);

  const response = await fetchRemote(
    finalUrl,
    {
      headers: buildStaticFetchHeaders(userAgent),
      signal: AbortSignal.timeout(getEnvNumber(env, 'CRAWLER_FETCH_TIMEOUT_MS', 30000)),
    },
    lookup,
    fetchImpl,
    async (redirectUrl) => {
      const destinationUrl = redirectUrl.toString();
      assertAllowedDomain(destinationUrl);
      await assertRobotsAllowedFn(destinationUrl, userAgent, env, context?.diagnostics);
      await waitForDomainDelayFn(destinationUrl, env);
      finalUrl = destinationUrl;
    },
  );
  await response.body?.cancel().catch(() => {});

  // Browser starts at resolved URL. Extra delay accounts for second network request.
  await waitForDomainDelayFn(finalUrl, env);
  return finalUrl;
}

async function fetchHtmlWithCrawl4Ai(url, userAgent, env, context = null) {
  if (crawl4AiDisabled) return null;

  const diagnostics = context?.diagnostics;
  if (
    diagnostics &&
    diagnostics.crawl4ai_render_limit > 0 &&
    diagnostics.crawl4ai_render_count >= diagnostics.crawl4ai_render_limit
  ) {
    diagnostics.crawl4ai_render_skipped_count += 1;
    return null;
  }

  if (diagnostics) {
    diagnostics.crawl4ai_render_count += 1;
  }

  const pythonBinary = env.CRAWL4AI_PYTHON ?? 'python3';

  try {
    const rendererUrl = await resolveRendererNavigationUrl(url, userAgent, env, context);
    const args = [
      crawl4AiFetchPath,
      rendererUrl,
      '--user-agent',
      userAgent,
      '--timeout-ms',
      env.CRAWL4AI_PAGE_TIMEOUT_MS ?? '45000',
      '--scroll-delay',
      env.CRAWL4AI_SCROLL_DELAY ?? '0.5',
    ];

    if (context?.waitFor) args.push('--wait-for', context.waitFor);
    for (const targetElement of context?.targetElements ?? []) {
      args.push('--target-element', targetElement);
    }
    if (context?.waitForImages ?? envFlag(env, 'CRAWL4AI_WAIT_FOR_IMAGES', true)) {
      args.push('--wait-for-images');
    }
    if (context?.scanFullPage ?? envFlag(env, 'CRAWL4AI_SCAN_FULL_PAGE', false)) {
      args.push('--scan-full-page');
    }
    if (envFlag(env, 'CRAWL4AI_BYPASS_CACHE', true)) args.push('--bypass-cache');
    for (const domain of context?.allowedDomains ?? []) {
      args.push('--allowed-domain', domain);
    }

    const result = await runJsonCommand(pythonBinary, args, {
      env: {
        ...buildRendererEnv(process.env),
        PYTHONUNBUFFERED: '1',
      },
      timeoutMs: getEnvNumber(
        env,
        'CRAWL4AI_COMMAND_TIMEOUT_MS',
        getEnvNumber(env, 'CRAWL4AI_PAGE_TIMEOUT_MS', 45000) + 30000,
      ),
      maxOutputBytes: getEnvNumber(env, 'CRAWL4AI_MAX_OUTPUT_BYTES', 20 * 1024 * 1024),
    });

    if (!result.success) {
      if (diagnostics) diagnostics.unhealthy_fetch_count += 1;
      const message = result.error_message ?? 'Crawl4AI render failed';
      if (/No module named|ModuleNotFoundError|ImportError|not found/i.test(message)) {
        crawl4AiDisabled = true;
        console.warn(`Crawl4AI render unavailable; continuing with static fetches. ${message}`);
      } else {
        console.warn(`Crawl4AI render failed for ${url}; continuing with static fetch. ${message}`);
      }
      return null;
    }

    const finalUrl = (await assertSafeRemoteUrl(result.url ?? rendererUrl)).toString();
    if (
      context?.allowedDomains?.length &&
      !sourceAllowsUrl({ allowed_domains: context.allowedDomains }, finalUrl)
    ) {
      throw new Error(`Blocked crawler redirect outside allowed domains: ${finalUrl}`);
    }
    if (canonicalizeComparableUrl(finalUrl) !== canonicalizeComparableUrl(rendererUrl)) {
      await assertRobotsAllowed(finalUrl, userAgent, env, diagnostics);
    }

    const html = appendCrawl4AiMediaHtml(result.html ?? '', result.media?.images ?? []);
    return {
      url,
      response: {
        url: result.url ?? rendererUrl,
        status: result.status_code ?? 200,
      },
      html,
      cleanedHtml: result.cleaned_html ?? '',
      fitHtml: result.fit_html ?? '',
      title:
        result.metadata?.title ??
        result.title ??
        html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ??
        null,
      contentType: 'text/html; charset=utf-8',
      metadata: {
        fetched_via: 'crawl4ai',
        crawl4ai_images_count: result.media?.images?.length ?? 0,
        crawl4ai_blocked_request_count: result.blocked_request_count ?? 0,
        crawl4ai_version: result.crawl4ai_version ?? null,
        crawl4ai_duration_ms: result.duration_ms ?? null,
        crawl4ai_cleaned_html_length: result.cleaned_html?.length ?? 0,
        crawl4ai_fit_html_length: result.fit_html?.length ?? 0,
        redirected_status_code: result.redirected_status_code ?? null,
      },
    };
  } catch (error) {
    if (diagnostics) diagnostics.unhealthy_fetch_count += 1;
    const message = error instanceof Error ? error.message : String(error);
    if (/No module named|ModuleNotFoundError|ImportError|ENOENT|not found/i.test(message)) {
      crawl4AiDisabled = true;
    }
    console.warn(`Crawl4AI render unavailable; continuing with static fetches. ${message}`);
    return null;
  }
}

async function fetchStaticHtml(url, userAgent, env = {}, context = null) {
  const timeoutMs = getEnvNumber(env, 'CRAWLER_FETCH_TIMEOUT_MS', 30000);
  const maxRetries = getEnvNumber(env, 'CRAWLER_FETCH_RETRIES', 2);
  const baseDelayMs = getEnvNumber(env, 'CRAWLER_RETRY_BASE_DELAY_MS', 1000);
  const retryLog = [];
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    let response = null;
    let html = '';
    let classification = 'network_error';

    try {
      await waitForDomainDelay(url, env);
      response = await fetchRemote(
        url,
        {
          headers: buildStaticFetchHeaders(userAgent),
          signal: AbortSignal.timeout(timeoutMs),
        },
        lookupHost,
        fetch,
        async (redirectUrl) => {
          if (
            context?.allowedDomains?.length &&
            !sourceAllowsUrl({ allowed_domains: context.allowedDomains }, redirectUrl)
          ) {
            throw new Error(`Blocked crawler redirect outside allowed domains: ${redirectUrl}`);
          }
          await assertRobotsAllowed(redirectUrl, userAgent, env, context?.diagnostics);
          await waitForDomainDelay(redirectUrl, env);
        },
      );
      html = decodeHtmlResponseBytes(
        await response.arrayBuffer(),
        response.headers.get('content-type') ?? '',
      );
      classification = classifyFetchResult({ response, html });
      lastError = null;
    } catch (error) {
      lastError = error;
      classification = classifyFetchResult({ error });
    }

    retryLog.push({
      attempt,
      classification,
      status: response?.status ?? null,
      final_url: response?.url ?? null,
    });

    if (!isRetryableFetchClassification(classification) || attempt > maxRetries) {
      if (!response && lastError) {
        throw new Error(
          `Fetch failed for ${url} after ${attempt} attempt${attempt === 1 ? '' : 's'}: ${lastError.message}`,
        );
      }

      return {
        url,
        response,
        html,
        title: html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
        contentType: response.headers.get('content-type'),
        metadata: {
          fetched_via: 'fetch',
          fetch_classification: classification,
          fetch_attempts: attempt,
          fetch_timeout_ms: timeoutMs,
          retry_log: retryLog,
        },
      };
    }

    const delayMs = getRetryDelayMs({
      attempt,
      baseDelayMs,
      response,
      maxDelayMs: getEnvNumber(env, 'CRAWLER_MAX_RETRY_DELAY_MS', 60000),
    });
    await sleep(delayMs);
  }

  throw new Error(`Fetch failed for ${url}`);
}

async function fetchHtml(url, userAgent, env = {}, options = {}) {
  await assertRobotsAllowed(url, userAgent, env, options.context?.diagnostics);

  if (options.renderMode === 'always') {
    const rendered = await fetchHtmlWithCrawl4Ai(url, userAgent, env, options.context);
    if (rendered) return rendered;
  }

  const staticPage = await fetchStaticHtml(url, userAgent, env, options.context);

  if (options.renderMode === 'auto' && shouldTryRenderFallback(staticPage)) {
    const rendered = await fetchHtmlWithCrawl4Ai(url, userAgent, env, options.context);
    if (rendered) {
      return {
        ...rendered,
        metadata: {
          ...rendered.metadata,
          fallback_from: staticPage.metadata,
        },
      };
    }
  }

  return staticPage;
}

async function supabaseRequest({ env, path, method = 'GET', body = null }) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(getEnvNumber(env, 'CRAWLER_API_TIMEOUT_MS', 30000)),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Supabase request failed (${response.status}) for ${path}: ${errorText}`);
  }

  return response.status === 204 ? null : response.json();
}

async function getSourceBySlug(env, slug) {
  const rows = await supabaseRequest({
    env,
    path: `sources?slug=eq.${encodeURIComponent(slug)}&select=*`,
  });

  if (!rows?.length) {
    throw new Error(`Could not find source with slug "${slug}" in public.sources`);
  }

  return rows[0];
}

async function createCrawlRun(env, sourceId) {
  const rows = await supabaseRequest({
    env,
    path: 'crawl_runs',
    method: 'POST',
    body: [
      {
        source_id: sourceId,
        status: 'running',
        trigger_type: 'manual',
        started_at: new Date().toISOString(),
      },
    ],
  });

  return rows[0];
}

async function recoverStaleCrawlRuns(env, sourceId, request = supabaseRequest, now = new Date()) {
  const finishedAt = now.toISOString();
  const staleBefore = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
  const rows = await request({
    env,
    path: `crawl_runs?source_id=eq.${encodeURIComponent(
      sourceId,
    )}&status=eq.running&started_at=lt.${encodeURIComponent(staleBefore)}`,
    method: 'PATCH',
    body: {
      status: 'failed',
      finished_at: finishedAt,
      error_message: 'Recovered stale crawl run before starting a new source crawl.',
    },
  });

  return rows?.length ?? 0;
}

async function updateCrawlRun(env, crawlRunId, patch) {
  const rows = await supabaseRequest({
    env,
    path: `crawl_runs?id=eq.${crawlRunId}`,
    method: 'PATCH',
    body: patch,
  });

  return rows?.[0] ?? null;
}

async function upsertRawPage(env, sourceId, crawlRunId, pageKind, fetched) {
  const sanitizedHtml = sanitizePostgresText(fetched.html);
  const contentHash = createHash('sha256').update(sanitizedHtml).digest('hex');
  const rows = await supabaseRequest({
    env,
    path: 'raw_pages?on_conflict=source_id,url,content_hash',
    method: 'POST',
    body: [
      {
        source_id: sourceId,
        crawl_run_id: crawlRunId,
        url: sanitizePostgresText(fetched.url),
        canonical_url: sanitizePostgresText(fetched.response.url),
        page_kind: pageKind,
        http_status: fetched.response.status,
        content_type: sanitizePostgresText(fetched.contentType),
        title: sanitizePostgresText(fetched.title),
        raw_html: sanitizedHtml,
        extracted_text: sanitizePostgresText(stripTags(sanitizedHtml).slice(0, 5000)),
        metadata: sanitizePostgresJson({
          ...(fetched.metadata ?? {}),
          final_url: fetched.response.url,
        }),
        content_hash: contentHash,
        fetched_at: new Date().toISOString(),
      },
    ],
  });

  return rows[0];
}

async function upsertEvent(env, sourceId, rawPageId, eventData, dedupeKey, fetchImpl = fetch) {
  buildScheduleSegmentRows('__preflight__', eventData);

  const persistedEventData = Object.fromEntries(
    Object.entries(eventData).filter(
      ([key]) => !key.startsWith('_') && key !== 'schedule_segments',
    ),
  );
  const eventPayload = {
    ...persistedEventData,
    source_id: sourceId,
    raw_page_id: rawPageId,
    dedupe_key: dedupeKey,
    status: 'draft',
    extraction_confidence: persistedEventData.extraction_confidence ?? 0.6,
    last_seen_at: new Date().toISOString(),
  };

  const response = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/events?on_conflict=dedupe_key`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: 'return=representation,resolution=merge-duplicates',
    },
    body: JSON.stringify([eventPayload]),
    signal: AbortSignal.timeout(getEnvNumber(env, 'CRAWLER_API_TIMEOUT_MS', 30000)),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Supabase request failed (${response.status}) for events?on_conflict=dedupe_key: ${errorText}`,
    );
  }

  const rows = await response.json();
  return rows[0];
}

async function assertScheduleSegmentStorage(env, request = supabaseRequest) {
  await request({
    env,
    path: 'event_schedule_segments?select=id&limit=0',
  });
}

async function publishEvent(env, eventId, request = supabaseRequest) {
  const rows = await request({
    env,
    path: `events?id=eq.${encodeURIComponent(eventId)}`,
    method: 'PATCH',
    body: { status: 'published' },
  });

  return rows?.[0] ?? null;
}

function normalizeTranslationSourceField(value) {
  if (value == null) return null;

  return String(value).normalize('NFC').replace(/\r\n?/g, '\n').trim();
}

function buildTranslationSourceContentHash(eventData) {
  const canonicalSourceContent = localizedEventFields.map((field) => [
    field,
    normalizeTranslationSourceField(eventData?.[field]),
  ]);

  return createHash('sha256').update(JSON.stringify(canonicalSourceContent)).digest('hex');
}

function assertTranslationSourceContentHash(sourceContentHash) {
  if (!/^[0-9a-f]{64}$/.test(sourceContentHash ?? '')) {
    throw new Error('Translation source content hash must be a lowercase SHA-256 hex digest');
  }
}

function buildEventTranslationPayload(eventId, locale, eventData, sourceContentHash) {
  assertTranslationSourceContentHash(sourceContentHash);

  return {
    event_id: eventId,
    locale,
    title: eventData.title,
    description: eventData.description ?? null,
    source_content_hash: sourceContentHash,
  };
}

async function upsertEventTranslation(env, eventId, locale, eventData, sourceContentHash) {
  const normalizedLocale = normalizeLocaleCode(locale);
  if (!normalizedLocale) return null;

  const rows = await supabaseRequest({
    env,
    path: 'event_translations?on_conflict=event_id,locale',
    method: 'POST',
    body: [buildEventTranslationPayload(eventId, normalizedLocale, eventData, sourceContentHash)],
  });

  return rows?.[0] ?? null;
}

async function reconcileUnavailableTargetTranslation(
  env,
  eventId,
  locale,
  sourceContentHash,
  request = supabaseRequest,
) {
  const normalizedLocale = normalizeLocaleCode(locale);
  if (!normalizedLocale) throw new Error(`Unsupported translation locale: ${locale}`);
  assertTranslationSourceContentHash(sourceContentHash);

  const filterPath = `event_translations?event_id=eq.${encodeURIComponent(
    eventId,
  )}&locale=eq.${encodeURIComponent(normalizedLocale)}`;
  const rows = await request({
    env,
    path: `${filterPath}&select=source_content_hash&limit=1`,
  });
  const existing = rows?.[0] ?? null;

  if (!existing) return 'missing';
  if (existing.source_content_hash === sourceContentHash) return 'preserved';

  await request({
    env,
    path: filterPath,
    method: 'DELETE',
  });
  return 'deleted';
}

function getGoogleTranslateProjectId(env) {
  return env.GOOGLE_TRANSLATE_PROJECT_ID ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT ?? null;
}

async function getGoogleTranslationClient() {
  if (!googleTranslationClientPromise) {
    googleTranslationClientPromise = import('@google-cloud/translate').then((module) => {
      const TranslationServiceClient =
        module.TranslationServiceClient ??
        module.v3?.TranslationServiceClient ??
        module.default?.TranslationServiceClient ??
        module.default?.v3?.TranslationServiceClient;

      if (!TranslationServiceClient) {
        throw new Error('Could not find TranslationServiceClient in @google-cloud/translate');
      }

      return new TranslationServiceClient();
    });
  }

  return googleTranslationClientPromise;
}

async function translateTextFields(env, fields, sourceLocale, targetLocale) {
  const projectId = getGoogleTranslateProjectId(env);
  if (!projectId) {
    if (!missingGoogleTranslateConfigWarningShown) {
      console.warn(
        'Machine translation disabled: set GOOGLE_TRANSLATE_PROJECT_ID or GOOGLE_CLOUD_PROJECT plus Google credentials.',
      );
      missingGoogleTranslateConfigWarningShown = true;
    }
    return null;
  }

  const entries = Object.entries(fields).filter(([, value]) => {
    return typeof value === 'string' && value.trim();
  });

  if (!entries.length) return {};

  const location = env.GOOGLE_TRANSLATE_LOCATION ?? 'global';
  const client = env.__translationClient ?? (await getGoogleTranslationClient());
  const [response] = await client.translateText(
    {
      parent: `projects/${projectId}/locations/${location}`,
      contents: entries.map(([, value]) => value),
      mimeType: 'text/plain',
      sourceLanguageCode: sourceLocale,
      targetLanguageCode: targetLocale,
    },
    { timeout: getEnvNumber(env, 'CRAWLER_API_TIMEOUT_MS', 30000) },
  );
  const translations = response?.translations ?? [];

  return Object.fromEntries(
    entries.map(([field], index) => [field, translations[index]?.translatedText ?? fields[field]]),
  );
}

async function buildMachineTranslatedEvent(env, eventData, sourceLocale, targetLocale) {
  const fields = Object.fromEntries(
    localizedEventFields.map((field) => [field, eventData[field] ?? null]),
  );
  const translatedFields = await translateTextFields(env, fields, sourceLocale, targetLocale);

  if (!translatedFields) return null;

  return {
    ...eventData,
    ...translatedFields,
    source_url: eventData.source_url,
    title: translatedFields.title ?? eventData.title,
    description: translatedFields.description ?? eventData.description,
  };
}

async function fetchNativeLocaleEvent({
  env,
  source,
  sourceLocale,
  targetLocale,
  canonicalEvent,
  detailPage,
  detailUrl,
  eventExtractor,
  sourceContext,
  userAgent,
  renderMode,
  crawlContext,
  diagnostics,
}) {
  const discoveredLocaleUrls = extractLocaleUrlsFromHtml(detailPage.html, detailUrl);
  const alternateUrl =
    discoveredLocaleUrls[targetLocale] ??
    inferAlternateLocaleUrlFromConfig(detailUrl, source, sourceLocale, targetLocale);

  const nativeSource = withSourceLocaleConfig(source, targetLocale);

  if (!isUsableNativeLocaleUrl(detailUrl, alternateUrl, nativeSource)) {
    return null;
  }

  try {
    const nativePage = await fetchHtml(alternateUrl, userAgent, env, {
      renderMode,
      context: {
        ...crawlContext,
        targetElements: selectorsFor(nativeSource, 'description'),
      },
    });
    recordFetchedPage(diagnostics, nativePage);

    const finalUrl = nativePage.response?.url ?? nativePage.url;
    if (canonicalizeComparableUrl(finalUrl) !== canonicalizeComparableUrl(alternateUrl)) {
      throw new Error(`alternate URL redirected to ${finalUrl}`);
    }

    const nativeEvent = resolveEventDescription(
      assessEventTitle(
        normalizeEventSourceTruth(
          eventExtractor(nativePage.html, nativeSource, alternateUrl, sourceContext),
          nativeSource,
        ),
        nativeSource,
        eventExtractor === extractGenericEvent ? 'generic_fallback' : 'source_specific_extractor',
      ),
      nativeSource,
      nativePage,
    );

    if (
      nativeEvent.source_url &&
      canonicalizeComparableUrl(nativeEvent.source_url) !== canonicalizeComparableUrl(alternateUrl)
    ) {
      throw new Error(`alternate page extracted source URL ${nativeEvent.source_url}`);
    }

    if (!hasValidEventTitle(nativeEvent)) {
      throw new Error(`alternate page title invalid: ${nativeEvent._title_warnings.join(', ')}`);
    }

    if (!nativeLocaleEventMatchesCanonical(canonicalEvent, nativeEvent)) {
      throw new Error('alternate page dates did not match canonical event');
    }

    return {
      locale: targetLocale,
      event: nativeEvent,
      page: nativePage,
      url: alternateUrl,
    };
  } catch (error) {
    console.warn(
      `Native ${targetLocale} translation skipped for ${detailUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return null;
  }
}

async function upsertEventTranslations(
  env,
  source,
  savedEvent,
  eventData,
  nativeTranslations = {},
) {
  const sourceLocale = getSourceLocale(source);
  const sourceContentHash = buildTranslationSourceContentHash(eventData);
  const savedTranslations = [sourceLocale];

  await upsertEventTranslation(env, savedEvent.id, sourceLocale, eventData, sourceContentHash);

  for (const targetLocale of supportedTranslationLocales) {
    if (targetLocale === sourceLocale) continue;

    const nativeTranslation = nativeTranslations[targetLocale];
    if (nativeTranslation) {
      try {
        await upsertEventTranslation(
          env,
          savedEvent.id,
          targetLocale,
          nativeTranslation,
          sourceContentHash,
        );
        savedTranslations.push(targetLocale);
        continue;
      } catch (error) {
        console.warn(
          `Native ${targetLocale} translation upsert failed for ${savedEvent.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } else if (shouldMachineTranslateMissingLocales(source)) {
      try {
        const translatedEvent = await buildMachineTranslatedEvent(
          env,
          eventData,
          sourceLocale,
          targetLocale,
        );

        if (translatedEvent) {
          await upsertEventTranslation(
            env,
            savedEvent.id,
            targetLocale,
            translatedEvent,
            sourceContentHash,
          );
          savedTranslations.push(targetLocale);
          continue;
        }
      } catch (error) {
        console.warn(
          `Machine translation skipped for ${savedEvent.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    const reconciliation = await reconcileUnavailableTargetTranslation(
      env,
      savedEvent.id,
      targetLocale,
      sourceContentHash,
    );
    if (reconciliation === 'preserved') {
      savedTranslations.push(targetLocale);
    }
  }

  return savedTranslations;
}

async function archiveStaleEvents(env, sourceId, activeDedupeKeys, request = supabaseRequest) {
  const rows = [];
  let offset = 0;

  while (true) {
    const page =
      (await request({
        env,
        path: `events?source_id=eq.${encodeURIComponent(
          sourceId,
        )}&status=eq.published&select=id,dedupe_key&order=id.asc&limit=1000&offset=${offset}`,
      })) ?? [];
    if (!page.length) break;

    rows.push(...page);
    offset += page.length;
  }

  const staleIds = rows.filter((row) => !activeDedupeKeys.has(row.dedupe_key)).map((row) => row.id);

  let archivedCount = 0;

  for (let index = 0; index < staleIds.length; index += 100) {
    const staleIdBatch = staleIds.slice(index, index + 100);
    const archivedRows = await request({
      env,
      path: `events?id=in.(${staleIdBatch.join(',')})`,
      method: 'PATCH',
      body: {
        status: 'archived',
      },
    });

    archivedCount += archivedRows?.length ?? 0;
  }

  return archivedCount;
}

function hasExtractedImage(eventData) {
  return (
    Boolean(eventData?.primary_image_url) ||
    (Array.isArray(eventData?.image_urls) && eventData.image_urls.some(Boolean))
  );
}

function getInvalidRequiredEventFields(eventData) {
  const invalidFields = [];

  if (!hasValidEventTitle(eventData)) invalidFields.push('title');
  if (!hasVerifiedEventDate(eventData)) invalidFields.push('date');
  if (!hasValidEventDescription(eventData)) invalidFields.push('description');
  if (!hasUsableImageCandidate(eventData)) invalidFields.push('image');

  return invalidFields;
}

function hasUsableImageCandidate(eventData) {
  const baseUrl = eventData?.source_url;
  return getEventImageCandidates(eventData).some((imageUrl) => {
    const normalizedUrl = normalizeUrl(imageUrl, baseUrl);
    return (
      normalizedUrl && !isUnsafeImageUrl(normalizedUrl) && !isSmallImageCandidate({}, normalizedUrl)
    );
  });
}

function shouldRetryDetailWithCrawl4Ai(eventData, renderMode, fetchedVia) {
  return (
    renderMode === 'auto' &&
    fetchedVia !== 'crawl4ai' &&
    getInvalidRequiredEventFields(eventData).length > 0
  );
}

function getEventImageCandidates(eventData) {
  return [
    ...new Set(
      [
        eventData?.primary_image_url,
        ...(Array.isArray(eventData?.image_urls) ? eventData.image_urls : []),
      ].filter(Boolean),
    ),
  ];
}

function withNormalizedEventImages(eventData, imageUrls) {
  const normalizedImageUrls = imageUrls.slice(0, MAX_IMAGES_PER_EVENT);

  return {
    ...eventData,
    primary_image_url: normalizedImageUrls[0] ?? null,
    image_urls: normalizedImageUrls,
  };
}

function shouldMeasureSourceImages(source) {
  return source?.measure_image_dimensions === true;
}

function shouldProbeFinalImage(imageUrl, source) {
  if (shouldMeasureSourceImages(source)) return true;
  if (Object.values(parseImageDimensionsFromUrl(imageUrl)).some(Boolean)) return false;

  return /(?:thumb|thumbnail|small|preview|banner|strip|wixstatic|cloudinary|imagekit|cdn-cgi\/image)/i.test(
    imageUrl,
  );
}

async function normalizeEventImagesForSource(
  eventData,
  source,
  {
    env = {},
    userAgent = 'kyo-no-kyoto-bot/0.1',
    diagnostics = null,
    fetchImageDimensionsFn = fetchImageDimensions,
  } = {},
) {
  const baseUrl = eventData?.source_url ?? source?.base_url;
  const imageUrls = getEventImageCandidates(eventData)
    .map((imageUrl) => normalizeUrl(imageUrl, baseUrl))
    .filter(Boolean)
    .filter((imageUrl) => !isUnsafeImageUrl(imageUrl))
    .filter((imageUrl) => !isSmallImageCandidate({}, imageUrl));
  const acceptedImageUrls = [];
  let probeCount = 0;

  for (const imageUrl of [...new Set(imageUrls)]) {
    if (acceptedImageUrls.length >= MAX_IMAGES_PER_EVENT) break;
    if (
      !shouldProbeFinalImage(imageUrl, source) ||
      probeCount >= MAX_IMAGE_DIMENSION_PROBES_PER_EVENT
    ) {
      acceptedImageUrls.push(imageUrl);
      continue;
    }

    try {
      probeCount += 1;
      if (diagnostics) diagnostics.image_dimension_probe_count += 1;
      const dimensions = await fetchImageDimensionsFn(imageUrl, userAgent, env, diagnostics);

      if (dimensions && isSmallImageCandidate(dimensions, imageUrl)) {
        if (diagnostics) diagnostics.image_dimension_probe_rejected_count += 1;
        continue;
      }

      acceptedImageUrls.push(imageUrl);
    } catch {
      if (diagnostics) diagnostics.image_dimension_probe_failed_count += 1;
      acceptedImageUrls.push(imageUrl);
    }
  }

  return withNormalizedEventImages(eventData, acceptedImageUrls);
}

async function crawlSource({
  env,
  sourceSlug,
  userAgent,
  sourceOverrides,
  genericDetailLimit,
  renderMode,
}) {
  let source = null;
  let crawlRun = null;
  const diagnostics = createCrawlDiagnostics(env);

  try {
    source = applySourceOverride(
      await getSourceBySlug(env, sourceSlug),
      sourceOverrides[sourceSlug],
    );
    const sourceLocale = getSourceLocale(source);
    const crawlSourceConfig = withSourceLocaleConfig(source, sourceLocale);
    const sourceRenderMode = getSourceRenderMode(crawlSourceConfig, renderMode);
    const detailUrlExtractor = detailUrlExtractors[source.slug];
    const hardDetailLimit = getEnvNumber(env, 'CRAWLER_MAX_DETAIL_PAGES_PER_SOURCE', 50);
    const fallbackDetailLimit =
      !detailUrlExtractor || source.slug === 'sibasi' ? genericDetailLimit : hardDetailLimit;
    const sourceDetailLimit = getSourceDetailLimit(
      crawlSourceConfig,
      fallbackDetailLimit,
      hardDetailLimit,
    );
    try {
      const recoveredRuns = await recoverStaleCrawlRuns(env, source.id);
      if (recoveredRuns > 0) {
        console.warn(
          `Recovered ${recoveredRuns} stale crawl run${recoveredRuns === 1 ? '' : 's'} for ${source.slug}.`,
        );
      }
    } catch (error) {
      console.warn(
        `Could not recover stale crawl runs for ${source.slug}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    crawlRun = await createCrawlRun(env, source.id);
    const crawlContext = {
      diagnostics,
      allowedDomains: crawlSourceConfig.allowed_domains ?? [],
      waitFor: crawlSourceConfig.crawl_hints?.wait_for ?? null,
      waitForImages: crawlSourceConfig.crawl_hints?.wait_for_images,
      scanFullPage: crawlSourceConfig.crawl_hints?.scan_full_page,
    };
    const listingUrls = [...new Set(crawlSourceConfig.start_urls?.filter(Boolean) ?? [])];
    if (!listingUrls.length) {
      throw new Error(`Source "${source.slug}" does not have a start URL`);
    }

    let pagesFetched = 0;
    const listingPages = [];

    for (const listingUrl of listingUrls) {
      const listingPage = await fetchHtml(listingUrl, userAgent, env, {
        renderMode: sourceRenderMode,
        context: crawlContext,
      });
      pagesFetched += 1;
      recordFetchedPage(diagnostics, listingPage);
      await upsertRawPage(env, source.id, crawlRun.id, 'listing', listingPage);
      listingPages.push(listingPage);
    }

    const discoveryLimit = sourceDetailLimit + 1;
    let detailUrls =
      source.slug === 'sibasi'
        ? extractSibasiDetailUrls(listingPages, discoveryLimit)
        : detailUrlExtractor
          ? extractSourceSpecificDetailUrls(detailUrlExtractor, listingPages, crawlSourceConfig)
          : [
              ...new Set(
                listingPages.flatMap((listingPage) =>
                  extractGenericDetailUrls(
                    listingPage.html,
                    listingPage.url,
                    crawlSourceConfig,
                    discoveryLimit,
                  ),
                ),
              ),
            ];

    detailUrls = [...new Set(detailUrls)].filter(
      (detailUrl) =>
        sourceAllowsUrl(crawlSourceConfig, detailUrl) &&
        !sourceSkipsUrl(crawlSourceConfig, detailUrl),
    );
    const detailDiscoveryComplete = detailUrls.length <= sourceDetailLimit;

    if (!detailDiscoveryComplete) {
      diagnostics.detail_limit_hit_count += 1;
      detailUrls = detailUrls.slice(0, sourceDetailLimit);
    }

    if (!detailUrls.length) {
      const sourceOutcome = classifySourceOutcome({
        detailUrls,
        diagnostics,
        sourceSlug: source.slug,
      });
      const runStatus = crawlRunStatusForOutcome(sourceOutcome);
      const archivedEvents = shouldArchiveStaleEvents({
        sourceOutcome,
        diagnostics,
        discoveryComplete: detailDiscoveryComplete,
      })
        ? await archiveStaleEvents(env, source.id, new Set())
        : 0;
      const qaReport = buildCrawlQaReport({
        source,
        sourceOutcome,
        detailUrls,
        diagnostics,
      });
      await updateCrawlRun(env, crawlRun.id, {
        status: runStatus,
        finished_at: new Date().toISOString(),
        pages_queued: listingPages.length,
        pages_fetched: pagesFetched,
        pages_parsed: 0,
        events_created: 0,
        events_updated: archivedEvents,
        logs: [
          {
            level: 'warn',
            message: `No detail URLs were extracted for source "${source.slug}".`,
          },
          {
            level: 'info',
            message: `Source outcome: ${sourceOutcome}`,
          },
          {
            level: 'info',
            message: 'Crawl diagnostics',
            diagnostics,
          },
          {
            level: 'info',
            message: 'Crawl QA report',
            qa: qaReport,
          },
        ],
      });

      return {
        crawlRunId: crawlRun.id,
        source: source.slug,
        status: runStatus,
        sourceOutcome,
        usedGenericExtractor: !detailUrlExtractor,
        renderMode: sourceRenderMode,
        diagnostics,
        qa: qaReport,
        detailUrls,
        events: [],
        archivedEvents,
      };
    }

    let sourceContext = {};
    const loadSourceContext = sourceContextLoaders[source.slug];
    if (loadSourceContext) {
      const loaded = await loadSourceContext({
        userAgent,
        env,
        crawlContext,
        diagnostics,
        source,
        crawlRun,
      });
      sourceContext = loaded?.sourceContext ?? {};
      pagesFetched += loaded?.pagesFetched ?? 0;
    }

    const eventExtractor = eventExtractors[source.slug] ?? extractGenericEvent;
    const today = toDateInTimeZone(new Date(), source.timezone ?? timeZoneForCity(source.city));
    const oneYearAgo = shiftDateOnlyByYears(today, -1);
    const previousYear = Number(today.slice(0, 4)) - 1;

    const savedEvents = [];
    const skippedEvents = [];
    const activeDedupeKeys = new Set();
    const detailCrawlContext = {
      ...crawlContext,
      targetElements: selectorsFor(crawlSourceConfig, 'description'),
    };
    const detailPageCache = new Map();

    for (const detailUrl of detailUrls) {
      const cacheKey = detailPageCacheKey(detailUrl);
      const cachedDetailPage = detailPageCache.get(cacheKey);
      let detailPage;

      if (cachedDetailPage) {
        diagnostics.detail_page_cache_hit_count += 1;
        detailPage = { ...cachedDetailPage, url: detailUrl };
      } else {
        detailPage = await fetchHtml(detailUrl, userAgent, env, {
          renderMode: sourceRenderMode,
          context: detailCrawlContext,
        });
        detailPageCache.set(cacheKey, detailPage);
        pagesFetched += 1;
        recordFetchedPage(diagnostics, detailPage);
      }
      const initialNormalizedEvent = normalizeEventSourceTruth(
        eventExtractor(detailPage.html, crawlSourceConfig, detailUrl, sourceContext),
        crawlSourceConfig,
      );
      let extractedEvent = assessEventTitle(
        eventExtractor === extractGenericEvent
          ? initialNormalizedEvent
          : withSourceSpecificDescriptionOrigin(initialNormalizedEvent),
        crawlSourceConfig,
        eventExtractor === extractGenericEvent ? 'generic_fallback' : 'source_specific_extractor',
      );
      extractedEvent = resolveEventDescription(extractedEvent, crawlSourceConfig, detailPage);
      extractedEvent = normalizeEventDatePrecision(extractedEvent);

      if (
        shouldRetryDetailWithCrawl4Ai(
          extractedEvent,
          sourceRenderMode,
          detailPage.metadata?.fetched_via,
        )
      ) {
        if (!hasValidEventTitle(extractedEvent)) diagnostics.title_render_retry_count += 1;
        const renderedDetailPage = await fetchHtmlWithCrawl4Ai(
          detailUrl,
          userAgent,
          env,
          detailCrawlContext,
        );
        if (renderedDetailPage) {
          pagesFetched += 1;
          recordFetchedPage(diagnostics, renderedDetailPage);
          const renderedNormalizedEvent = normalizeEventSourceTruth(
            eventExtractor(renderedDetailPage.html, crawlSourceConfig, detailUrl, sourceContext),
            crawlSourceConfig,
          );
          const renderedEvent = assessEventTitle(
            eventExtractor === extractGenericEvent
              ? renderedNormalizedEvent
              : withSourceSpecificDescriptionOrigin(renderedNormalizedEvent),
            crawlSourceConfig,
            eventExtractor === extractGenericEvent
              ? 'generic_fallback'
              : 'source_specific_extractor',
          );
          detailPage = renderedDetailPage;
          detailPageCache.set(cacheKey, renderedDetailPage);
          extractedEvent = normalizeEventDatePrecision(
            resolveEventDescription(renderedEvent, crawlSourceConfig, renderedDetailPage),
          );
        }
      }

      const detailRawPage = await upsertRawPage(env, source.id, crawlRun.id, 'detail', detailPage);

      const usedGenericExtractor = !eventExtractors[source.slug];
      recordDateExtraction(
        diagnostics,
        detailPage.html,
        crawlSourceConfig,
        extractedEvent,
        usedGenericExtractor,
      );
      recordTitleExtraction(diagnostics, extractedEvent);
      recordDescriptionExtraction(diagnostics, extractedEvent);

      if (!hasValidEventTitle(extractedEvent)) {
        pushSkippedEvent(skippedEvents, diagnostics, {
          detailUrl,
          title: extractedEvent.title,
          reason: `invalid event title: ${extractedEvent._title_warnings.join(', ')}`,
        });
        continue;
      }

      if (!hasVerifiedEventDate(extractedEvent)) {
        pushSkippedEvent(skippedEvents, diagnostics, {
          detailUrl,
          title: extractedEvent.title,
          reason: 'missing verifiable event date',
        });
        continue;
      }

      if (!hasValidEventDescription(extractedEvent)) {
        pushSkippedEvent(skippedEvents, diagnostics, {
          detailUrl,
          title: extractedEvent.title,
          reason: 'missing valid description',
        });
        continue;
      }

      if (source.slug === 'sibasi') {
        if (classifyEventTiming(extractedEvent, today) === 'past') {
          pushSkippedEvent(skippedEvents, diagnostics, {
            detailUrl,
            title: extractedEvent.title,
            reason: 'past event',
          });
          continue;
        }
      }

      const sourceSpecificSkipReason = getSourceSpecificSkipReason(source, extractedEvent);

      if (sourceSpecificSkipReason) {
        pushSkippedEvent(skippedEvents, diagnostics, {
          detailUrl,
          title: extractedEvent.title,
          reason: sourceSpecificSkipReason,
        });
        continue;
      }

      const latestEventDate = getLatestEventDateOnly(extractedEvent);
      const hasOpenEndedSchedule = hasVerifiedOpenEndedSchedule(extractedEvent);
      if (!hasOpenEndedSchedule && latestEventDate && oneYearAgo && latestEventDate < oneYearAgo) {
        pushSkippedEvent(skippedEvents, diagnostics, {
          detailUrl,
          title: extractedEvent.title,
          reason: `older than one year (${latestEventDate})`,
        });
        continue;
      }

      if (!latestEventDate && !hasOpenEndedSchedule) {
        const latestEventYearHint = getLatestEventYearHint(extractedEvent, detailUrl);

        if (latestEventYearHint && latestEventYearHint < previousYear) {
          pushSkippedEvent(skippedEvents, diagnostics, {
            detailUrl,
            title: extractedEvent.title,
            reason: `older than previous year (${latestEventYearHint})`,
          });
          continue;
        }
      }

      extractedEvent = await normalizeEventImagesForSource(extractedEvent, crawlSourceConfig, {
        env,
        userAgent,
        diagnostics,
      });

      if (!hasExtractedImage(extractedEvent)) {
        pushSkippedEvent(skippedEvents, diagnostics, {
          detailUrl,
          title: extractedEvent.title,
          reason: 'missing image',
        });
        continue;
      }

      const sourceTruthSkipReason = getSourceTruthSkipReason(extractedEvent);
      if (sourceTruthSkipReason) {
        pushSkippedEvent(skippedEvents, diagnostics, {
          detailUrl,
          title: extractedEvent.title,
          reason: sourceTruthSkipReason,
        });
        continue;
      }

      const nativeTranslations = {};
      for (const targetLocale of supportedTranslationLocales) {
        if (targetLocale === sourceLocale) continue;
        if (!sourceHasNativeLocale(source, targetLocale)) continue;

        const nativeTranslation = await fetchNativeLocaleEvent({
          env,
          source,
          sourceLocale,
          targetLocale,
          canonicalEvent: extractedEvent,
          detailPage,
          detailUrl,
          eventExtractor,
          sourceContext,
          userAgent,
          renderMode: sourceRenderMode,
          crawlContext,
          diagnostics,
        });

        if (!nativeTranslation) continue;

        pagesFetched += 1;
        await upsertRawPage(env, source.id, crawlRun.id, 'detail', nativeTranslation.page);
        nativeTranslations[targetLocale] = nativeTranslation.event;
      }

      const dedupeKey = buildEventDedupeKey(extractedEvent);
      activeDedupeKeys.add(dedupeKey);
      const savedEvent = await upsertEvent(
        env,
        source.id,
        detailRawPage.id,
        extractedEvent,
        dedupeKey,
      );
      await upsertEventScheduleSegments({
        env,
        eventId: savedEvent.id,
        event: extractedEvent,
        request: supabaseRequest,
      });
      const savedTranslations = await upsertEventTranslations(
        env,
        crawlSourceConfig,
        savedEvent,
        extractedEvent,
        nativeTranslations,
      );
      await publishEvent(env, savedEvent.id);

      savedEvents.push({
        detailUrl,
        eventId: savedEvent.id,
        title: savedEvent.title,
        titleOrigin: extractedEvent._title_origin,
        titleWarnings: extractedEvent._title_warnings,
        translations: savedTranslations,
      });
    }

    const usedGenericExtractor = !eventExtractors[source.slug];
    const sourceOutcome = classifySourceOutcome({
      detailUrls,
      savedEvents,
      skippedEvents,
      diagnostics,
      usedGenericExtractor,
      sourceSlug: source.slug,
    });
    const runStatus = crawlRunStatusForOutcome(sourceOutcome);
    const archivedEvents = shouldArchiveStaleEvents({
      sourceOutcome,
      diagnostics,
      skippedEvents,
      discoveryComplete: detailDiscoveryComplete,
    })
      ? await archiveStaleEvents(env, source.id, activeDedupeKeys)
      : 0;
    const qaReport = buildCrawlQaReport({
      source,
      sourceOutcome,
      detailUrls,
      savedEvents,
      skippedEvents,
      diagnostics,
    });

    await updateCrawlRun(env, crawlRun.id, {
      status: runStatus,
      finished_at: new Date().toISOString(),
      pages_queued: detailUrls.length + listingPages.length,
      pages_fetched: pagesFetched,
      pages_parsed: savedEvents.length,
      events_created: savedEvents.length,
      events_updated: archivedEvents,
      logs: [
        {
          level: 'info',
          message: `Crawl4AI render mode: ${sourceRenderMode}`,
        },
        {
          level: 'info',
          message: `Source outcome: ${sourceOutcome}`,
        },
        {
          level: 'info',
          message: 'Crawl diagnostics',
          diagnostics,
        },
        {
          level: 'info',
          message: 'Crawl QA report',
          qa: qaReport,
        },
        ...(usedGenericExtractor
          ? [
              {
                level: 'warn',
                message:
                  'Used generic fallback extraction; review output and add a source-specific extractor when needed.',
              },
            ]
          : []),
        ...savedEvents.map((savedEvent) => ({
          level: 'info',
          message: `Stored event ${savedEvent.eventId} from ${savedEvent.detailUrl}`,
        })),
        ...skippedEvents.map((skippedEvent) => ({
          level: 'info',
          message: `Skipped ${skippedEvent.reason ?? 'event'} from ${skippedEvent.detailUrl}${skippedEvent.title ? ` (${skippedEvent.title})` : ''}`,
        })),
        ...(archivedEvents > 0
          ? [
              {
                level: 'info',
                message: `Archived ${archivedEvents} stale event${archivedEvents === 1 ? '' : 's'} not seen in this crawl.`,
              },
            ]
          : []),
      ],
    });

    return {
      crawlRunId: crawlRun.id,
      source: source.slug,
      status: runStatus,
      sourceOutcome,
      usedGenericExtractor,
      renderMode: sourceRenderMode,
      diagnostics,
      qa: qaReport,
      detailUrls,
      events: savedEvents,
      archivedEvents,
    };
  } catch (error) {
    if (crawlRun?.id) {
      try {
        await updateCrawlRun(env, crawlRun.id, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_message: error instanceof Error ? error.message : String(error),
          logs: [
            {
              level: 'error',
              message: `Source outcome: source_failed`,
            },
            {
              level: 'info',
              message: 'Crawl diagnostics',
              diagnostics,
            },
          ],
        });
      } catch (updateError) {
        console.warn(
          `Could not mark failed crawl run ${crawlRun.id}: ${
            updateError instanceof Error ? updateError.message : String(updateError)
          }`,
        );
      }
    }

    return {
      crawlRunId: crawlRun?.id ?? null,
      source: source?.slug ?? sourceSlug,
      status: 'failed',
      sourceOutcome: 'source_failed',
      diagnostics,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const envContents = await readFile(envPath, 'utf8');
  const fileEnv = parseEnv(envContents);
  applyEnvToProcess(fileEnv);
  const env = { ...fileEnv, ...process.env };
  const city = normalizeCity(getArg('city', 'kyoto'));
  if (!city) {
    throw new Error(`Unsupported source city "${getArg('city')}"`);
  }
  const sourceSlug = getArg('source', 'kyoto-art-center');
  const userAgent = env.CRAWLER_USER_AGENT ?? 'kyo-no-kyoto-bot/0.1';
  const genericDetailLimit = getNumberArg('generic-limit', 8);
  const renderMode = getCrawl4AiRenderMode(env);
  const configuredSources = await loadSourcesConfig({ city });
  const sourceOverrides = Object.fromEntries(
    configuredSources.map((source) => [source.slug, source]),
  );

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in apps/crawler/.env');
  }

  await assertScheduleSegmentStorage(env);

  const sourceSlugs =
    sourceSlug === 'all'
      ? configuredSources
          .filter((source) => source.is_active !== false)
          .map((source) => source.slug)
      : [sourceSlug];

  const results = [];

  for (const slug of sourceSlugs) {
    const result = await crawlSource({
      env,
      sourceSlug: slug,
      userAgent,
      sourceOverrides,
      genericDetailLimit,
      renderMode,
    });
    results.push(result);
    console.log(JSON.stringify(result, null, 2));

    if (result.status === 'failed' && sourceSlug !== 'all') {
      throw new Error(result.error);
    }
    if (result.status !== 'success' && sourceSlug !== 'all') process.exitCode = 2;
  }

  if (sourceSlug === 'all') {
    const healthy = results.filter((result) => result.status === 'success');
    const degraded = results.filter((result) => result.status === 'partial_success');
    const failed = results.filter((result) => result.status === 'failed');
    const unhealthy = [...degraded, ...failed];
    console.log(
      JSON.stringify(
        {
          status: unhealthy.length ? 'partial_success' : 'success',
          city,
          sources_total: results.length,
          sources_succeeded: healthy.length,
          sources_degraded: degraded.length,
          sources_failed: failed.length,
          unhealthy_sources: unhealthy.map((result) => ({
            source: result.source,
            outcome: result.sourceOutcome,
            error: result.error,
          })),
          failed_sources: failed.map((result) => ({
            source: result.source,
            error: result.error,
          })),
        },
        null,
        2,
      ),
    );
    if (unhealthy.length) process.exitCode = 2;
  }
}

export {
  assessEventTitle,
  archiveStaleEvents,
  assertScheduleSegmentStorage,
  assertSafeRemoteUrl,
  buildRendererEnv,
  buildTranslationSourceContentHash,
  classifyFetchResult,
  classifySourceOutcome,
  crawlRunStatusForOutcome,
  assignEventCoordinates,
  createCrawlDiagnostics,
  detailPageCacheKey,
  detailUrlExtractors,
  eventExtractors,
  extractLocaleUrlsFromHtml,
  extractChushinDetailUrls,
  extractChushinEvent,
  extractGenericDetailUrls,
  extractGenericEvent,
  extractHongKongPalaceMuseumDetailUrls,
  extractJpsHongKongDetailUrls,
  extractTenChanceryCurrentDetailUrls,
  extractVillepinCurrentDetailUrls,
  extractMeta,
  extractSourceSpecificDetailUrls,
  fetchRemote,
  buildEventTranslationPayload,
  buildMachineTranslatedEvent,
  getRetryDelayMs,
  getInvalidRequiredEventFields,
  getSourceDetailLimit,
  getSourceSpecificSkipReason,
  getSourceTruthSkipReason,
  hasVerifiedOpenEndedSchedule,
  hasExtractedImage,
  hasUsableImageCandidate,
  hasValidEventDescription,
  hasValidEventTitle,
  hasVerifiedEventDate,
  isPublicIpAddress,
  isUrlAllowedByRobotsText,
  isUsableNativeLocaleUrl,
  nativeLocaleEventMatchesCanonical,
  normalizeEventImagesForSource,
  normalizeEventDatePrecision,
  normalizeHumanDateText,
  parseGenericDateRange,
  parseImageDimensionsFromBytes,
  parseKyoceraDateRange,
  publishEvent,
  decodeHtmlResponseBytes,
  extractBestDateCandidate,
  extractBestDateText,
  recordFetchedPage,
  recordSkippedEvent,
  reconcileUnavailableTargetTranslation,
  recoverStaleCrawlRuns,
  resolveRendererNavigationUrl,
  resolveEventDescription,
  shouldRetryDetailWithCrawl4Ai,
  runJsonCommand,
  sanitizePostgresJson,
  sanitizePostgresText,
  extractRakuMuseumEvent,
  extractSenOkuEvent,
  sourceContextLoaders,
  sourceSpecificSkipMatchers,
  sourceHasNativeLocale,
  shouldMachineTranslateMissingLocales,
  shouldArchiveStaleEvents,
  translateTextFields,
  upsertEvent,
  upsertEventTranslation,
  withSourceLocaleConfig,
  withSourceSpecificDescriptionOrigin,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
