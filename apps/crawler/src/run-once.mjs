import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { applySourceOverride, loadSourceOverrides, loadSourcesConfig } from "../../../data/sources/source-config.mjs";
import { buildEventDedupeKey } from "../../../packages/shared/event-dedupe.mjs";
import { buildScheduleFields, classifyEventTiming, normalizeDateOnly } from "../../../packages/shared/event-schedule.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const envPath = resolve(appRoot, ".env");
const crawl4AiFetchPath = resolve(__dirname, "crawl4ai-fetch.py");
let crawl4AiDisabled = false;
const domainFetchSchedule = new Map();

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

function getEnvNumber(env, name, fallback) {
  const parsed = Number(env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getCrawl4AiRenderMode(env) {
  const value = getArg("render", env.CRAWL4AI_RENDER_MODE ?? "auto").toLowerCase();
  return ["auto", "always", "never"].includes(value) ? value : "auto";
}

function envFlag(env, name, fallback = true) {
  const value = env[name];
  if (value === undefined) return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function decodeHtml(value) {
  return String(value)
    .replace(/&(nbsp|amp|quot|apos|lt|gt|ndash|mdash|lsquo|rsquo|ldquo|rdquo|hellip);?/gi, (match, entity) => {
      const entities = {
        nbsp: " ",
        amp: "&",
        quot: "\"",
        apos: "'",
        lt: "<",
        gt: ">",
        ndash: "–",
        mdash: "—",
        lsquo: "'",
        rsquo: "'",
        ldquo: "\"",
        rdquo: "\"",
        hellip: "…",
      };
      return entities[entity.toLowerCase()] ?? match;
    })
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
    .replaceAll("&#039;", "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const codePoint = Number.parseInt(hex, 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    })
    .replace(/&#(\d+);/g, (_, decimal) => {
      const codePoint = Number.parseInt(decimal, 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
    });
}

function normalizeCategoryList(values) {
  return [...new Set(
    values
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean)
  )];
}

function withSourceCategories(eventData, source) {
  return {
    ...eventData,
    categories: normalizeCategoryList([
      eventData.categories ?? [],
      source.source_categories ?? [],
    ]),
  };
}

function stripTags(value) {
  const decoded = decodeHtml(value);

  return decodeHtml(
    decoded
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

function parseJapaneseSingleDate(dateText) {
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
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

  return {
    startDate: date,
    endDate: date,
    calendarStartsAt: `${date}T00:00:00+09:00`,
    calendarEndsAt: `${date}T23:59:00+09:00`,
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
  const date = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;

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

  const cleaned = decodeHtml(dateText)
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const match = cleaned.match(
    /([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/
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

function parseEnglishMonthDayRangeWithYear(dateText, year) {
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
  const normalizedYear = String(year ?? "").match(/20\d{2}/)?.[0];
  const cleaned = decodeHtml(dateText)
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(
    /([A-Za-z]+)\s+(\d{1,2})\s*[–-]\s*([A-Za-z]+)\s+(\d{1,2})/
  );

  if (!normalizedYear || !match) {
    return {
      startDate: null,
      endDate: null,
      calendarStartsAt: null,
      calendarEndsAt: null,
    };
  }

  const [, startMonthName, startDay, endMonthName, endDay] = match;
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

  const startDate = `${normalizedYear}-${startMonth}-${String(startDay).padStart(2, "0")}`;
  const endDate = `${normalizedYear}-${endMonth}-${String(endDay).padStart(2, "0")}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T10:00:00+09:00`,
    calendarEndsAt: `${endDate}T18:00:00+09:00`,
  };
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

function parseEnglishSingleDate(dateText) {
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

  const cleaned = decodeHtml(dateText)
    .replace(/\([^)]*\)/g, "")
    .replace(/\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/gi, "")
    .replace(/\s+/g, " ")
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

    const date = `${year}-${month}-${String(day).padStart(2, "0")}`;
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

    const date = `${year}-${month}-${String(day).padStart(2, "0")}`;
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

function toJapanDate(value) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Tokyo",
  }).format(value);
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

function getLatestEventYearHint(event, detailUrl) {
  const haystacks = [
    typeof event?.date_text === "string" ? event.date_text : "",
    typeof detailUrl === "string" ? detailUrl : "",
  ];

  const years = haystacks.flatMap((value) =>
    [...decodeHtml(value).matchAll(/(?:^|[^\d])(20\d{2})(?!\d)/g)].map((match) => Number(match[1]))
  ).filter((value) => Number.isFinite(value));

  if (!years.length) return null;
  return Math.max(...years);
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
    parseEnglishMonthDateRangeWithOptionalStartYear(dateText).startDate ? parseEnglishMonthDateRangeWithOptionalStartYear(dateText) :
    parseEnglishMonthDateRangeWithWeekdays(dateText).startDate ? parseEnglishMonthDateRangeWithWeekdays(dateText) :
    parseEnglishMonthDateRange(dateText).startDate ? parseEnglishMonthDateRange(dateText) :
    parseEnglishDayMonthYearRange(dateText).startDate ? parseEnglishDayMonthYearRange(dateText) :
    parseJapaneseSingleDate(dateText).startDate ? parseJapaneseSingleDate(dateText) :
    parseSlashSingleDate(dateText).startDate ? parseSlashSingleDate(dateText) :
    parseEnglishSingleDate(dateText).startDate ? parseEnglishSingleDate(dateText) :
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

function escapeHtmlAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
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

    if ((width && width < 64) || (height && height < 100)) {
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

function getGenericDetailUrlRecencyHint(url) {
  const parsed = new URL(url);
  const haystack = `${parsed.pathname} ${parsed.search}`;
  const hints = [];

  for (const match of haystack.matchAll(/(20\d{2})[./_-](\d{1,2})(?:[./_-](\d{1,2}))?/g)) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3] ?? "1");

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      hints.push(year * 10000 + month * 100 + day);
    }
  }

  for (const match of haystack.matchAll(/(?:^|[\/=_-])(20\d{2})(?:[\/._-]|$)/g)) {
    hints.push(Number(match[1]) * 10000);
  }

  const postId = Number(parsed.searchParams.get("p") ?? "0");
  if (Number.isFinite(postId) && postId > 0) hints.push(postId);

  const pageId = Number(parsed.searchParams.get("page_id") ?? "0");
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
  if (
    parsed.searchParams.has("rest_route") ||
    parsed.searchParams.has("feed") ||
    parsed.searchParams.has("author")
  ) {
    return 0;
  }

  const patterns = (source.event_page_patterns ?? []).filter((pattern) => pattern && pattern !== "/");
  const patternScore = patterns.some((pattern) => pathnameMatchesPattern(pathname, pattern)) ? 8 : 0;
  const keywordScore = /event|exhibition|exhibit|program|live|schedule|news|journal|show|artist|展|催|公演/i.test(
    `${pathname} ${search}`
  )
    ? 4
    : 0;
  const dateScore = /20\d{2}|202\d|\d{4}[./-]\d{1,2}/.test(`${pathname} ${search}`) ? 2 : 0;
  const depthScore = pathname.split("/").filter(Boolean).length > 1 ? 1 : 0;
  const queryScore = parsed.searchParams.has("p") ? 6 : 0;

  return patternScore + keywordScore + dateScore + depthScore + queryScore;
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
      recencyHint: getGenericDetailUrlRecencyHint(url),
      matchesPattern: patterns.some((pattern) => pathnameMatchesPattern(new URL(url).pathname, pattern)),
    }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.recencyHint - left.recencyHint ||
        left.url.localeCompare(right.url)
    )
    .slice(0, limit * 4);

  const preferredUrls = scoredUrls.filter((entry) => entry.matchesPattern);
  const finalUrls = (preferredUrls.length ? preferredUrls : scoredUrls)
    .slice(0, limit)
    .map((entry) => entry.url);

  return finalUrls.length ? finalUrls : [listingUrl];
}

function extractFirstDateText(text) {
  const patterns = [
    /(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2}(?:,\s*\d{4})?\s*[-–—～〜]\s*(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2},\s*\d{4}/iu,
    /\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}\s*[-–—～〜]\s*\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/iu,
    /\d{4}年\d{1,2}月\d{1,2}日[\s\S]{0,40}?[～〜\-－][\s\S]{0,40}?\d{4}年\d{1,2}月\d{1,2}日/u,
    /\d{4}[./-]\d{1,2}[./-]\d{1,2}[\s\S]{0,30}?[-–—～〜][\s\S]{0,30}?(?:\d{4}[./-])?\d{1,2}[./-]\d{1,2}/u,
    /(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+\d{1,2},\s*\d{4}/iu,
    /\d{1,2}\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/iu,
    /\d{4}年\d{1,2}月\d{1,2}日/u,
    /\d{4}[./-]\d{1,2}[./-]\d{1,2}/u,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[0].replace(/\s+/g, " ").trim();
  }

  return "See source page";
}

function extractBestDateText(detailHtml) {
  const candidates = [
    stripTags(detailHtml),
    stripTags(extractMeta(detailHtml, "og:description") ?? ""),
    stripTags(extractMeta(detailHtml, "description") ?? ""),
    stripTags(extractMeta(detailHtml, "og:title") ?? ""),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const extracted = extractFirstDateText(candidate);
    if (extracted !== "See source page") return extracted;
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

function extractArtCollaborationKyotoDetailUrls(_listingHtml, listingUrl) {
  return [listingUrl];
}

function extractGalleryYamahonDetailUrls(_listingHtml, listingUrl) {
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
  const detailYear = detailUrl.match(/20\d{2}/)?.[0];
  const pageYear = englishRow.bodyText.match(/20\d{2}/)?.[0];
  const currentJapanYear = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date());
  const parsedDateRange = parseEnglishMonthDateRangeWithWeekdays(dateText);
  const parsedDates = parsedDateRange.startDate
    ? parsedDateRange
    : parseEnglishMonthDayRangeWithYear(dateText, detailYear ?? pageYear ?? currentJapanYear);
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

function parseDddScheduleEntries(listingHtml, listingUrl) {
  return [...listingHtml.matchAll(/<div class="ttl-cmn-exhibition-wrap[\s\S]*?<\/div><!-- \/ttl-cmn-exhibition-wrap -->/gi)]
    .map((match) => {
      const block = match[0];
      const href = block.match(/<a href="([^"]+)"/i)?.[1] ?? null;
      const seriesTitle = stripTags(block.match(/<span class="ttl01">([\s\S]*?)<\/span>/i)?.[1] ?? "");
      const title = stripTags(block.match(/<span class="ttl02">([\s\S]*?)<\/span>/i)?.[1] ?? "");
      const dateText = stripTags(block.match(/<p class="date">([\s\S]*?)<\/p>/i)?.[1] ?? "") || "See source page";

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

  const allImageUrls = finalizeImageUrls([
    { url: extractMeta(detailHtml, "og:image"), source: "og:image" },
    ...[...detailHtml.matchAll(/<img[^>]+src="([^"]*wp-content\/uploads[^"]+)"/gi)].map((match) => ({
      url: match[1],
      source: "img",
    })),
  ], detailUrl);
  const imageUrls = allImageUrls.length > 1 ? allImageUrls.slice(1) : allImageUrls;
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

function extractDddEvent(detailHtml, source, detailUrl) {
  const scheduleMatch = detailUrl.match(/#ddd-schedule-(\d+)$/);

  if (scheduleMatch) {
    const index = Number(scheduleMatch[1]) - 1;
    const entry = parseDddScheduleEntries(detailHtml, detailUrl.replace(/#.*$/, ""))[index];

    if (!entry) {
      throw new Error(`Could not extract DDD schedule entry ${index + 1}`);
    }

    const parsedDates = parseGenericDateRange(entry.dateText);

    return {
      title: entry.title,
      artist_name: null,
      categories: ["exhibition", "gallery", "design"],
      description: entry.seriesTitle || "Upcoming exhibition listed on the DDD schedule page.",
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
      timezone: "Asia/Tokyo",
      ...buildScheduleFields({
        startDate: parsedDates.startDate,
        endDate: parsedDates.endDate,
      }),
      calendar_starts_at: parsedDates.calendarStartsAt,
      calendar_ends_at: parsedDates.calendarEndsAt,
      primary_image_url: null,
      image_urls: [],
      source_url: detailUrl.replace(/#.*$/, ""),
    };
  }

  const title = stripTags(
    detailHtml.match(/<span class="ttl-cmn-01">([\s\S]*?)<\/span>/i)?.[1] ??
    extractMeta(detailHtml, "og:title") ??
    ""
  ).replace(/\s+\|\s+kyoto ddd gallery$/i, "").trim();

  if (!title) {
    throw new Error("Could not extract DDD exhibition title");
  }

  const dateText = stripTags(detailHtml.match(/<p class="date">([\s\S]*?)<\/p>/i)?.[1] ?? "") || "See source page";
  const parsedDates = parseGenericDateRange(dateText);
  const description = stripTags(
    extractMeta(detailHtml, "og:description") ??
    detailHtml.match(/<div class="txt">[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] ??
    ""
  ).slice(0, 1200);
  const imageUrl = finalizeImageUrls(
    [{ url: extractMeta(detailHtml, "og:image"), source: "og:image" }],
    detailUrl
  )[0] ?? null;

  return {
    title,
    artist_name: null,
    categories: ["exhibition", "gallery", "design"],
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
    timezone: "Asia/Tokyo",
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
  ], detailUrl).slice(0, 1);
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
    decodeHtml(extractMeta(detailHtml, "og:title") ?? ""),
    stripTags(detailHtml.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""),
    stripTags(detailHtml.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
  ].filter(Boolean);

  const title = candidates[0]
    ?.replace(/\s*[|｜\-–—]\s*KYOTOGRAPHIE 京都国際写真祭$/i, "")
    .replace(/\s*[|｜-]\s*.+$/, "")
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
  const dateText = extractBestDateText(detailHtml);
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

function extractKyotographieFestivalSchedule(planHtml) {
  const pageText = stripTags(planHtml).replace(/\s+/g, " ").trim();
  const match = pageText.match(
    /KYOTOGRAPHIE\s+(20\d{2})\s+runs from\s+(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+)?(\d{1,2})\s+([A-Za-z]+)\s+to\s+(?:(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+)?(\d{1,2})\s+([A-Za-z]+)/i
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
  const dateText = `${startWeekday ? `${startWeekday} ` : ""}${startDay} ${startMonth} - ${endWeekday ? `${endWeekday} ` : ""}${endDay} ${endMonth}, ${year}`;
  const parsedDates = parseEnglishDayMonthYearRange(`${startDay} ${startMonth} ${year} - ${endDay} ${endMonth} ${year}`);

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
    calendar_starts_at: hasFestivalSchedule ? festivalSchedule.calendarStartsAt : event.calendar_starts_at,
    calendar_ends_at: hasFestivalSchedule ? festivalSchedule.calendarEndsAt : event.calendar_ends_at,
    primary_image_url: imageUrls[0] ?? null,
    image_urls: imageUrls,
    extraction_confidence: hasFestivalSchedule ? 0.45 : event.extraction_confidence,
  };
}

function parseAckDateRange(dateText) {
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
  const cleaned = decodeHtml(dateText)
    .replace(/\b(?:Mon|Tue|Tues|Wed|Thu|Thurs|Fri|Sat|Sun)\.?\s*/gi, "")
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const match = cleaned.match(/([A-Za-z]+)\s+(\d{1,2})\s*-\s*(?:([A-Za-z]+)\s+)?(\d{1,2}),\s*(20\d{2})/);

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

  const startDate = `${year}-${startMonth}-${String(startDay).padStart(2, "0")}`;
  const endDate = `${year}-${endMonth}-${String(endDay).padStart(2, "0")}`;

  return {
    startDate,
    endDate,
    calendarStartsAt: `${startDate}T00:00:00+09:00`,
    calendarEndsAt: `${endDate}T23:59:59+09:00`,
  };
}

function extractAckItemLines(detailHtml, heading) {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<h2[^>]*class="[^"]*m-item_heading[^"]*"[^>]*>\\s*${escapedHeading}\\s*<\\/h2>[\\s\\S]*?<div[^>]*class="[^"]*m-item_body[^"]*"[^>]*>\\s*<p[^>]*>([\\s\\S]*?)<\\/p>`,
    "i"
  );

  return stripTags(detailHtml.match(pattern)?.[1] ?? "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^Google map$/i.test(line));
}

function extractAckItemText(detailHtml, heading) {
  return extractAckItemLines(detailHtml, heading).join(" ");
}

function extractArtCollaborationKyotoEvent(detailHtml, source, detailUrl) {
  const dateText = extractAckItemText(detailHtml, "Dates") ||
    stripTags(detailHtml.match(/alt="([^"]*Art Collaboration Kyoto[^"]*20\d{2}[^"]*)"/i)?.[1] ?? "");
  const parsedDates = parseAckDateRange(dateText);
  const aboutDescription = stripTags(
    detailHtml.match(/<p[^>]*class="about-overview"[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? ""
  ).replace(/\s+/g, " ").trim();
  const description = aboutDescription || stripTags(extractMeta(detailHtml, "description") ?? "");
  const venueLines = extractAckItemLines(detailHtml, "Venue");
  const venueName = venueLines[0] ?? "Kyoto International Conference Center";
  const addressText = venueLines.find((line) => /Kyoto\s+\d{3}-\d{4}\s+Japan/i.test(line)) ?? venueName;
  const imageUrls = extractGenericImageUrls(detailHtml, detailUrl).slice(0, 2);
  const year = parsedDates.startDate?.slice(0, 4) ?? dateText.match(/20\d{2}/)?.[0] ?? "";

  return {
    title: `Art Collaboration Kyoto${year ? ` ${year}` : ""}`,
    artist_name: null,
    categories: ["art-fair", "art"],
    description,
    institution_name: source.name,
    venue_name: venueName || "Kyoto International Conference Center",
    address_text: addressText || "Takaragaike, Sakyo-ku, Kyoto 606-0001 Japan",
    directions_query: source.directions_query ?? "Kyoto International Conference Center, Kyoto",
    date_text: dateText || "See source page",
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
    extraction_confidence: parsedDates.startDate ? 0.8 : 0.35,
  };
}

function extractGalleryYamahonEvent(detailHtml, source, detailUrl) {
  const englishHeading = [...detailHtml.matchAll(/<h5\b[^>]*>([\s\S]*?)<\/h5>/gi)]
    .map((match) => stripTags(match[1]))
    .map((value) => value.split("\n").map((line) => line.trim()).filter(Boolean))
    .find((lines) => /^No\.\s*\d+/i.test(lines[0] ?? ""));

  if (!englishHeading) {
    throw new Error("Could not find Gallery Yamahon English exhibition heading");
  }

  const [title, dateText = "See source page", ...headingDetails] = englishHeading;
  const yearHint =
    detailHtml.match(/(20\d{2})年/)?.[1] ??
    detailHtml.match(/datetime=["'](20\d{2})/)?.[1] ??
    String(new Date().getFullYear());
  const parseableDateText = `${dateText.replace(/\b([A-Za-z]{3})\./g, "$1")}, ${yearHint}`;
  const parsedDates = parseEnglishMonthDateRangeWithOptionalStartYear(parseableDateText);
  const timeText = headingDetails.find((line) => /\d{1,2}:\d{2}\s*[-–—]\s*\d{1,2}:\d{2}/.test(line)) ?? null;
  const timeMatch = timeText?.match(/(\d{1,2}:\d{2})\s*[-–—]\s*(\d{1,2}:\d{2})/);
  const startTimeText = timeMatch?.[1] ?? null;
  const endTimeText = timeMatch?.[2] ?? null;
  const venueName = headingDetails
    .find((line) => /^MAP\s*:/i.test(line))
    ?.replace(/^MAP\s*:\s*/i, "")
    .trim() || source.name;
  const artistName = title
    .replace(/^No\.\s*\d+\s*/i, "")
    .split(":")[0]
    ?.trim() || null;
  const paragraphs = [...detailHtml.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const description = paragraphs.find((paragraph) => /^We are pleased\b/i.test(paragraph)) ??
    paragraphs.find((paragraph) =>
      paragraph.length > 80 && paragraph.replace(/[^\x00-\x7F]/g, "").length / paragraph.length > 0.75
    ) ??
    "";
  const imageUrls = extractGenericImageUrls(detailHtml, detailUrl);
  const calendarStartsAt = parsedDates.startDate && startTimeText
    ? `${parsedDates.startDate}T${startTimeText}:00+09:00`
    : parsedDates.calendarStartsAt;
  const calendarEndsAt = parsedDates.endDate && endTimeText
    ? `${parsedDates.endDate}T${endTimeText}:00+09:00`
    : parsedDates.calendarEndsAt;

  return {
    title,
    artist_name: artistName,
    categories: ["exhibition"],
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
    is_all_day: false,
    timezone: "Asia/Tokyo",
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

function extractKankakariEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const firstImageUrl = event.image_urls?.[0] ?? null;

  return {
    ...event,
    primary_image_url: firstImageUrl,
    image_urls: firstImageUrl ? [firstImageUrl] : [],
  };
}

function extractMtkEvent(detailHtml, source, detailUrl) {
  const event = extractGenericEvent(detailHtml, source, detailUrl);
  const descriptionBlock = extractClassBlock(detailHtml, "ex__detail", "div") ?? "";
  const description = [...descriptionBlock.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripTags(match[1]).replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((value) => !/^[-–—]+$/.test(value))
    .filter((value) => !/^photo by\b/i.test(value))
    .join("\n\n");
  const sliderHtml =
    detailHtml.match(/<div class="ex__slider-main ex__slider">[\s\S]*?<div class="swiper-wrapper">([\s\S]*?)<\/div>\s*<\/div>/i)?.[1] ??
    detailHtml.match(/<div class="swiper-wrapper">([\s\S]*?)<\/div>/i)?.[1] ??
    "";

  const sliderImageUrls = finalizeImageUrls(
    [...sliderHtml.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((match) => ({
      url: match[1],
      source: "mtk-swiper",
    })),
    detailUrl
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
        return hostname === "galleryunfold.com" && pathname !== "/archive" && pathname.length > 1;
      } catch {
        return false;
      }
    });

  const unique = [...new Set(matches)];

  if (!unique.length) {
    throw new Error("Could not find Gallery Unfold archive detail URLs");
  }

  return unique.slice(0, 1);
}

const detailUrlExtractors = {
  "art-collaboration-kyoto": extractArtCollaborationKyotoDetailUrls,
  "dnp-foundation-for-cultural-promotion-gallery-ddd": extractDddDetailUrls,
  "essence-kyoto": extractEssenceDetailUrls,
  "gallery-yamahon": extractGalleryYamahonDetailUrls,
  "hosoo-gallery": extractHosooDetailUrls,
  "kyoto-art-center": extractKacDetailUrls,
  "kyoto-national-museum": extractKyohakuDetailUrls,
  "kyoto-city-kyocera-museum-of-art": extractKyoceraDetailUrls,
  "taka-ishii-gallery": extractTakaIshiiDetailUrls,
  "zenbi": extractZenbiDetailUrls,
  "the-national-museum-of-modern-art": extractMomakDetailUrls,
  "sen-oku-hakukokan-museum": extractSenOkuDetailUrls,
  "gallery-unfold": extractGalleryUnfoldDetailUrls,
};

const eventExtractors = {
  "art-collaboration-kyoto": extractArtCollaborationKyotoEvent,
  "dnp-foundation-for-cultural-promotion-gallery-ddd": extractDddEvent,
  "essence-kyoto": extractEssenceEvent,
  "gallery-yamahon": extractGalleryYamahonEvent,
  "hosoo-gallery": extractHosooEvent,
  "kyoto-art-center": extractKacEvent,
  "kyoto-national-museum": extractKyohakuEvent,
  "kyoto-city-kyocera-museum-of-art": extractKyoceraEvent,
  "kyotographie": extractKyotographieEvent,
  "kyotophonie": extractKyotophonieEvent,
  "kankakari": extractKankakariEvent,
  "mtk": extractMtkEvent,
  "sibasi": extractSibasiEvent,
  "taka-ishii-gallery": extractTakaIshiiEvent,
  "zenbi": extractZenbiEvent,
  "the-national-museum-of-modern-art": extractMomakEvent,
  "sen-oku-hakukokan-museum": extractSenOkuEvent,
};

function runJsonCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `${command} exited with status ${code}`));
        return;
      }

      try {
        const jsonLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
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

      const width = image.width ? ` width="${escapeHtmlAttribute(image.width)}"` : "";
      const height = image.height ? ` height="${escapeHtmlAttribute(image.height)}"` : "";
      return `<img src="${escapeHtmlAttribute(src)}"${width}${height} data-crawl4ai-media="true">`;
    })
    .filter(Boolean)
    .join("");

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
    "user-agent": userAgent,
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "ja,en-US;q=0.9,en;q=0.8",
    "cache-control": "no-cache",
  };
}

function classifyFetchResult({ response = null, html = "", error = null }) {
  if (error) {
    return error?.name === "TimeoutError" || /timeout|aborted/i.test(error.message ?? "")
      ? "timeout"
      : "network_error";
  }

  if (!response) return "network_error";

  const status = response.status;
  const contentType = response.headers.get("content-type") ?? "";
  const normalizedHtml = html.slice(0, 20000).toLowerCase();
  const htmlWithoutScripts = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const visibleText = stripTags(htmlWithoutScripts).replace(/\s+/g, " ").trim();

  if (status === 429) return "rate_limited";
  if ([408, 425, 500, 502, 503, 504].includes(status)) return "transient_error";
  if ([401, 403].includes(status)) return "forbidden";
  if (!response.ok) return "http_error";
  if (contentType && !/html|xml|text\/plain/i.test(contentType)) return "not_html";

  if (
    /<title>[^<]*(just a moment|access denied|attention required|captcha|security check|blocked)[^<]*<\/title>/i.test(html) ||
    /cloudflare|cf-browser-verification|g-recaptcha|hcaptcha|captcha|checking your browser|access denied|request blocked/i.test(normalizedHtml)
  ) {
    return "bot_challenge";
  }

  if (
    visibleText.length < 500 &&
    /enable javascript|requires javascript|javascript is disabled|<noscript|id=["'](__next|root|app)["']|data-reactroot|webpackJsonp|window\.__NUXT__/i.test(html)
  ) {
    return "js_shell";
  }

  if (html.trim().length < 200) return "empty_or_suspicious";

  return "ok";
}

function isRetryableFetchClassification(classification) {
  return ["timeout", "network_error", "rate_limited", "transient_error"].includes(classification);
}

function shouldTryRenderFallback(fetched) {
  return ["js_shell", "empty_or_suspicious"].includes(fetched?.metadata?.fetch_classification);
}

function getRetryAfterDelayMs(response) {
  const retryAfter = response?.headers?.get("retry-after");
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;

  const dateMs = Date.parse(retryAfter);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function getRetryDelayMs({ attempt, baseDelayMs, response = null }) {
  const retryAfterDelayMs = getRetryAfterDelayMs(response);
  if (retryAfterDelayMs !== null) return retryAfterDelayMs;

  const exponentialDelayMs = baseDelayMs * (2 ** Math.max(0, attempt - 1));
  const jitterMs = Math.floor(Math.random() * Math.min(baseDelayMs, 1000));
  return exponentialDelayMs + jitterMs;
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
    skipped_other_count: 0,
    crawl4ai_render_count: 0,
    crawl4ai_render_limit: getEnvNumber(env, "CRAWL4AI_MAX_RENDERS_PER_SOURCE", 5),
    crawl4ai_render_skipped_count: 0,
  };
}

function recordFetchedPage(diagnostics, fetched) {
  if (!diagnostics || !fetched?.metadata) return;

  if (fetched.metadata.fetched_via === "crawl4ai") {
    diagnostics.fetched_crawl4ai_count += 1;
  } else if (fetched.metadata.fetched_via === "fetch") {
    diagnostics.fetched_static_count += 1;
  }

  const classification = fetched.metadata.fetch_classification;
  if (classification === "bot_challenge") diagnostics.bot_challenge_count += 1;
  if (classification === "js_shell") diagnostics.js_shell_count += 1;
  if (classification === "empty_or_suspicious") diagnostics.empty_or_suspicious_count += 1;

  const attempts = Number(fetched.metadata.fetch_attempts ?? 1);
  if (Number.isFinite(attempts) && attempts > 1) {
    diagnostics.retry_count += attempts - 1;
  }

  const fallbackClassification = fetched.metadata.fallback_from?.fetch_classification;
  if (fallbackClassification === "bot_challenge") diagnostics.bot_challenge_count += 1;
  if (fallbackClassification === "js_shell") diagnostics.js_shell_count += 1;
  if (fallbackClassification === "empty_or_suspicious") diagnostics.empty_or_suspicious_count += 1;
}

function recordSkippedEvent(diagnostics, reason) {
  if (!diagnostics) return;

  if (reason === "missing image") {
    diagnostics.missing_image_count += 1;
  } else if (reason === "past event") {
    diagnostics.skipped_past_count += 1;
  } else if (/older than/.test(reason ?? "")) {
    diagnostics.skipped_old_count += 1;
  } else if (reason === "missing verifiable event date") {
    diagnostics.skipped_missing_date_count += 1;
  } else {
    diagnostics.skipped_other_count += 1;
  }
}

function pushSkippedEvent(skippedEvents, diagnostics, skippedEvent) {
  skippedEvents.push(skippedEvent);
  recordSkippedEvent(diagnostics, skippedEvent.reason);
}

function classifySourceOutcome({ detailUrls = [], savedEvents = [], skippedEvents = [], diagnostics = {}, usedGenericExtractor = false }) {
  if (!detailUrls.length) return "source_empty";
  if (savedEvents.length > 0) return diagnostics.bot_challenge_count > 0 ? "source_degraded" : "source_ok";
  if (diagnostics.bot_challenge_count > 0) return "source_blocked";
  if (skippedEvents.length && skippedEvents.every((event) => /past event|older than/.test(event.reason ?? ""))) {
    return "source_no_current_events";
  }
  if (usedGenericExtractor || diagnostics.missing_image_count > 0 || diagnostics.skipped_missing_date_count > 0) {
    return "source_needs_review";
  }
  return "source_empty";
}

async function waitForDomainDelay(url, env) {
  const minDelayMs = getEnvNumber(env, "CRAWLER_MIN_DELAY_MS", 1000);
  const maxDelayMs = getEnvNumber(env, "CRAWLER_MAX_DELAY_MS", 3000);
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

  const pythonBinary = env.CRAWL4AI_PYTHON ?? "python3";
  const args = [
    crawl4AiFetchPath,
    url,
    "--user-agent",
    userAgent,
    "--timeout-ms",
    env.CRAWL4AI_PAGE_TIMEOUT_MS ?? "45000",
    "--scroll-delay",
    env.CRAWL4AI_SCROLL_DELAY ?? "0.5",
  ];

  if (envFlag(env, "CRAWL4AI_WAIT_FOR_IMAGES", true)) args.push("--wait-for-images");
  if (envFlag(env, "CRAWL4AI_SCAN_FULL_PAGE", true)) args.push("--scan-full-page");
  if (envFlag(env, "CRAWL4AI_BYPASS_CACHE", true)) args.push("--bypass-cache");

  try {
    await waitForDomainDelay(url, env);
    const result = await runJsonCommand(pythonBinary, args, {
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
    });

    if (!result.success) {
      const message = result.error_message ?? "Crawl4AI render failed";
      if (/No module named|ModuleNotFoundError|ImportError|not found/i.test(message)) {
        crawl4AiDisabled = true;
        console.warn(`Crawl4AI render unavailable; continuing with static fetches. ${message}`);
      } else {
        console.warn(`Crawl4AI render failed for ${url}; continuing with static fetch. ${message}`);
      }
      return null;
    }

    const html = appendCrawl4AiMediaHtml(result.html ?? "", result.media?.images ?? []);
    return {
      url,
      response: {
        url: result.url ?? url,
        status: 200,
      },
      html,
      title: result.metadata?.title ?? result.title ?? html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
      contentType: "text/html; charset=utf-8",
      metadata: {
        fetched_via: "crawl4ai",
        crawl4ai_images_count: result.media?.images?.length ?? 0,
      },
    };
  } catch (error) {
    crawl4AiDisabled = true;
    console.warn(`Crawl4AI render unavailable; continuing with static fetches. ${error.message}`);
    return null;
  }
}

async function fetchStaticHtml(url, userAgent, env = {}) {
  const timeoutMs = getEnvNumber(env, "CRAWLER_FETCH_TIMEOUT_MS", 30000);
  const maxRetries = getEnvNumber(env, "CRAWLER_FETCH_RETRIES", 2);
  const baseDelayMs = getEnvNumber(env, "CRAWLER_RETRY_BASE_DELAY_MS", 1000);
  const retryLog = [];
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    let response = null;
    let html = "";
    let classification = "network_error";

    try {
      await waitForDomainDelay(url, env);
      response = await fetch(url, {
        headers: buildStaticFetchHeaders(userAgent),
        signal: AbortSignal.timeout(timeoutMs),
      });
      html = await response.text();
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
        throw new Error(`Fetch failed for ${url} after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${lastError.message}`);
      }

      return {
        url,
        response,
        html,
        title: html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
        contentType: response.headers.get("content-type"),
        metadata: {
          fetched_via: "fetch",
          fetch_classification: classification,
          fetch_attempts: attempt,
          fetch_timeout_ms: timeoutMs,
          retry_log: retryLog,
        },
      };
    }

    const delayMs = getRetryDelayMs({ attempt, baseDelayMs, response });
    await sleep(delayMs);
  }

  throw new Error(`Fetch failed for ${url}`);
}

async function fetchHtml(url, userAgent, env = {}, options = {}) {
  if (options.renderMode === "always") {
    const rendered = await fetchHtmlWithCrawl4Ai(url, userAgent, env, options.context);
    if (rendered) return rendered;
  }

  const staticPage = await fetchStaticHtml(url, userAgent, env);

  if (options.renderMode === "auto" && shouldTryRenderFallback(staticPage)) {
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
          ...(fetched.metadata ?? {}),
          final_url: fetched.response.url,
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
    last_seen_at: new Date().toISOString(),
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

async function archiveStaleEvents(env, sourceId, activeDedupeKeys) {
  const rows = await supabaseRequest({
    env,
    path: `events?source_id=eq.${sourceId}&status=eq.published&select=id,dedupe_key`,
  });

  const staleIds = (rows ?? [])
    .filter((row) => !activeDedupeKeys.has(row.dedupe_key))
    .map((row) => row.id);

  let archivedCount = 0;

  for (const staleId of staleIds) {
    const archivedRows = await supabaseRequest({
      env,
      path: `events?id=eq.${staleId}`,
      method: "PATCH",
      body: {
        status: "archived",
      },
    });

    archivedCount += archivedRows?.length ?? 0;
  }

  return archivedCount;
}

function hasExtractedImage(eventData) {
  return Boolean(eventData?.primary_image_url) ||
    (Array.isArray(eventData?.image_urls) && eventData.image_urls.some(Boolean));
}

async function crawlSource({ env, sourceSlug, userAgent, sourceOverrides, genericDetailLimit, renderMode }) {
  const source = applySourceOverride(
    await getSourceBySlug(env, sourceSlug),
    sourceOverrides[sourceSlug]
  );
  const crawlRun = await createCrawlRun(env, source.id);
  const diagnostics = createCrawlDiagnostics(env);
  const crawlContext = { diagnostics };

  try {
    const listingUrls = [...new Set(source.start_urls?.filter(Boolean) ?? [])];
    if (!listingUrls.length) {
      throw new Error(`Source "${source.slug}" does not have a start URL`);
    }

    let pagesFetched = 0;
    const listingPages = [];

    for (const listingUrl of listingUrls) {
      const listingPage = await fetchHtml(listingUrl, userAgent, env, {
        renderMode,
        context: crawlContext,
      });
      pagesFetched += 1;
      recordFetchedPage(diagnostics, listingPage);
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
      const sourceOutcome = classifySourceOutcome({ detailUrls, diagnostics });
      await updateCrawlRun(env, crawlRun.id, {
        status: "success",
        finished_at: new Date().toISOString(),
        pages_queued: listingPages.length,
        pages_fetched: pagesFetched,
        pages_parsed: 0,
        events_created: 0,
        events_updated: 0,
        logs: [
          {
            level: "warn",
            message: `No detail URLs were extracted for source "${source.slug}".`,
          },
          {
            level: "info",
            message: `Source outcome: ${sourceOutcome}`,
          },
          {
            level: "info",
            message: "Crawl diagnostics",
            diagnostics,
          },
        ],
      });

      return {
        crawlRunId: crawlRun.id,
        source: source.slug,
        status: "success",
        sourceOutcome,
        usedGenericExtractor: !detailUrlExtractor,
        renderMode,
        diagnostics,
        detailUrls,
        events: [],
        archivedEvents: 0,
      };
    }

    let sourceContext = {};
    if (source.slug === "the-national-museum-of-modern-art") {
      const accessPage = await fetchHtml("https://www.momak.go.jp/English/guide/access.html", userAgent, env, {
        renderMode: "never",
        context: crawlContext,
      });
      pagesFetched += 1;
      recordFetchedPage(diagnostics, accessPage);
      await upsertRawPage(env, source.id, crawlRun.id, "detail", accessPage);
      sourceContext = { accessHtml: accessPage.html };
    } else if (source.slug === "sen-oku-hakukokan-museum") {
      const accessPage = await fetchHtml("https://sen-oku.or.jp/kyoto/facility/access", userAgent, env, {
        renderMode: "never",
        context: crawlContext,
      });
      pagesFetched += 1;
      recordFetchedPage(diagnostics, accessPage);
      await upsertRawPage(env, source.id, crawlRun.id, "detail", accessPage);
      sourceContext = { accessHtml: accessPage.html };
    } else if (source.slug === "kyotographie") {
      const planPage = await fetchHtml("https://www.kyotographie.jp/en/plan_your_visit/", userAgent, env, {
        renderMode: "never",
        context: crawlContext,
      });
      pagesFetched += 1;
      recordFetchedPage(diagnostics, planPage);
      await upsertRawPage(env, source.id, crawlRun.id, "detail", planPage);
      sourceContext = { festivalSchedule: extractKyotographieFestivalSchedule(planPage.html) };
    }

    const eventExtractor = eventExtractors[source.slug] ?? extractGenericEvent;
    const todayJapan = toJapanDate(new Date());
    const oneYearAgoJapan = shiftDateOnlyByYears(todayJapan, -1);
    const previousYear = Number(todayJapan.slice(0, 4)) - 1;

    const savedEvents = [];
    const skippedEvents = [];
    const activeDedupeKeys = new Set();

    for (const detailUrl of detailUrls) {
      let detailPage = await fetchHtml(detailUrl, userAgent, env, {
        renderMode,
        context: crawlContext,
      });
      pagesFetched += 1;
      recordFetchedPage(diagnostics, detailPage);
      let extractedEvent = withSourceCategories(
        eventExtractor(detailPage.html, source, detailUrl, sourceContext),
        source
      );

      if (renderMode === "auto" && detailPage.metadata?.fetched_via !== "crawl4ai" && !hasExtractedImage(extractedEvent)) {
        const renderedDetailPage = await fetchHtmlWithCrawl4Ai(detailUrl, userAgent, env, crawlContext);
        if (renderedDetailPage) {
          pagesFetched += 1;
          recordFetchedPage(diagnostics, renderedDetailPage);
          const renderedEvent = withSourceCategories(
            eventExtractor(renderedDetailPage.html, source, detailUrl, sourceContext),
            source
          );
          detailPage = renderedDetailPage;
          extractedEvent = renderedEvent;
        }
      }

      const detailRawPage = await upsertRawPage(env, source.id, crawlRun.id, "detail", detailPage);

      if (source.slug === "sibasi") {
        const hasVerifiedDate =
          Boolean(extractedEvent.start_date) ||
          Boolean(extractedEvent.end_date) ||
          (Array.isArray(extractedEvent.occurrence_dates) && extractedEvent.occurrence_dates.length > 0);

        if (!hasVerifiedDate) {
          pushSkippedEvent(skippedEvents, diagnostics, {
            detailUrl,
            title: extractedEvent.title,
            reason: "missing verifiable event date",
          });
          continue;
        }

        if (classifyEventTiming(extractedEvent, todayJapan) === "past") {
          pushSkippedEvent(skippedEvents, diagnostics, {
            detailUrl,
            title: extractedEvent.title,
            reason: "past event",
          });
          continue;
        }
      }

      const latestEventDate = getLatestEventDateOnly(extractedEvent);
      if (latestEventDate && oneYearAgoJapan && latestEventDate < oneYearAgoJapan) {
        pushSkippedEvent(skippedEvents, diagnostics, {
          detailUrl,
          title: extractedEvent.title,
          reason: `older than one year (${latestEventDate})`,
        });
        continue;
      }

      if (!latestEventDate) {
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

      if (!hasExtractedImage(extractedEvent)) {
        pushSkippedEvent(skippedEvents, diagnostics, {
          detailUrl,
          title: extractedEvent.title,
          reason: "missing image",
        });
        continue;
      }

      const dedupeKey = buildEventDedupeKey(extractedEvent);
      activeDedupeKeys.add(dedupeKey);
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

    const archivedEvents = await archiveStaleEvents(env, source.id, activeDedupeKeys);
    const usedGenericExtractor = !eventExtractors[source.slug];
    const sourceOutcome = classifySourceOutcome({
      detailUrls,
      savedEvents,
      skippedEvents,
      diagnostics,
      usedGenericExtractor,
    });

    await updateCrawlRun(env, crawlRun.id, {
      status: "success",
      finished_at: new Date().toISOString(),
      pages_queued: detailUrls.length + listingPages.length,
      pages_fetched: pagesFetched,
      pages_parsed: savedEvents.length,
      events_created: savedEvents.length,
      events_updated: archivedEvents,
      logs: [
        {
          level: "info",
          message: `Crawl4AI render mode: ${renderMode}`,
        },
        {
          level: "info",
          message: `Source outcome: ${sourceOutcome}`,
        },
        {
          level: "info",
          message: "Crawl diagnostics",
          diagnostics,
        },
        ...(usedGenericExtractor ? [{
          level: "warn",
          message: "Used generic fallback extraction; review output and add a source-specific extractor when needed.",
        }] : []),
        ...savedEvents.map((savedEvent) => ({
          level: "info",
          message: `Stored event ${savedEvent.eventId} from ${savedEvent.detailUrl}`,
        })),
        ...skippedEvents.map((skippedEvent) => ({
          level: "info",
          message: `Skipped ${skippedEvent.reason ?? "event"} from ${skippedEvent.detailUrl}${skippedEvent.title ? ` (${skippedEvent.title})` : ""}`,
        })),
        ...(archivedEvents > 0
          ? [{
              level: "info",
              message: `Archived ${archivedEvents} stale event${archivedEvents === 1 ? "" : "s"} not seen in this crawl.`,
            }]
          : []),
      ],
    });

    return {
      crawlRunId: crawlRun.id,
      source: source.slug,
      status: "success",
      sourceOutcome,
      usedGenericExtractor,
      renderMode,
      diagnostics,
      detailUrls,
      events: savedEvents,
      archivedEvents,
    };
  } catch (error) {
    await updateCrawlRun(env, crawlRun.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: error instanceof Error ? error.message : String(error),
      logs: [
        {
          level: "error",
          message: `Source outcome: source_failed`,
        },
        {
          level: "info",
          message: "Crawl diagnostics",
          diagnostics,
        },
      ],
    });

    return {
      crawlRunId: crawlRun.id,
      source: source.slug,
      status: "failed",
      sourceOutcome: "source_failed",
      diagnostics,
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
  const renderMode = getCrawl4AiRenderMode(env);
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
      renderMode,
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

export {
  classifyFetchResult,
  classifySourceOutcome,
  createCrawlDiagnostics,
  extractGenericDetailUrls,
  extractGenericEvent,
  hasExtractedImage,
  recordFetchedPage,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
