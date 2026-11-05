import { createHash } from 'node:crypto';

const SLUGS = [
  'kyoto-kobunka',
  'kyoto-shunju',
  'kyoto-tourism-openings',
  'kyoto-prefecture-openings',
];
const text = (html = '') =>
  String(html)
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
const match = (html, re) => html.match(re)?.[1] ?? '';
function classHtml(html, cls) {
  const found = html.match(
    new RegExp(
      `<([a-z0-9]+)\\b[^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
      'i',
    ),
  );
  return found?.[2] ?? '';
}
function field(html, label) {
  for (const row of html.matchAll(
    /<(th|dt)\b[^>]*>([\s\S]*?)<\/\1>\s*<(td|dd)\b[^>]*>([\s\S]*?)<\/\3>/gi,
  )) {
    if (new RegExp(`^(?:${label})$`).test(text(row[2]))) return row[4];
  }
  return '';
}
function links(html, base) {
  return [...html.matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].flatMap((m) => {
    try {
      return [new URL(m[1].replace(/&amp;/g, '&'), base).href];
    } catch {
      return [];
    }
  });
}
function inlineEntries(html) {
  return [
    ...html.matchAll(
      /<div\s+class=["']head["'][^>]*>\s*<span\s+class=["']no["'][^>]*>(\d+)<\/span>([\s\S]*?)(?=<div\s+class=["']head["']|<\/ol>)/g,
    ),
  ].map((m) => {
    const venue = text(match(m[2], /<h4[^>]*>([\s\S]*?)<\/h4>/));
    return {
      html: m[2],
      venue,
      entryId: m[1],
      key: createHash('sha256').update(venue).digest('hex').slice(0, 16),
    };
  });
}
function iso(y, m, d) {
  const value = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}
const dayAfter = (d) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
/** Explicit year required; inherited year/month apply only within supplied date text. */
export function parseTemplePeriods(raw, yearHint = null) {
  const value = text(raw)
    .normalize('NFKC')
    .replace(/\([^)]*\)/g, '')
    .replace(/[〜～－—]/g, '~');
  let year = Number(value.match(/(20\d{2})年/)?.[1] ?? yearHint) || null;
  let month = null;
  const dates = [];
  const re = /(?:(20\d{2})年)?(?:(\d{1,2})(?:月|\/|\.\s*))?(\d{1,2})日?/g;
  let previousEnd = 0;
  for (const token of value.matchAll(re)) {
    const join = value.slice(previousEnd, token.index);
    if (
      !token[1] &&
      !token[2] &&
      !token[0].endsWith('日') &&
      !(month && /^[、,・~\s]*$/.test(join))
    )
      continue;
    year = Number(token[1]) || year;
    const nextMonth = Number(token[2]) || month;
    if (month === 12 && nextMonth === 1 && !token[1] && dates.length) year += 1;
    month = nextMonth;
    if (!year || !month) continue;
    const date = iso(year, month, Number(token[3]));
    if (!date) continue;
    if (dates.length && /~/.test(join)) dates[dates.length - 1].end_date = date;
    else dates.push({ is_all_day: true, start_date: date, end_date: date });
    previousEnd = token.index + token[0].length;
  }
  return dates.filter((d) => d.end_date >= d.start_date);
}
function removeClosedDays(periods, closures, year) {
  const closed = parseTemplePeriods(closures, year);
  const days = [];
  for (const p of periods) {
    for (
      let d = p.start_date, guard = 0;
      d <= p.end_date && guard < 740;
      d = dayAfter(d), guard++
    ) {
      if (!closed.some((c) => d >= c.start_date && d <= c.end_date)) days.push(d);
    }
  }
  const result = [];
  for (const d of [...new Set(days)].sort()) {
    const last = result.at(-1);
    if (last && dayAfter(last.end_date) === d) last.end_date = d;
    else result.push({ is_all_day: true, start_date: d, end_date: d });
  }
  return result;
}
function jsonEvent(html) {
  for (const m of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data, ...(data['@graph'] ?? [])];
      const event = items.find((v) => v['@type'] === 'Event');
      if (event) return event;
    } catch {
      /* malformed publisher metadata is not evidence */
    }
  }
  return {};
}
function images(html, base, slug) {
  return [
    ...new Set(
      [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)].flatMap((m) => {
        const src = m[1];
        if (/logo|banner|no_thumb|arrow|icon|map_|flier|ajax|loading|\.svg/i.test(src)) return [];
        if (slug === 'kyoto-shunju' && !/\/uploads\//.test(src)) return [];
        if (slug === 'kyoto-tourism-openings' && !/\/resource\/event\//.test(src)) return [];
        try {
          return [new URL(src, base).href];
        } catch {
          return [];
        }
      }),
    ),
  ];
}
function listingCards(html, slug) {
  if (slug === 'kyoto-prefecture-openings')
    return [
      ...html.matchAll(
        /<article\b[^>]*class=["'][^"']*\bspotArticle\b[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi,
      ),
    ].map((v) => v[1]);
  const starts = [...html.matchAll(/<li\b[^>]*data-is_finished=["'][^"']*["'][^>]*>/gi)];
  const end = html.search(/<div\b[^>]*class=["'][^"']*\bpageNav\b/);
  return starts.map((v, i) =>
    html.slice(v.index, starts[i + 1]?.index ?? (end > v.index ? end : html.length)),
  );
}
function hasOpeningScope(title, body = '', venue = '') {
  const scope =
    /特別(?:公開|拝観|参拝)|限定公開|寺宝展|庭園公開|秘仏.*公開|開扉|[御ご]開帳|特別開帳|拝観企画|特別夜間開園/;
  const openingEvidence =
    scope.test(title) ||
    /特別(?:公開|拝観)|限定公開|寺宝展|庭園公開|秘仏.*公開|開扉|[御ご]開帳/.test(body);
  const venueExhibition =
    /寺|院|庵|神社|庭園/.test(`${venue} ${body}`) && /展覧会|企画展|展示|展$/.test(title);
  return openingEvidence || venueExhibition;
}
export function createTempleSourceAdapters({
  extractGenericEvent = () => ({}),
  buildScheduleFields = () => ({}),
} = {}) {
  const detailUrlExtractors = Object.fromEntries(
    SLUGS.map((slug) => [
      slug,
      (html, url) => {
        if (slug === 'kyoto-kobunka')
          return inlineEntries(html).map((v) => `${url.split('#')[0]}#entry-${v.key}`);
        const pattern =
          slug === 'kyoto-shunju'
            ? /\/temple\/[^/?#]+\/$/
            : slug === 'kyoto-tourism-openings'
              ? /\/event\/single\.php\?event_id=\d+$/
              : /\/event\/\d+$/;
        const cards =
          slug === 'kyoto-shunju'
            ? [html]
            : listingCards(html, slug).filter((card) => {
                const title = text(match(card, /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i));
                // Category labels say 特別公開 even when an item is unrelated; only event title/prose count.
                const body =
                  slug === 'kyoto-prefecture-openings'
                    ? text(classHtml(card, 'spotArticle__contentText'))
                    : '';
                return hasOpeningScope(title, body, title);
              });
        return [
          ...new Set(
            cards
              .flatMap((card) => links(card, url))
              .filter((v) => new URL(v).origin === new URL(url).origin && pattern.test(v)),
          ),
        ];
      },
    ]),
  );
  const listingPaginationUrls = (html, url, source) => {
    const current = new URL(url);
    const discovered = links(html, url);
    if (source?.slug === 'kyoto-tourism-openings') {
      const nav = classHtml(html, 'pageNav');
      for (const m of nav.matchAll(/data-value=["'](\d+)["']/g)) {
        const next = new URL(url);
        next.searchParams.set('page', m[1]);
        discovered.push(next.href);
      }
    }
    return [
      ...new Set(
        discovered
          .filter((value) => {
            const next = new URL(value);
            const page = Number(next.searchParams.get('page'));
            return (
              next.origin === current.origin &&
              next.pathname === current.pathname &&
              page >= 1 &&
              page <= 1000 &&
              value !== url
            );
          })
          .map((value) => {
            const next = new URL(value);
            for (const [key, val] of current.searchParams)
              if (key !== 'page' && !next.searchParams.has(key)) next.searchParams.set(key, val);
            return next.href;
          }),
      ),
    ];
  };
  const eventExtractors = Object.fromEntries(
    SLUGS.map((slug) => [
      slug,
      (html, source, url, context = {}) => {
        const original = html;
        const edition = original.match(/\/((?:20)\d{2}_[as])_flier/)?.[1] ?? null;
        let title = '',
          venue = '',
          address = '',
          dateText = '',
          description = '',
          closures = '',
          hours = '',
          structuredYear = null,
          scheduleNotes = '',
          entryId = null;
        const warnings = [];
        if (slug === 'kyoto-kobunka') {
          const entry = inlineEntries(html).find((v) => `#entry-${v.key}` === new URL(url).hash);
          html = entry?.html ?? '';
          venue = entry?.venue ?? '';
          entryId = entry?.entryId ?? null;
          title = venue ? `${venue} 京都非公開文化財特別公開` : '';
          dateText = text(classHtml(html, 'date'));
          description = [
            text(classHtml(html, 'content')),
            ...[...html.matchAll(/<p class="note">([\s\S]*?)<\/p>/g)].map((v) => text(v[1])),
          ]
            .filter(Boolean)
            .join('\n');
          closures = [...html.matchAll(/<p class="note">([\s\S]*?)<\/p>/g)]
            .filter((v) => /拝観休止/.test(v[1]))
            .map((v) => text(v[1]))
            .join(' ');
          hours = [...html.matchAll(/<p class="note">([\s\S]*?)<\/p>/g)]
            .filter((v) => /受付/.test(v[1]))
            .map((v) => text(v[1]))
            .join(' ');
        } else if (slug === 'kyoto-shunju') {
          html = match(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i);
          venue = text(classHtml(original, 'current'));
          title = text(classHtml(html, 'main_title'));
          dateText = text(field(html, '拝観期間'));
          address = text(classHtml(html, 'access_address')).replace(venue, '').trim();
          description = text(classHtml(html, 'temple_discription'));
          closures = text(field(html, '拝観休止日'));
          hours = text(field(html, '拝観時間'));
        } else {
          html =
            match(
              html,
              slug === 'kyoto-tourism-openings'
                ? /<article id="detail"[^>]*>([\s\S]*?)<\/article>/i
                : /<article class="showArticle"[^>]*>([\s\S]*?)(?=<div class="showArticle__connection|<\/article>)/i,
            ) || html;
          if (slug === 'kyoto-prefecture-openings')
            html = html.split('<h2 class="u-postTitle">近くの観光スポット</h2>')[0];
          const ld = jsonEvent(original);
          structuredYear = ld.startDate?.match(/^(20\d{2})-/)?.[1] ?? null;
          title = text(
            classHtml(
              html,
              slug === 'kyoto-tourism-openings' ? 'lead' : 'showArticle__title',
            ).replace(/<span class="ruby">[\s\S]*?<\/span\s*>/, ''),
          );
          dateText = text(field(html, '開催日程|開催日|開催期間'));
          venue =
            text(field(html, '開催場所|会場')) ||
            (slug === 'kyoto-tourism-openings' ? (ld.organizer?.name ?? '') : '');
          address = text(field(html, '住所|所在地|場所'));
          description =
            ld.description ||
            text(classHtml(html, 'showArticle__description')) ||
            text(classHtml(html, 'detailTxt'));
          hours = text(field(html, '時間|営業時間'));
          scheduleNotes = text(field(html, '備考|休日|休館日|休園日'));
          if (!dateText && ld.startDate && ld.endDate)
            dateText = `${ld.startDate.slice(0, 10).replace(/-(\d\d)-(\d\d)/, '年$1月$2日')}～${ld.endDate.slice(0, 10).replace(/-(\d\d)-(\d\d)/, '年$1月$2日')}`;
          if (!hasOpeningScope(title, description, venue)) warnings.push('unrelated-listing');
        }
        const matchingCardYears = (context.listingPages ?? []).flatMap((page) =>
          [...page.html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)]
            .filter((card) => links(card[1], page.url).includes(url))
            .flatMap((card) => {
              const heading = text(match(card[1], /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i));
              const year =
                heading.match(/(20\d{2})年?/)?.[1] ??
                text(classHtml(card[1], 'spotArticle__eventDate')).match(/(20\d{2})年/)?.[1];
              return year ? [year] : [];
            }),
        );
        const listingYear = new Set(matchingCardYears).size === 1 ? matchingCardYears[0] : null;
        const year =
          dateText.match(/(20\d{2})年/)?.[1] ??
          title.match(/(20\d{2})年?/)?.[1] ??
          structuredYear ??
          listingYear ??
          (slug === 'kyoto-kobunka' ? original.match(/\/((?:20)\d{2})_[as]_flier/)?.[1] : null);
        let periods = removeClosedDays(parseTemplePeriods(dateText, year), closures, year);
        if (
          /期間の[内うち]|祝日|毎週|土日祝|平日のみ|[月火水木金土日](?:曜日)?[・、][月火水木金土日]|曜日(?:のみ|限定)/.test(
            dateText,
          )
        ) {
          warnings.push('restricted-opening-days-require-review');
          periods = [];
        }
        if (
          !closures &&
          /休止|休館|休園|休業|除く|お休み|休日/.test(`${dateText} ${hours} ${scheduleNotes}`) &&
          !/無休|休みなし|休止なし|休館なし/.test(`${dateText} ${hours} ${scheduleNotes}`)
        ) {
          warnings.push('schedule-exceptions-require-review');
          periods = [];
        }
        if (!year) warnings.push('missing-explicit-event-year');
        const kyotoAddress =
          /京都府|京都市|(?:^|\s)(?:上京区|中京区|下京区|左京区|右京区|東山区|山科区|伏見区|西京区|南区|北区)/.test(
            address,
          );
        if (!kyotoAddress) warnings.push('unresolved-prefecture');
        const ldGeo = jsonEvent(original).location?.geo;
        const mapCoords = original.match(/(?:destination=|[?&]q=)(-?\d+\.\d+),(-?\d+\.\d+)/);
        const lat = Number(ldGeo?.latitude ?? mapCoords?.[1]) || null;
        const lng = Number(ldGeo?.longitude ?? mapCoords?.[2]) || null;
        if (!venue) warnings.push('missing-event-venue');
        if (!address) warnings.push('missing-event-address');
        // Names from publisher or unrelated footer never become venue coordinates/address.
        const imageUrls = images(html, url, slug);
        if (!imageUrls.length) warnings.push('missing-event-images');
        const category = /神社|神宮|大社/.test(venue)
          ? 'shrine'
          : /寺|院|庵/.test(venue)
            ? 'temple'
            : /庭園|庭|ガーデン/.test(venue)
              ? 'garden'
              : 'historic-site';
        const start = periods[0]?.start_date ?? null;
        const end = periods.at(-1)?.end_date ?? null;
        const generic = extractGenericEvent('', source, url);
        return {
          ...generic,
          title,
          description,
          venue_name: venue || null,
          institution_name: venue || null,
          address_text: address || null,
          directions_query: venue ? [venue, address || '京都'].join(', ') : null,
          lat,
          lng,
          categories: [
            `venue_category:${category}`,
            'event_category:special-opening',
            ...(/展覧会|企画展|特別展|寺宝展|人形展|展示/.test(`${title} ${description}`)
              ? ['event_category:exhibition']
              : []),
            'collection:temples-gardens',
          ],
          date_text: [dateText, closures && `拝観休止日: ${closures}`, hours, scheduleNotes]
            .filter(Boolean)
            .join('\n'),
          start_date: start,
          end_date: end,
          ...buildScheduleFields({ startDate: start, endDate: end }),
          schedule_segments: periods,
          is_all_day: true,
          start_time_text: hours || null,
          end_time_text: null,
          calendar_starts_at: start ? `${start}T00:00:00+09:00` : null,
          calendar_ends_at: end ? `${end}T23:59:00+09:00` : null,
          primary_image_url: imageUrls[0] ?? null,
          image_urls: imageUrls,
          source_url: url,
          extraction_confidence: warnings.length ? 0.45 : 0.9,
          _title_valid: Boolean(title),
          _title_warnings: title ? [] : ['missing-title'],
          _title_origin: 'source_specific_extractor',
          _description_valid: Boolean(description),
          _description_origin: 'source_specific_extractor',
          _description_rejections: [],
          _temple_warnings: warnings,
          _temple_relevant: !warnings.includes('unrelated-listing'),
          _source_entry_id: entryId,
          external_id:
            entryId && edition ? `kobunka-${edition}-${new URL(url).hash.slice(7)}` : undefined,
          _location_prefecture: kyotoAddress ? 'Kyoto' : null,
          _date_origin: 'source_specific_extractor',
          _date_parser: 'temple-explicit-periods',
        };
      },
    ]),
  );
  return { detailUrlExtractors, eventExtractors, listingPaginationUrls };
}
