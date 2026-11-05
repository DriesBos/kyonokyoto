import { createHash } from 'node:crypto';
import { normalizeDateOnly } from './event-schedule.mjs';

const TRACKING_PARAMS = /^(utm_.+|gclid|fbclid|yclid|mc_cid|mc_eid)$/i;
const GENERIC_TITLE =
  /^(?:(?:spring|summer|autumn|fall|winter))?(?:special(?:opening|viewing|exhibition|admission)|seasonal(?:opening|viewing|exhibition))$|^(?:(?:春|夏|秋|冬)(?:季|期)?の?)?(?:特別公開|特別拝観|特別開帳|特別展)$/iu;
const KYOTO_WARDS = [
  '北区',
  '上京区',
  '左京区',
  '中京区',
  '東山区',
  '下京区',
  '南区',
  '右京区',
  '伏見区',
  '山科区',
  '西京区',
];

function text(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim() : '';
}

function normalize(value) {
  return text(value)
    .toLocaleLowerCase('ja-JP')
    .replace(/[\p{P}\p{S}\s]+/gu, '');
}

function cleanUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    url.protocol = url.protocol.toLowerCase();
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return value.trim().replace(/#.*$/, '').replace(/\/$/, '');
  }
}

function sourceKey(event) {
  const url = cleanUrl(event?.source_url);
  if (!url) return null;
  // External IDs often identify inline cards sharing one listing URL.
  let inline = '';
  try {
    const parsed = new URL(event.source_url);
    inline = parsed.hash.replace(/^#/, '').replace(/[^\p{Letter}\p{Number}_=-]/gu, '');
    if (/^(top|content|main|section)$/i.test(inline)) inline = '';
  } catch {
    /* use explicit IDs only for non-URL input */
  }
  const discriminator = text(event?.external_id ?? event?.inline_id ?? event?.entry_id ?? inline);
  const year = eventYear(event);
  const edition = season(event);
  const recurrence = year && edition ? `${year}-${edition}` : '';
  return `temple-source:${url}${discriminator ? `#${encodeURIComponent(discriminator)}` : ''}${recurrence ? `@${recurrence}` : ''}`;
}

function eventYear(event) {
  const candidates = [event?.start_date, event?.calendar_starts_at, event?.date_text];
  for (const candidate of candidates) {
    const date = normalizeDateOnly(candidate);
    if (date) {
      const year = Number(date.slice(0, 4));
      if (year >= 1900 && year <= 2200) return year;
    }
  }
  const titleYear = text(event?.title).match(/(?:19|20|21)\d{2}/)?.[0];
  return titleYear ? Number(titleYear) : null;
}

function season(event) {
  const title = text(event?.title);
  if (/(春|spring)/iu.test(title)) return 'spring';
  if (/(夏|summer)/iu.test(title)) return 'summer';
  if (/(秋|autumn|fall)/iu.test(title)) return 'autumn';
  if (/(冬|winter)/iu.test(title)) return 'winter';
  const date = normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at);
  if (!date) return null;
  const month = Number(date.slice(5, 7));
  return month >= 3 && month <= 5
    ? 'spring'
    : month >= 6 && month <= 8
      ? 'summer'
      : month >= 9 && month <= 11
        ? 'autumn'
        : 'winter';
}

function venueParts(event) {
  const venue = text(event?.venue_name ?? event?.institution_name);
  let address = text(event?.address_text ?? event?.address ?? event?.municipality ?? event?.city)
    .replace(/^〒?\s*\d{3}-?\d{4}\s*/u, '')
    .replace(/^京都府\s*/u, '')
    .trim();
  const city = text(event?.city ?? event?.municipality);
  const isKyotoCity = /^(?:kyoto|京都|京都市)$/iu.test(city);
  const ward = KYOTO_WARDS.find((name) => address.startsWith(name));
  if (ward && !address.startsWith('京都市') && (isKyotoCity || !['北区', '南区'].includes(ward))) {
    address = `京都市${address}`;
  }
  const municipality =
    address.match(/^(.+?市(?:[^市区町村郡]+区)?|.+?区|.+?郡[^町村]+[町村]|.+?[町村])/u)?.[0] ?? '';
  const isJapaneseVenue = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(venue);
  const isJapaneseAddress = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(address);
  if (!venue || !address || !municipality || !isJapaneseAddress) return null;
  return {
    venue: normalize(venue),
    address: normalize(address),
    municipality: normalize(municipality),
    isJapaneseVenue,
  };
}

function normalizedTitle(title, event) {
  let value = normalize(title);
  const prefixes = [event?.venue_name, event?.institution_name]
    .map(normalize)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (value.startsWith(prefix)) {
        value = value.slice(prefix.length);
        changed = true;
      }
    }
  }
  return value;
}

function isGenericTitle(title, event) {
  const candidate = normalizedTitle(title, event);
  return (
    GENERIC_TITLE.test(text(title)) ||
    GENERIC_TITLE.test(candidate) ||
    /^(?:(?:spring|summer|autumn|fall|winter))?(?:special(?:opening|viewing|exhibition|admission)|seasonal(?:opening|viewing|exhibition))$/iu.test(
      candidate,
    )
  );
}

function officialEventUrl(event) {
  const url = cleanUrl(event?.official_url);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.split('/').filter(Boolean);
    const slug = path.at(-1) ?? '';
    const yearDated = path.some((part) => /(?:19|20|21)\d{2}/.test(part));
    const identifier = /^(?:\d{4,}|[a-f0-9]{8,})$/i.test(slug);
    const eventRoute =
      /^(?:event|events|news|topics|press|information)$/i.test(path.at(-2) ?? '') &&
      slug.length >= 5;
    const queryId = [...parsed.searchParams.keys()].some((key) => /^(?:event_?id|id)$/i.test(key));
    return yearDated || identifier || eventRoute || queryId;
  } catch {
    return false;
  }
}

function eventKind(event) {
  const value = normalize(
    [event?.event_type, event?.programme_type, event?.title].filter(Boolean).join(' '),
  );
  // Preserve meaningful programme distinctions (night/day, art/object exhibitions).
  const distinctions = [
    ['night', /夜間|夜間拝観|夜間公開|night|evening/iu],
    ['day', /日中|昼間|daytime/iu],
    ['art', /作品|美術|展覧会|artwork|exhibition/iu],
    ['special-viewing', /特別公開|特別拝観|specialviewing|specialopening/iu],
  ];
  const matches = distinctions.filter(([, pattern]) => pattern.test(value)).map(([key]) => key);
  return matches.join('+') || normalize(event?.event_type ?? event?.programme_type) || 'event';
}

export function buildTempleEventIdentity(event) {
  const sourceEventKey = sourceKey(event);
  const venue = venueParts(event);
  const year = eventYear(event);
  const title = text(event?.title);
  const normalizedEventTitle = normalizedTitle(title, event);
  const candidateSeason = season(event);
  const reviewKey =
    venue && year && candidateSeason
      ? `temple-review:${venue.venue}|${venue.municipality}|${year}|${candidateSeason}`
      : null;

  const startDate = normalizeDateOnly(event?.start_date ?? event?.calendar_starts_at);
  const endDate = normalizeDateOnly(event?.end_date ?? event?.calendar_ends_at);
  const scheduleFingerprint = startDate && endDate ? `${startDate}..${endDate}` : null;

  if (
    !venue ||
    !venue.isJapaneseVenue ||
    !year ||
    !candidateSeason ||
    !normalizedEventTitle ||
    !scheduleFingerprint
  ) {
    return { sourceEventKey, matchKey: null, reviewKey };
  }

  const generic = isGenericTitle(title, event);
  if (generic && !officialEventUrl(event)) {
    return { sourceEventKey, matchKey: null, reviewKey };
  }

  const titleIdentity = generic
    ? `official:${createHash('sha256').update(cleanUrl(event.official_url)).digest('hex').slice(0, 20)}`
    : `title:${normalizedEventTitle}`;
  const edition = normalize(event?.edition ?? event?.programme_type ?? event?.event_type);
  const matchKey = `temple-match:${venue.venue}|${venue.address}|${year}|${candidateSeason}|${scheduleFingerprint}|${titleIdentity}|${eventKind(event)}|${edition}`;
  return { sourceEventKey, matchKey, reviewKey };
}
