import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applySourceOverride, loadSourceOverrides, loadSourcesConfig } from "../../../data/sources/source-config.mjs";
import { buildEventDedupeKey } from "../../../packages/shared/event-dedupe.mjs";
import { buildScheduleFields, classifyEventTiming } from "../../../packages/shared/event-schedule.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const envPath = resolve(appRoot, ".env");

function parseEnvFile(contents) {
  const env = {};

  for (const rawLine of contents.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    env[key] = value;
  }

  return env;
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

function decodeHtml(value) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#8211;", "–")
    .replaceAll("&#8217;", "'")
    .replaceAll("&#038;", "&")
    .replaceAll("&#8212;", "—")
    .replaceAll("&#8220;", "\"")
    .replaceAll("&#8221;", "\"")
    .replaceAll("&#8230;", "…")
    .replaceAll("&#039;", "'");
}

function stripTags(value) {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

function extractMeta(html, property) {
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)="${property}"[^>]+content="([^"]+)"`,
    "i"
  );
  return html.match(pattern)?.[1] ?? null;
}

function extractSectionValue(html, dtText) {
  const escaped = dtText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<dt>${escaped}</dt>\\s*<dd>([\\s\\S]*?)</dd>`,
    "i"
  );
  const match = html.match(pattern)?.[1];
  return match ? stripTags(match) : null;
}

function parseJapaneseDateRange(dateText) {
  const pattern =
    /(\d{4})年(\d{1,2})月(\d{1,2})日.*?[～〜\-－]\s*(\d{4})年(\d{1,2})月(\d{1,2})日/u;
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
  const startDate = `${sy}-${sm.padStart(2, "0")}-${sd.padStart(2, "0")}`;
  const endDate = `${ey}-${em.padStart(2, "0")}-${ed.padStart(2, "0")}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T00:00:00+09:00`,
    calendarEndsAt: `${endDate}T23:59:00+09:00`,
  };
}

function parseSlashDateRange(dateText) {
  const pattern =
    /(\d{4})\/(\d{1,2})\/(\d{1,2})\s*[-–—]\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/;
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
  const startDate = `${sy}-${sm.padStart(2, "0")}-${sd.padStart(2, "0")}`;
  const endDate = `${ey}-${em.padStart(2, "0")}-${ed.padStart(2, "0")}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:00:00+09:00`,
    calendarEndsAt: `${endDate}T18:00:00+09:00`,
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
  const ey = explicitEy ?? sy;
  const startDate = `${sy}-${sm}-${sd}`;
  const endDate = `${ey}-${em}-${ed}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:00:00+09:00`,
    calendarEndsAt: `${endDate}T18:00:00+09:00`,
  };
}

function parseDottedDateRange(dateText) {
  const pattern =
    /(\d{4})\.(\d{1,2})\.(\d{1,2})(?:.*?[～〜\-－]\s*(?:(\d{4})\.)?(\d{1,2})\.(\d{1,2}))?/u;
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
  const startDate = `${sy}-${sm.padStart(2, "0")}-${sd.padStart(2, "0")}`;
  const endDate = em && ed
    ? `${explicitEy ?? sy}-${em.padStart(2, "0")}-${ed.padStart(2, "0")}`
    : startDate;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:00:00+09:00`,
    calendarEndsAt: `${endDate}T18:00:00+09:00`,
  };
}

function parseEnglishMonthDateRange(dateText) {
  const months = {
    january: "01",
    jan: "01",
    february: "02",
    feb: "02",
    march: "03",
    mar: "03",
    april: "04",
    apr: "04",
    may: "05",
    june: "06",
    jun: "06",
    july: "07",
    jul: "07",
    august: "08",
    aug: "08",
    september: "09",
    sep: "09",
    sept: "09",
    october: "10",
    oct: "10",
    november: "11",
    nov: "11",
    december: "12",
    dec: "12",
  };

  const match = dateText.match(
    /([A-Za-z]+)\s+(\d{1,2})[–-]([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/
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

  const startDate = `${year}-${startMonth}-${String(startDay).padStart(2, "0")}`;
  const endDate = `${year}-${endMonth}-${String(endDay).padStart(2, "0")}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T09:00:00+09:00`,
    calendarEndsAt: `${endDate}T17:30:00+09:00`,
  };
}

function parseEnglishMonthDateRangeWithOptionalStartYear(dateText) {
  const months = {
    january: "01",
    jan: "01",
    february: "02",
    feb: "02",
    march: "03",
    mar: "03",
    april: "04",
    apr: "04",
    may: "05",
    june: "06",
    jun: "06",
    july: "07",
    jul: "07",
    august: "08",
    aug: "08",
    september: "09",
    sep: "09",
    sept: "09",
    october: "10",
    oct: "10",
    november: "11",
    nov: "11",
    december: "12",
    dec: "12",
  };

  const cleaned = dateText
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const match = cleaned.match(
    /([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/
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

  const startDate = `${startYear}-${startMonth}-${String(startDay).padStart(2, "0")}`;
  const endDate = `${endYear}-${endMonth}-${String(endDay).padStart(2, "0")}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T11:00:00+09:00`,
    calendarEndsAt: `${endDate}T19:00:00+09:00`,
  };
}

function parseEnglishMonthDateRangeWithWeekdays(dateText) {
  const cleaned = dateText
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return parseEnglishMonthDateRange(cleaned);
}

function parseEnglishDayMonthYearRange(dateText) {
  const months = {
    january: "01",
    february: "02",
    march: "03",
    april: "04",
    may: "05",
    june: "06",
    july: "07",
    august: "08",
    september: "09",
    october: "10",
    november: "11",
    december: "12",
  };

  const cleaned = dateText
    .replace(/\([^)]*\)/g, "")
    .replace(/&#8211;|–|—/g, "-")
    .replace(/\s+/g, " ")
    .trim();

  const match = cleaned.match(
    /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*-\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/
  );

  if (!match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, startDay, startMonthName, startYear, endDay, endMonthName, endYear] = match;
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

  const startDate = `${startYear}-${startMonth}-${String(startDay).padStart(2, "0")}`;
  const endDate = `${endYear}-${endMonth}-${String(endDay).padStart(2, "0")}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:30:00+09:00`,
    calendarEndsAt: `${endDate}T18:00:00+09:00`,
  };
}

function toJapanDate(value) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
  }).format(value);
}

function extractYearFromUrl(url) {
  const match = url.match(/\/(20\d{2})\//);
  return match ? match[1] : null;
}

function toDateOnly(year, month, day) {
  return `${String(year)}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseSibasiDateRange(text, detailUrl) {
  const inferredYear = extractYearFromUrl(detailUrl);

  const explicitRange = text.match(
    /(?:日時|日程|会期)[：:\s]*((\d{4})年(\d{1,2})月(\d{1,2})日[^。\n]{0,40}?[〜～\-－]\s*(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日)/u
  );
  if (explicitRange) {
    const [, matchedText, startYear, startMonth, startDay, endYear, endMonth, endDay] = explicitRange;
    return {
      dateText: matchedText.trim(),
      startDate: toDateOnly(startYear, startMonth, startDay),
      endDate: toDateOnly(endYear ?? startYear, endMonth, endDay),
    };
  }

  const shortRange = text.match(
    /(?:日時|日程|会期|を)\s*[：:\s]*?(\d{1,2})\/(\d{1,2})\s*[〜～\-－]\s*(?:(\d{1,2})\/)?(\d{1,2})/u
  );
  if (shortRange && inferredYear) {
    const [, startMonth, startDay, maybeEndMonth, endDay] = shortRange;
    const endMonth = maybeEndMonth ?? startMonth;
    return {
      dateText: shortRange[0].replace(/^(?:日時|日程|会期|を)\s*[：:\s]*/u, "").trim(),
      startDate: toDateOnly(inferredYear, startMonth, startDay),
      endDate: toDateOnly(inferredYear, endMonth, endDay),
    };
  }

  const explicitSingle = text.match(
    /(?:日時|日程|会期)[：:\s]*((\d{4})年(\d{1,2})月(\d{1,2})日)/u
  );
  if (explicitSingle) {
    const [, matchedText, year, month, day] = explicitSingle;
    return {
      dateText: matchedText.trim(),
      startDate: toDateOnly(year, month, day),
      endDate: toDateOnly(year, month, day),
    };
  }

  const shortSingle = text.match(
    /(?:日時|日程|会期)[：:\s]*((\d{1,2})月(\d{1,2})日)/u
  );
  if (shortSingle && inferredYear) {
    const [, matchedText, month, day] = shortSingle;
    return {
      dateText: matchedText.trim(),
      startDate: toDateOnly(inferredYear, month, day),
      endDate: toDateOnly(inferredYear, month, day),
    };
  }

  return {
    dateText: "See source page",
    startDate: null,
    endDate: null,
  };
}

function parseGenericDateRange(dateText) {
  return (
    parseJapaneseDateRange(dateText).startDate ? parseJapaneseDateRange(dateText) :
    parseSlashDateRange(dateText).startDate ? parseSlashDateRange(dateText) :
    parseDottedDateRange(dateText).startDate ? parseDottedDateRange(dateText) :
    {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    }
  );
}

function normalizeUrl(value, baseUrl) {
  try {
    const sanitizedValue = value
      .replaceAll("\u0000", "")
      .replaceAll("＆", "&");
    const url = new URL(sanitizedValue, baseUrl);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
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

function looksLikeSocialOrUiImage(url) {
  return /data:image|spacer|sprite|logo|icon|favicon|avatar|loader|loading|blank|pixel|tracking|analytics/i.test(url) ||
    /(?:^|[\/_.-])(facebook|instagram|twitter|social|sns|share|line|youtube|pinterest|linkedin)(?:[\/_.-]|$)/i.test(url) ||
    /(?:^|[\/_.-])x[_-]?banner(?:[\/_.-]|$)/i.test(url);
}

function scoreImageCandidate(candidate) {
  let score = 0;
  const url = candidate.url.toLowerCase();
  const width = candidate.width ?? 0;
  const height = candidate.height ?? 0;

  if (candidate.source === "og:image") score += 20;
  if (/wp-content\/uploads|\/uploads\/|\/media\/|\/images?\//i.test(url)) score += 15;
  if (/exhi|exhibition|event|program|museum|art|craft|gallery|film|schedule/i.test(url)) score += 8;
  if (width >= 256) score += 8;
  if (height >= 256) score += 8;
  if (width >= 512) score += 8;
  if (height >= 512) score += 8;
  if (width && height) score += Math.min(width * height, 1600000) / 100000;

  return score;
}

function finalizeImageUrls(candidates, baseUrl) {
  const accepted = [];
  const rejected = [];

  for (const candidate of candidates) {
    const url = candidate?.url ? normalizeUrl(candidate.url, baseUrl) : null;
    if (!url) continue;

    const width = parsePositiveInteger(candidate.width);
    const height = parsePositiveInteger(candidate.height);

    if (looksLikeSocialOrUiImage(url)) {
      rejected.push(url);
      continue;
    }

    if ((width && width < 64) || (height && height < 64)) {
      rejected.push(url);
      continue;
    }

    accepted.push({
      url,
      width,
      height,
      source: candidate.source ?? "img",
      score: scoreImageCandidate({ url, width, height, source: candidate.source ?? "img" }),
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
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))
    .map((candidate) => candidate.url)
    .slice(0, 8);

  return ranked.length ? ranked : [];
}

function sourceAllowsUrl(source, url) {
  const host = new URL(url).hostname;
  return (source.allowed_domains ?? []).some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function pathnameMatchesPattern(pathname, pattern) {
  const normalizedPathname = pathname.toLowerCase().replace(/\/+$/, "") || "/";
  const normalizedPattern = pattern.toLowerCase().replace(/\/+$/, "") || "/";
  return normalizedPathname.includes(normalizedPattern) && normalizedPathname !== normalizedPattern;
}
function scoreGenericDetailUrl(source, url) {
  const parsed = new URL(url);
  const pathname = parsed.pathname.toLowerCase();
  if (/\.(?:jpe?g|png|gif|webp|svg|pdf|zip|css|js)$/i.test(pathname)) return 0;
  if (
    /\/(?:archive|archives|category|event_category|access|about|contact|privacy|guide|faq|feed|form)(?:\/|$)/.test(pathname) ||
    /\/(?:customer_authentication|cart)(?:\/|$)/.test(pathname) ||
    /\/collections\/all(?:\/|$)/.test(pathname) ||
    /\/pages\/about(?:\/|$)/.test(pathname) ||
    /\/(?:search|list)\.cgi$/.test(pathname) ||
    /\/xmlrpc\.php$/.test(pathname) ||
    /\/wp-json\/?$/.test(pathname)
  ) {
    return 0;
  }

  const patterns = (source.event_page_patterns ?? []).filter((pattern) => pattern && pattern !== "/");
  const patternScore = patterns.some((pattern) => pathnameMatchesPattern(pathname, pattern)) ? 8 : 0;
  const keywordScore = /event|exhibition|exhibit|program|live|schedule|news|journal|show|artist|展|催|公演/i.test(pathname)
    ? 4
    : 0;
  const dateScore = /20\d{2}|202\d|\d{4}[./-]\d{1,2}/.test(pathname) ? 2 : 0;
  const depthScore = pathname.split("/").filter(Boolean).length > 1 ? 1 : 0;

  return patternScore + keywordScore + dateScore + depthScore;
}

function extractGenericDetailUrls(listingHtml, listingUrl, source, limit = 8) {
  const urls = [...listingHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)]
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean)
    .filter((url) => sourceAllowsUrl(source, url))
    .filter((url) => url !== listingUrl);

  const patterns = (source.event_page_patterns ?? []).filter((pattern) => pattern && pattern !== "/");
  const scoredUrls = [...new Set(urls)]
    .map((url) => ({
      url,
      score: scoreGenericDetailUrl(source, url),
      matchesPattern: patterns.some((pattern) => pathnameMatchesPattern(new URL(url).pathname, pattern)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.url.localeCompare(right.url))
    .slice(0, limit * 4);

  const preferredUrls = scoredUrls.filter((entry) => entry.matchesPattern);
  const finalUrls = (preferredUrls.length ? preferredUrls : scoredUrls)
    .slice(0, limit)
    .map((entry) => entry.url);

  return finalUrls.length ? finalUrls : [listingUrl];
}

function extractFirstDateText(text) {
  const patterns = [
    /\d{4}年\d{1,2}月\d{1,2}日[\s\S]{0,40}?[～〜\-－][\s\S]{0,40}?\d{4}年\d{1,2}月\d{1,2}日/u,
    /\d{4}[./-]\d{1,2}[./-]\d{1,2}[\s\S]{0,30}?[-–—～〜][\s\S]{0,30}?(?:\d{4}[./-])?\d{1,2}[./-]\d{1,2}/u,
    /\d{4}年\d{1,2}月\d{1,2}日/u,
    /\d{4}[./-]\d{1,2}[./-]\d{1,2}/u,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].replace(/\s+/g, " ").trim();
  }

  return "See source page";
}

function extractGenericImageUrls(detailHtml, detailUrl) {
  const ogImage = extractMeta(detailHtml, "og:image");
  const imageCandidates = [
    ...(ogImage ? [{ url: ogImage, source: "og:image" }] : []),
    ...[...detailHtml.matchAll(/<img\b[^>]*>/gi)].map((match) => {
      const attributes = parseTagAttributes(match[0]);
      return {
        url: attributes.src ?? attributes["data-src"] ?? attributes["data-original"] ?? attributes["data-lazy-src"] ?? null,
        width: attributes.width,
        height: attributes.height,
        source: "img",
      };
    }),
  ];

  return finalizeImageUrls(imageCandidates, detailUrl);
}

function extractClassBlock(html, className, tagName = "[a-z0-9]+") {
  const pattern = new RegExp(
    `<${tagName}[^>]*class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    "i"
  );

  return html.match(pattern)?.[1] ?? null;
}

function extractDefinitionValue(html, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<dt>${escaped}</dt>\\s*<dd>([\\s\\S]*?)</dd>`,
    "i"
  );

  return html.match(pattern)?.[1] ?? null;
}

function extractKacDetailUrls(listingHtml, listingUrl) {
  const matches = [
    ...listingHtml.matchAll(/https:\/\/www\.kac\.or\.jp\/(?:en\/)?events\/\d+\//g),
  ].map((match) => new URL(match[0], listingUrl).toString().replace("/en/events/", "/events/"));

  if (!matches.length) {
    throw new Error("Could not find Kyoto Art Center event detail URLs on the listing page");
  }

  return [...new Set(matches)];
}

function extractSibasiDetailUrls(listingPages, genericDetailLimit = 8) {
  const detailUrls = listingPages.flatMap(({ html, url }) => {
    const matches = [...html.matchAll(/<a\b[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)]
      .map((match) => ({
        url: normalizeUrl(match[2], url),
        text: stripTags(match[3]).replace(/\s+/g, " ").trim(),
      }))
      .filter((entry) => entry.url)
      .filter((entry) => /\/20\d{2}\/\d{2}\/\d{2}\//.test(new URL(entry.url).pathname))
      .filter((entry) => !/追加チケット|予約開始|会場限定|ご案内|ありがとうございました|item list|items/i.test(entry.text));

    return matches.map((entry) => entry.url);
  });

  return [...new Set(detailUrls)].slice(0, genericDetailLimit * 2);
}

function extractEssenceDetailUrls(_listingHtml, listingUrl) {
  return [listingUrl];
}

function extractHosooDetailUrls(listingHtml, listingUrl) {
  const matches = [...listingHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)]
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean)
    .filter((url) => /\/(?:en\/)?exhibitions\/[^/]+\/?$/.test(new URL(url).pathname));

  if (!matches.length) {
    throw new Error("Could not find HOSOO exhibition detail URLs on the listing page");
  }

  return [...new Set(matches)];
}

function extractZenbiDetailUrls(listingHtml, listingUrl) {
  const blocks = [...listingHtml.matchAll(
    /<article id="exhibition-\d+"[\s\S]*?<\/article>/gi
  )].map((match) => match[0]);

  const matches = blocks
    .map((block) => ({
      url: normalizeUrl(block.match(/<a href="([^"]+)"/i)?.[1] ?? "", listingUrl),
      term: stripTags(block.match(/<div class="exTerm[\s\S]*?>([\s\S]*?)<\/div>/i)?.[1] ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase(),
    }))
    .filter((entry) => entry.url)
    .filter((entry) => /\/exhibition\//.test(new URL(entry.url).pathname));

  const preferred = matches.filter((entry) => /current|upcoming|開催中|開催予定/.test(entry.term));
  const urls = [...new Set((preferred.length ? preferred : matches.slice(0, 2)).map((entry) => entry.url))];

  if (!urls.length) {
    throw new Error("Could not find ZENBI exhibition detail URLs on the listing page");
  }

  return urls;
}

function extractTakaIshiiDetailUrls(listingHtml, listingUrl) {
  const matches = [...listingHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1/gi)]
    .map((match) => normalizeUrl(match[2], listingUrl))
    .filter(Boolean)
    .filter((url) => /\/en\/archives\/\d+\/?$/.test(new URL(url).pathname));

  if (!matches.length) {
    throw new Error("Could not find Taka Ishii Gallery Kyoto detail URLs on the listing page");
  }

  return [...new Set(matches)];
}

function extractKyohakuDetailUrls(listingHtml, listingUrl) {
  const matches = [...listingHtml.matchAll(/<a\b[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      url: normalizeUrl(match[2], listingUrl),
      text: stripTags(match[3]).replace(/\s+/g, " ").trim(),
    }))
    .filter((entry) => entry.url)
    .filter((entry) => /(Current|Upcoming)/i.test(entry.text))
    .filter((entry) => /Exhibition/i.test(entry.text))
    .filter((entry) => sourceAllowsUrl({
      allowed_domains: ["www.kyohaku.go.jp", "kyohaku.go.jp"],
    }, entry.url))
    .filter((entry) => /\/exhibitions\//i.test(new URL(entry.url).pathname));

  const urls = [...new Set(matches.map((entry) => entry.url))];

  if (!urls.length) {
    throw new Error("Could not find Kyoto National Museum exhibition detail URLs on the listing page");
  }

  return urls.slice(0, 2);
}

function toDetailUrlList(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.filter(Boolean))];
}

function extractKacEvent(detailHtml, source, detailUrl) {
  const titleMatch = detailHtml.match(/<h1 class="sectionTitle">([\s\S]*?)<\/h1>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : null;

  if (!title) {
    throw new Error("Could not extract event title from Kyoto Art Center detail page");
  }

  const dateText = extractSectionValue(detailHtml, "開催日時") ?? "See source page";
  const venueName = extractSectionValue(detailHtml, "会場");
  const genre = extractSectionValue(detailHtml, "ジャンル");
  const category = extractSectionValue(detailHtml, "カテゴリー");
  const descriptionBlock =
    detailHtml.match(/<p><br>([\s\S]*?)<\/p>/i)?.[1] ??
    extractMeta(detailHtml, "og:description") ??
    "";

  const imageUrls = finalizeImageUrls([
    { url: extractMeta(detailHtml, "og:image"), source: "og:image" },
    ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"/gi)].map((match) => ({
      url: match[1],
      source: "img",
    })),
  ], detailUrl);
  const primaryImageUrl = imageUrls[0] ?? null;

  const categories = [...new Set([genre, category]
    .flatMap((value) => (value ? value.split(/[／/、,]/) : []))
    .map((value) => value.trim())
    .filter(Boolean))];

  const artistSeed = title.split("個展")[0] ?? "";
  const artistName = artistSeed.replace(/^[A-ZＡ-Ｚ0-9０-９#＃\s]+/u, "").trim() || null;

  const parsedDates = parseJapaneseDateRange(dateText);
  const addressText = venueName ?? source.address_text ?? source.name;
  const directionsQuery = source.directions_query ?? `${addressText} Kyoto`;

  return {
    title,
    artist_name: artistName,
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
    timezone: "Asia/Tokyo",
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
  const title = stripTags(detailHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? "")
    .replace(/\s*[–-]\s*sibasi$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) {
    throw new Error("Could not extract event title from Sibasi detail page");
  }

  const pageText = stripTags(detailHtml);
  const parsedDates = parseSibasiDateRange(pageText, detailUrl);
  const imageUrls = extractGenericImageUrls(detailHtml, detailUrl);

  const category = detailUrl.includes("/exhibition") ? "exhibition" : "live";

  return {
    title,
    artist_name: null,
    categories: [category, source.source_type].filter(Boolean),
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
    timezone: "Asia/Tokyo",
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

function extractEssenceEvent(detailHtml, source, detailUrl) {
  const featureRows = [...detailHtml.matchAll(
    /<img class="feature-row__image lazyload"[\s\S]*?src="([^"]+)"[\s\S]*?<h2>([\s\S]*?)<\/h2>[\s\S]*?<div class="rte-setting featured-row__subtext">([\s\S]*?)<\/div>/gi
  )]
    .map((match) => ({
      imageUrl: match[1],
      title: stripTags(match[2]).replace(/\s+/g, " ").trim(),
      bodyHtml: match[3],
      bodyText: stripTags(match[3]),
    }))
    .filter((row) => row.title && row.bodyText);

  const topRows = featureRows.slice(0, 2);

  if (!topRows.length) {
    throw new Error("Could not extract homepage exhibition rows from Essence Kyoto");
  }

  const englishRow = topRows.find((row) => /[A-Za-z]/.test(row.title) && /Dates:/i.test(row.bodyText)) ?? topRows[0];
  const bilingualTitle = topRows[0]?.title ?? englishRow.title;
  const englishTitle = englishRow.title;
  const dateTextMatch = englishRow.bodyText.match(/Dates:\s*([^\n]+)/i);
  const dateText = dateTextMatch?.[1]?.trim() ?? "See source page";
  const parsedDates = parseEnglishMonthDateRangeWithWeekdays(dateText);
  const openText = englishRow.bodyText.match(/Open:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const description = englishRow.bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^Dates:/i.test(line) && !/^Open:/i.test(line) && !/^No reservations/i.test(line))
    .slice(0, 3)
    .join("\n\n");

  const imageUrls = finalizeImageUrls(
    topRows.map((row) => ({
      url: row.imageUrl.startsWith("//") ? `https:${row.imageUrl}` : row.imageUrl,
      source: "img",
    })),
    detailUrl
  );

  return {
    title: englishTitle || bilingualTitle,
    artist_name: null,
    categories: ["exhibition", "gallery"],
    description: description || extractGenericDescription(detailHtml),
    institution_name: source.name,
    venue_name: source.name,
    address_text: source.address_text ?? source.name,
    directions_query: source.directions_query ?? `${source.name}, Kyoto`,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: openText,
    end_time_text: null,
    is_all_day: !openText,
    timezone: "Asia/Tokyo",
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

function extractHosooEvent(detailHtml, source, detailUrl) {
  const title = stripTags(
    detailHtml.match(/<div class="c-title">[\s\S]*?<h3 class="title">([\s\S]*?)<\/h3>/i)?.[1] ??
      extractMeta(detailHtml, "og:title") ??
      ""
  )
    .replace(/\s*[|｜-]\s*HOSOO GALLERY$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) {
    throw new Error("Could not extract event title from HOSOO detail page");
  }

  const subtitle = stripTags(detailHtml.match(/<p class="subtitle">([\s\S]*?)<\/p>/i)?.[1] ?? "");
  const dateText = stripTags(
    detailHtml.match(/<dt class="term">Dates<\/dt><dd class="desc">([\s\S]*?)<\/dd>/i)?.[1] ?? ""
  ) || "See source page";
  const hoursText = stripTags(
    detailHtml.match(/<dt class="term">Hours<\/dt><dd class="desc">([\s\S]*?)<\/dd>/i)?.[1] ?? ""
  ) || null;
  const venueName = stripTags(
    detailHtml.match(/<dt class="term">Venue<\/dt><dd class="desc">([\s\S]*?)<\/dd>/i)?.[1] ?? ""
  ) || source.name;

  const description = [...detailHtml.matchAll(/<p class="cmt">([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4)
    .join("\n\n");

  const imageUrls = finalizeImageUrls([
    { url: extractMeta(detailHtml, "og:image"), source: "og:image" },
    ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*\/img\/exhibitions\/[^"]+)"/gi)].map((match) => ({
      url: match[1],
      source: "img",
    })),
  ], detailUrl);

  const parsedDates = parseEnglishDayMonthYearRange(dateText);
  const categories = ["exhibition", "gallery"];
  if (subtitle) categories.push(subtitle.toLowerCase());

  return {
    title,
    artist_name: null,
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
    timezone: "Asia/Tokyo",
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

function extractZenbiEvent(detailHtml, source, detailUrl) {
  const titleJa = stripTags(detailHtml.match(/<span class="exTitle">([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const titleEn = stripTags(detailHtml.match(/<span class="exTitle_en">([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const subtitleEn = stripTags(detailHtml.match(/<span class="exSubtitle_en">([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const exhibitionType = stripTags(detailHtml.match(/<span class="exCat_en">([\s\S]*?)<\/span>/i)?.[1] ?? "");
  const title = [titleEn, subtitleEn].filter(Boolean).join(": ") || titleJa;

  if (!title) {
    throw new Error("Could not extract event title from ZENBI detail page");
  }

  const dateText = stripTags(detailHtml.match(/<span class="exPeriod">([\s\S]*?)<\/span>/i)?.[1] ?? "") || "See source page";
  const description = stripTags(
    detailHtml.match(/<div class="exIntro(?:_en)?[^"]*">([\s\S]*?)<\/div>/i)?.[1] ??
      detailHtml.match(/<div class="exIntro[^"]*">([\s\S]*?)<\/div>/i)?.[1] ??
      ""
  );
  const hoursText = stripTags(detailHtml.match(/<p class="exOpen en">([\s\S]*?)<\/p>/i)?.[1] ?? "") || null;
  const imageUrls = finalizeImageUrls([
    ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"/gi)].map((match) => ({
      url: match[1],
      source: "img",
    })),
  ], detailUrl);
  const parsedDates = parseDottedDateRange(dateText);

  return {
    title,
    artist_name: null,
    categories: [...new Set(["exhibition", "museum", exhibitionType.toLowerCase()].filter(Boolean))],
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
    timezone: "Asia/Tokyo",
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
    detailHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i)?.[1] ??
      extractMeta(detailHtml, "og:title") ??
      ""
  )
    .replace(/\s*[|｜/].*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!title) {
    throw new Error("Could not extract event title from Taka Ishii Gallery detail page");
  }

  const pageText = stripTags(detailHtml);
  const dateText = pageText.match(/Dates:\s*([^\n]+)/i)?.[1]?.trim() ?? "See source page";
  const locationText = pageText.match(/Location:\s*([^\n]+)/i)?.[1]?.trim() ?? source.name;
  const appointmentText = pageText.match(/Appointment required\.[^\n]*/i)?.[0] ?? null;
  const description = extractGenericDescription(detailHtml);
  const imageUrls = finalizeImageUrls([
    ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"/gi)].map((match) => ({
      url: match[1],
      source: "img",
    })),
  ], detailUrl);
  const parsedDates = parseEnglishMonthDateRangeWithOptionalStartYear(dateText);

  return {
    title,
    artist_name: null,
    categories: ["exhibition", "gallery"],
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
    timezone: "Asia/Tokyo",
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
    detailHtml.match(/<dt>Exhibition Title<\/dt>\s*<dd>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? ""
  );

  if (!title) {
    throw new Error("Could not extract event title from Kyoto National Museum detail page");
  }

  const dateText = stripTags(
    detailHtml.match(/<dt>Period<\/dt>\s*<dd>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? ""
  )
    .split("\n")[0]
    .trim() || "See source page";

  const descriptionSection = detailHtml.match(
    /<h2 class="titleBg gold large" id="Contents02">Description of Exhibition<\/h2>([\s\S]*?)(?:<div class="imgPosition">|<h3|<div class="wallBelt|<footer)/i
  )?.[1] ?? "";

  const description = [...descriptionSection.matchAll(/<p>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]))
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n\n");

  const venueName = stripTags(
    detailHtml.match(/<dt>Venue<\/dt>\s*<dd>\s*<p>([\s\S]*?)<\/p>/i)?.[1] ?? ""
  ) || source.name;

  const imageUrls = finalizeImageUrls([
    {
      url: detailHtml.match(/<h1[^>]*>\s*<img[^>]+src="([^"]+)"/i)?.[1],
      source: "img",
    },
    ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*\/exhibitions\/[^"]+)"/gi)].map((match) => ({
      url: match[1],
      source: "img",
    })),
  ], detailUrl);

  const parsedDates = parseEnglishMonthDateRange(dateText);

  return {
    title,
    artist_name: null,
    categories: ["exhibition", "museum", "special-exhibition"],
    description: description || extractGenericDescription(detailHtml),
    institution_name: source.name,
    venue_name: venueName,
    address_text: source.address_text ?? source.name,
    directions_query: source.directions_query ?? `${source.name}, Kyoto`,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: "9:00-17:30",
    end_time_text: null,
    is_all_day: false,
    timezone: "Asia/Tokyo",
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
      /https:\/\/kyotocity-kyocera\.museum\/en\/exhibition\/\d{8}-\d{8}/g
    ),
  ].map((match) => new URL(match[0], listingUrl).toString());

  if (!matches.length) {
    throw new Error(
      "Could not find Kyoto City KYOCERA Museum of Art detail URLs on the listing page"
    );
  }

  return [...new Set(matches)];
}

function extractKyoceraFooterAddress(detailHtml) {
  const footerInfo = detailHtml.match(/<p class="footer_info">([\s\S]*?)<\/p>/i)?.[1];
  if (!footerInfo) return null;

  const lines = stripTags(footerInfo)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.find((line) => /\bKyoto\b/.test(line) && /\d{3}-\d{4}/.test(line)) ?? null;
}

function extractKyoceraEvent(detailHtml, source, detailUrl) {
  const titleBlock = extractClassBlock(detailHtml, "exhibition_title", "h1");
  const titleLines = titleBlock
    ? stripTags(titleBlock)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  const title = titleLines[0] ?? null;

  if (!title) {
    throw new Error("Could not extract event title from Kyoto City KYOCERA Museum of Art page");
  }

  const subtitleBlocks = [
    ...detailHtml.matchAll(/<p class="exhibition_subTitle">([\s\S]*?)<\/p>/gi),
  ].map((match) => stripTags(match[1])).filter(Boolean);

  const dateText =
    stripTags(extractClassBlock(detailHtml, "exhibition_date", "p") ?? "") || "See source page";
  const venueName =
    stripTags(extractClassBlock(detailHtml, "exhibition_venue", "p") ?? "")
      .replace(/^Venue\s*\[/i, "")
      .replace(/\]$/i, "")
      .trim() || null;
  const heading = stripTags(extractClassBlock(detailHtml, "cont_heading", "h3") ?? "");
  const descriptionHtml =
    detailHtml.match(
      /<div class="tab_cont_inner cont_col2 post_catch">[\s\S]*?<div class="cont_desc">([\s\S]*?)<\/div>/i
    )?.[1] ??
    extractDefinitionValue(detailHtml, "Period") ??
    extractMeta(detailHtml, "og:description") ??
    "";

  const timeText = stripTags(extractDefinitionValue(detailHtml, "Time") ?? "") || null;
  const artistSection = detailHtml.match(
    /<div class="tab_cont_inner post_artist">([\s\S]*?)<\/div>\s*<\/div>/i
  )?.[1];
  const artistNames = artistSection
    ? [...artistSection.matchAll(/<h4 class="frame_heading">([\s\S]*?)<\/h4>/gi)]
        .map((match) => stripTags(match[1]))
        .filter(Boolean)
    : titleLines.slice(1).flatMap((line) =>
        line
          .split(/\s*,\s*/)
          .map((value) => value.trim())
          .filter(Boolean)
      );

  const imageUrls = finalizeImageUrls([
    { url: extractMeta(detailHtml, "og:image"), source: "og:image" },
    ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"/gi)].map((match) => ({
      url: match[1],
      source: "img",
    })),
  ], detailUrl);
  const primaryImageUrl = imageUrls[0] ?? null;

  const normalizedCategories = [
    "exhibition",
    "museum",
    ...subtitleBlocks.map((value) => value.toLowerCase()),
  ];
  const categories = [...new Set(normalizedCategories.filter(Boolean))];
  const parsedDates = parseSlashDateRange(dateText);
  const addressText = extractKyoceraFooterAddress(detailHtml) ?? source.address_text ?? source.name;
  const directionsQuery = source.directions_query ?? (venueName
    ? `${venueName}, ${source.name}, Kyoto`
    : `${source.name}, Kyoto`);

  return {
    title,
    artist_name: artistNames.length ? artistNames.join(", ") : null,
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
    timezone: "Asia/Tokyo",
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

function extractMomakDetailUrls(listingHtml, listingUrl) {
  const matches = [
    ...listingHtml.matchAll(/https:\/\/www\.momak\.go\.jp\/English\/\?p=(\d+)/g),
  ]
    .map((match) => {
      const id = Number(match[1]);
      return id > 0 ? new URL(match[0], listingUrl).toString() : null;
    })
    .filter(Boolean);

  if (!matches.length) {
    throw new Error("Could not find MoMAK detail URLs on the listing page");
  }

  return [...new Set(matches)];
}

function extractMomakAddress(accessHtml) {
  const match = accessHtml.match(
    /<h3 class="access">The National Museum of Modern Art, Kyoto<\/h3>\s*<p>([\s\S]*?)<\/p>/i
  );

  if (!match) return null;
  return stripTags(match[1]);
}

function extractMomakGoogleMapsUrl(accessHtml) {
  return (
    accessHtml.match(/<a class="map-link" href="([^"]+)"/i)?.[1] ??
    "https://www.google.com/maps/place/National+Museum+of+Modern+Art,+Kyoto"
  );
}

function extractSenOkuDetailUrls(listingHtml, listingUrl) {
  const matches = [
    ...listingHtml.matchAll(/https:\/\/(?:www\.)?sen-oku\.or\.jp\/program\/[A-Za-z0-9_./-]+/g),
  ]
    .map((match) => new URL(match[0], listingUrl).toString())
    .filter((url) => /\/program\/[^/]+\/?$/.test(url));

  if (!matches.length) {
    throw new Error("Could not find Sen-Oku Hakukokan Museum detail URLs on the listing page");
  }

  return [...new Set(matches)];
}

function extractSenOkuAddress(accessHtml) {
  const postalCode = stripTags(accessHtml.match(/〒\s*&nbsp;\s*(\d{3}-\d{4})/i)?.[1] ?? "");
  const streetAddress = stripTags(
    accessHtml.match(/<div class="address">\s*〒[\s\S]*?<br>\s*([\s\S]*?)\s*<\/div>/i)?.[1] ?? ""
  );

  if (!postalCode && !streetAddress) return null;
  return [postalCode, streetAddress].filter(Boolean).join(" ");
}

function extractMomakEvent(detailHtml, source, detailUrl, context = {}) {
  const scTitle = detailHtml.match(/<section id="scTitle"[\s\S]*?<\/section>/i)?.[0] ?? "";
  const scTitleParagraphs = [...scTitle.matchAll(/<p>([\s\S]*?)<\/p>/gi)].map((match) => stripTags(match[1]));
  const title = scTitleParagraphs[1] ?? "";

  if (!title) {
    throw new Error("Could not extract event title from MoMAK detail page");
  }

  const dateText = scTitleParagraphs.find((paragraph) => /\d{4}\.\d{2}\.\d{2}/.test(paragraph)) ?? "See source page";

  const description = stripTags(
    detailHtml.match(/<div class="description">[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] ?? ""
  );

  const uniqueImageUrls = finalizeImageUrls([
    {
      url: detailHtml.match(/<section id="scMainImg"[\s\S]*?<img src="([^"]+)"/i)?.[1],
      source: "img",
    },
    ...[...detailHtml.matchAll(/<img src="([^"]*wp-content\/uploads[^"]+)"/gi)].map((match) => ({
      url: match[1],
      source: "img",
    })),
  ], detailUrl);

  const parsedDates = parseMomakDateRange(dateText);
  const addressText =
    (context.accessHtml ? extractMomakAddress(context.accessHtml) : null) ??
    source.address_text ??
    source.name;
  const directionsQuery = source.directions_query ?? extractMomakGoogleMapsUrl(context.accessHtml ?? "");

  return {
    title,
    artist_name: null,
    categories: ["exhibition", "museum", "modern-art"],
    description,
    institution_name: source.name,
    venue_name: source.name,
    address_text: addressText,
    directions_query: directionsQuery,
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: "10:00-18:00",
    end_time_text: null,
    is_all_day: false,
    timezone: "Asia/Tokyo",
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
  const title = stripTags(
    detailHtml.match(/<div class="catchArea wrap">[\s\S]*?<div class="catch">([\s\S]*?)<\/div>\s*<div class="dataSetList">/i)?.[1] ?? ""
  );

  if (!title) {
    throw new Error("Could not extract event title from Sen-Oku Hakukokan Museum page");
  }

  const dateParts = [
    ...detailHtml.matchAll(/<span class="num">(\d{4}\.\d{1,2}\.\d{1,2})<\/span>/gi),
  ].map((match) => match[1]);
  const dateText = dateParts.length > 1 ? `${dateParts[0]} - ${dateParts[1]}` : dateParts[0] ?? "See source page";
  const venueName =
    stripTags(detailHtml.match(/<div class="spot">([\s\S]*?)<\/div>/i)?.[1] ?? "") || source.name;
  const description = stripTags(
    detailHtml.match(/<div class="leadArea">\s*<p class="copy">\s*([\s\S]*?)<\/p>/i)?.[1] ??
      extractMeta(detailHtml, "og:description") ??
      ""
  );

  const uniqueImageUrls = finalizeImageUrls([
    { url: extractMeta(detailHtml, "og:image"), source: "og:image" },
    ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"/gi)].map((match) => ({
      url: match[1],
      source: "img",
    })),
  ], detailUrl);
  const parsedDates = parseDottedDateRange(dateText);
  const addressText =
    (context.accessHtml ? extractSenOkuAddress(context.accessHtml) : null) ??
    source.address_text ??
    source.name;

  return {
    title,
    artist_name: null,
    categories: ["exhibition", "museum"],
    description,
    institution_name: source.name,
    venue_name: venueName,
    address_text: addressText,
    directions_query: source.directions_query ?? "https://maps.app.goo.gl/xh91N3FpPHUAhiqZA",
    date_text: dateText,
    start_date: parsedDates.startDate,
    end_date: parsedDates.endDate,
    start_time_text: null,
    end_time_text: null,
    is_all_day: true,
    timezone: "Asia/Tokyo",
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

function extractGenericTitle(detailHtml, source) {
  const candidates = [
    extractMeta(detailHtml, "og:title"),
    stripTags(detailHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""),
    stripTags(detailHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
  ].filter(Boolean);

  const title = candidates[0]
    ?.replace(/\s*[|｜-]\s*.+$/, "")
    .replace(/\s+/g, " ")
    .trim();

  return title || source.name;
}

function extractGenericDescription(detailHtml) {
  const metaDescription =
    extractMeta(detailHtml, "og:description") ??
    extractMeta(detailHtml, "description");

  if (metaDescription) return stripTags(metaDescription).slice(0, 1200);

  const paragraphs = [...detailHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]))
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length > 40);

  return paragraphs.slice(0, 2).join("\n\n").slice(0, 1200);
}

function extractGenericEvent(detailHtml, source, detailUrl) {
  const title = extractGenericTitle(detailHtml, source);
  const pageText = stripTags(detailHtml);
  const dateText = extractFirstDateText(pageText);
  const parsedDates = parseGenericDateRange(dateText);
  const imageUrls = extractGenericImageUrls(detailHtml, detailUrl);
  const directionsQuery = source.directions_query ?? `${source.name}, Kyoto`;

  return {
    title,
    artist_name: null,
    categories: [source.source_type, "needs-review"].filter(Boolean),
    description: extractGenericDescription(detailHtml),
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
    timezone: "Asia/Tokyo",
    ...buildScheduleFields({
      startDate: parsedDates.startDate,
      endDate: parsedDates.endDate,
    }),
    calendar_starts_at: parsedDates.calendarStartsAt,
    calendar_ends_at: parsedDates.calendarEndsAt,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    source_url: detailUrl,
    extraction_confidence: 0.25,
  };
}

const detailUrlExtractors = {
  "essence-kyoto": extractEssenceDetailUrls,
  "hosoo-gallery": extractHosooDetailUrls,
  "kyoto-art-center": extractKacDetailUrls,
  "kyoto-national-museum": extractKyohakuDetailUrls,
  "kyoto-city-kyocera-museum-of-art": extractKyoceraDetailUrls,
  "taka-ishii-gallery": extractTakaIshiiDetailUrls,
  "zenbi": extractZenbiDetailUrls,
  "the-national-museum-of-modern-art": extractMomakDetailUrls,
  "sen-oku-hakukokan-museum": extractSenOkuDetailUrls,
};

const eventExtractors = {
  "essence-kyoto": extractEssenceEvent,
  "hosoo-gallery": extractHosooEvent,
  "kyoto-art-center": extractKacEvent,
  "kyoto-national-museum": extractKyohakuEvent,
  "kyoto-city-kyocera-museum-of-art": extractKyoceraEvent,
  "sibasi": extractSibasiEvent,
  "taka-ishii-gallery": extractTakaIshiiEvent,
  "zenbi": extractZenbiEvent,
  "the-national-museum-of-modern-art": extractMomakEvent,
  "sen-oku-hakukokan-museum": extractSenOkuEvent,
};

async function fetchHtml(url, userAgent) {
  const response = await fetch(url, {
    headers: {
      "user-agent": userAgent,
      accept: "text/html,application/xhtml+xml",
    },
  });

  const html = await response.text();

  return {
    url,
    response,
    html,
    title: html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
    contentType: response.headers.get("content-type"),
  };
}

async function supabaseRequest({ env, path, method = "GET", body = null }) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=representation,resolution=merge-duplicates",
    },
    body: body ? JSON.stringify(body) : undefined,
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
    path: "crawl_runs",
    method: "POST",
    body: [
      {
        source_id: sourceId,
        status: "running",
        trigger_type: "manual",
        started_at: new Date().toISOString(),
      },
    ],
  });

  return rows[0];
}

async function updateCrawlRun(env, crawlRunId, patch) {
  const rows = await supabaseRequest({
    env,
    path: `crawl_runs?id=eq.${crawlRunId}`,
    method: "PATCH",
    body: patch,
  });

  return rows?.[0] ?? null;
}

async function upsertRawPage(env, sourceId, crawlRunId, pageKind, fetched) {
  const contentHash = createHash("sha256").update(fetched.html).digest("hex");
  const rows = await supabaseRequest({
    env,
    path: "raw_pages?on_conflict=source_id,url,content_hash",
    method: "POST",
    body: [
      {
        source_id: sourceId,
        crawl_run_id: crawlRunId,
        url: fetched.url,
        canonical_url: fetched.response.url,
        page_kind: pageKind,
        http_status: fetched.response.status,
        content_type: fetched.contentType,
        title: fetched.title,
        raw_html: fetched.html,
        extracted_text: stripTags(fetched.html).slice(0, 5000),
        metadata: {
          final_url: fetched.response.url,
          fetched_via: "fetch",
        },
        content_hash: contentHash,
        fetched_at: new Date().toISOString(),
      },
    ],
  });

  return rows[0];
}

async function upsertEvent(env, sourceId, rawPageId, eventData, dedupeKey) {
  const eventPayload = {
    source_id: sourceId,
    raw_page_id: rawPageId,
    dedupe_key: dedupeKey,
    status: "published",
    extraction_confidence: 0.6,
    ...eventData,
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/events?on_conflict=dedupe_key`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        Prefer: "return=representation,resolution=merge-duplicates",
      },
      body: JSON.stringify([eventPayload]),
    });

    if (response.ok) {
      const rows = await response.json();
      return rows[0];
    }

    const errorText = await response.text();
    const missingColumn = errorText.match(/Could not find the '([^']+)' column/)?.[1];

    if (response.status === 400 && missingColumn && missingColumn in eventPayload) {
      delete eventPayload[missingColumn];
      continue;
    }

    throw new Error(`Supabase request failed (${response.status}) for events?on_conflict=dedupe_key: ${errorText}`);
  }

  throw new Error("Supabase request failed for events?on_conflict=dedupe_key after stripping unknown columns");
}

async function crawlSource({ env, sourceSlug, userAgent, sourceOverrides, genericDetailLimit }) {
  const source = applySourceOverride(
    await getSourceBySlug(env, sourceSlug),
    sourceOverrides[sourceSlug]
  );
  const crawlRun = await createCrawlRun(env, source.id);

  try {
    const listingUrls = [...new Set(source.start_urls?.filter(Boolean) ?? [])];
    if (!listingUrls.length) {
      throw new Error(`Source "${source.slug}" does not have a start URL`);
    }

    let pagesFetched = 0;
    const listingPages = [];

    for (const listingUrl of listingUrls) {
      const listingPage = await fetchHtml(listingUrl, userAgent);
      pagesFetched += 1;
      await upsertRawPage(env, source.id, crawlRun.id, "listing", listingPage);
      listingPages.push(listingPage);
    }

    const detailUrlExtractor = detailUrlExtractors[source.slug];
    const detailUrls = source.slug === "sibasi"
      ? extractSibasiDetailUrls(listingPages, genericDetailLimit)
      : detailUrlExtractor
        ? detailUrlExtractor(listingPages[0].html, listingPages[0].url)
        : [...new Set(listingPages.flatMap((listingPage) =>
            extractGenericDetailUrls(listingPage.html, listingPage.url, source, genericDetailLimit)
          ))];

    if (!detailUrls.length) {
      throw new Error(`No detail URLs were extracted for source "${source.slug}"`);
    }

    let sourceContext = {};
    if (source.slug === "the-national-museum-of-modern-art") {
      const accessPage = await fetchHtml("https://www.momak.go.jp/English/guide/access.html", userAgent);
      pagesFetched += 1;
      await upsertRawPage(env, source.id, crawlRun.id, "detail", accessPage);
      sourceContext = { accessHtml: accessPage.html };
    } else if (source.slug === "sen-oku-hakukokan-museum") {
      const accessPage = await fetchHtml("https://sen-oku.or.jp/kyoto/facility/access", userAgent);
      pagesFetched += 1;
      await upsertRawPage(env, source.id, crawlRun.id, "detail", accessPage);
      sourceContext = { accessHtml: accessPage.html };
    }

    const eventExtractor = eventExtractors[source.slug] ?? extractGenericEvent;
    const todayJapan = toJapanDate(new Date());

    const savedEvents = [];
    const skippedEvents = [];

    for (const detailUrl of detailUrls) {
      const detailPage = await fetchHtml(detailUrl, userAgent);
      pagesFetched += 1;
      const detailRawPage = await upsertRawPage(env, source.id, crawlRun.id, "detail", detailPage);
      const extractedEvent = eventExtractor(detailPage.html, source, detailUrl, sourceContext);

      if (source.slug === "sibasi") {
        const hasVerifiedDate =
          Boolean(extractedEvent.start_date) ||
          Boolean(extractedEvent.end_date) ||
          (Array.isArray(extractedEvent.occurrence_dates) && extractedEvent.occurrence_dates.length > 0);

        if (!hasVerifiedDate) {
          skippedEvents.push({
            detailUrl,
            title: extractedEvent.title,
            reason: "missing verifiable event date",
          });
          continue;
        }

        if (classifyEventTiming(extractedEvent, todayJapan) === "past") {
          skippedEvents.push({
            detailUrl,
            title: extractedEvent.title,
            reason: "past event",
          });
          continue;
        }
      }

      const dedupeKey = buildEventDedupeKey(extractedEvent);
      const savedEvent = await upsertEvent(
        env,
        source.id,
        detailRawPage.id,
        extractedEvent,
        dedupeKey
      );

      savedEvents.push({
        detailUrl,
        eventId: savedEvent.id,
        title: savedEvent.title,
      });
    }

    await updateCrawlRun(env, crawlRun.id, {
      status: "success",
      finished_at: new Date().toISOString(),
      pages_queued: detailUrls.length + listingPages.length,
      pages_fetched: pagesFetched,
      pages_parsed: savedEvents.length,
      events_created: savedEvents.length,
      events_updated: 0,
      logs: [
        ...(eventExtractors[source.slug] ? [] : [{
          level: "warn",
          message: "Used generic fallback extraction; review output and add a source-specific extractor when needed.",
        }]),
        ...savedEvents.map((savedEvent) => ({
          level: "info",
          message: `Stored event ${savedEvent.eventId} from ${savedEvent.detailUrl}`,
        })),
        ...skippedEvents.map((skippedEvent) => ({
          level: "info",
          message: `Skipped ${skippedEvent.reason ?? "event"} from ${skippedEvent.detailUrl}${skippedEvent.title ? ` (${skippedEvent.title})` : ""}`,
        })),
      ],
    });

    return {
      crawlRunId: crawlRun.id,
      source: source.slug,
      status: "success",
      usedGenericExtractor: !eventExtractors[source.slug],
      detailUrls,
      events: savedEvents,
    };
  } catch (error) {
    await updateCrawlRun(env, crawlRun.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : String(error),
    });

    return {
      crawlRunId: crawlRun.id,
      source: source.slug,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const envContents = await readFile(envPath, "utf8");
  const env = parseEnvFile(envContents);
  const sourceSlug = getArg("source", "kyoto-art-center");
  const userAgent = env.CRAWLER_USER_AGENT ?? "kyo-no-kyoto-bot/0.1";
  const genericDetailLimit = getNumberArg("generic-limit", 8);
  const sourceOverrides = await loadSourceOverrides();

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in apps/crawler/.env");
  }

  const sourceSlugs = sourceSlug === "all"
    ? (await loadSourcesConfig())
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
    });
    results.push(result);
    console.log(JSON.stringify(result, null, 2));

    if (result.status === "failed" && sourceSlug !== "all") {
      throw new Error(result.error);
    }
  }

  if (sourceSlug === "all") {
    const failed = results.filter((result) => result.status === "failed");
    console.log(
      JSON.stringify(
        {
          status: failed.length ? "partial_success" : "success",
          sources_total: results.length,
          sources_succeeded: results.length - failed.length,
          sources_failed: failed.length,
          failed_sources: failed.map((result) => ({
            source: result.source,
            error: result.error,
          })),
        },
        null,
        2
      )
    );
  }
}

await main();
