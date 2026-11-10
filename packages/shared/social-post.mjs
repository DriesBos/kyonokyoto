// Instagram post renderer (1080 x 1350, 4:5), after Dries's Figma frames 646:2451 (inset) and
// 646:2458 (flush): an event-card box with the photo at its own aspect ratio, then the meta
// (venue + date, uppercase) and the title. The box is as tall as its content and sits at the top. The photo is never cropped.
//
// Pure functions, no dependencies: the Socials tab (browser preview) and the VPS publisher
// (apps/crawler/src/social-publish.mjs, rendered with sharp) build the same SVG from them.
// Text is drawn as glyph paths measured with fontkit (measureSocialText takes the opened font),
// so no font has to be installed where the SVG is rendered.

export const SOCIAL_SIZE = { width: 1080, height: 1350 };

// Measured from the Figma frames (px on the 1080 canvas).
export const SOCIAL_STYLE = {
  depth: 96, // box depth, right and bottom faces
  stroke: 6,
  pad: 32, // inside the front, around the photo and text
  metaSize: 49,
  metaLine: 69,
  titleSize: 70,
  titleLine: 89,
  photoToMetaBaseline: 95, // photo bottom → first meta baseline
  photoToTitleBaseline: 110, // photo bottom → first title baseline (no meta)
  metaToTitleBaseline: 150, // last meta baseline → first title baseline
  baselineToBottom: 64, // last baseline → inside of the front's bottom line
  metaMaxLines: 3,
  titleMaxLines: 3,
  sideShade: 0.08, // right face: city colour mixed into the background (as the event cards)
  bottomShade: 0.14,
  // photo height / width: wider than 2:1 or taller than 5:4 is not proposed
  minRatio: 0.5,
  maxRatio: 1.25,
};

// City type colours (apps/web-next/src/lib/cities.ts themeColor; a web test keeps them in sync)
// on the shared light background.
export const SOCIAL_CITY_COLORS = {
  kyoto: '#138e00',
  osaka: '#7d4cff',
  tokyo: '#006fd6',
  'hong-kong': '#8c6500',
};
export const SOCIAL_BACKGROUND = '#efefef';

export const SOCIAL_LAYOUTS = {
  inset: { margin: 48 }, // the box floats inside the post
  flush: { margin: 0 }, // the box touches the post's left and right edges
};

export const isSocialLayout = (value) => Object.hasOwn(SOCIAL_LAYOUTS, value);

export function socialGeometry(layout = 'inset', style = SOCIAL_STYLE) {
  const { margin } = SOCIAL_LAYOUTS[layout] ?? SOCIAL_LAYOUTS.inset;
  const frontWidth = SOCIAL_SIZE.width - 2 * margin - style.depth;
  return {
    left: margin,
    frontWidth,
    contentLeft: margin + style.stroke + style.pad,
    contentWidth: frontWidth - 2 * style.stroke - 2 * style.pad,
    maxFrontHeight: SOCIAL_SIZE.height - 2 * margin - style.depth,
  };
}

// Which text fits under the photo: meta + title, else title only, else meta only.
// meta / title: { lines: number } or null when that text can't be drawn (e.g. Japanese glyphs).
/**
 * @typedef {{ x: number, y: number, width: number, height: number }} SocialRect
 * @typedef {{ ok: true, layout: string, showMeta: boolean, showTitle: boolean, front: SocialRect,
 *   photo: SocialRect, metaBaselines: number[], titleBaselines: number[] }} SocialLayoutFit
 * @typedef {{ ok: false, reason: string }} SocialLayoutMiss
 * @returns {SocialLayoutFit | SocialLayoutMiss}
 */
export function layoutSocialPost({ layout = 'inset', imageWidth, imageHeight, meta, title }) {
  const style = SOCIAL_STYLE;
  const geometry = socialGeometry(layout, style);
  if (!(imageWidth > 0 && imageHeight > 0)) return { ok: false, reason: 'image size unknown' };
  const ratio = imageHeight / imageWidth;
  if (ratio < style.minRatio) return { ok: false, reason: 'image too wide' };
  if (ratio > style.maxRatio) return { ok: false, reason: 'image too tall' };

  const photoHeight = Math.round(geometry.contentWidth * ratio);
  const options = [meta && title && { meta, title }, title && { title }, meta && { meta }].filter(
    Boolean,
  );

  for (const show of options) {
    const baselines = { meta: [], title: [] };
    let y = 0;
    if (show.meta) {
      y += style.photoToMetaBaseline;
      for (let line = 0; line < show.meta.lines; line += 1) {
        if (line) y += style.metaLine;
        baselines.meta.push(y);
      }
    }
    if (show.title) {
      y += show.meta ? style.metaToTitleBaseline : style.photoToTitleBaseline;
      for (let line = 0; line < show.title.lines; line += 1) {
        if (line) y += style.titleLine;
        baselines.title.push(y);
      }
    }
    const frontHeight = 2 * style.stroke + style.pad + photoHeight + y + style.baselineToBottom;
    if (frontHeight > geometry.maxFrontHeight) continue;

    // top-aligned, like the event list rows on the site
    const top = geometry.left;
    const photoTop = top + style.stroke + style.pad;
    const textTop = photoTop + photoHeight;
    return {
      ok: true,
      layout,
      showMeta: Boolean(show.meta),
      showTitle: Boolean(show.title),
      front: { x: geometry.left, y: top, width: geometry.frontWidth, height: frontHeight },
      photo: {
        x: geometry.contentLeft,
        y: photoTop,
        width: geometry.contentWidth,
        height: photoHeight,
      },
      metaBaselines: baselines.meta.map((offset) => textTop + offset),
      titleBaselines: baselines.title.map((offset) => textTop + offset),
    };
  }
  return { ok: false, reason: 'image too tall to fit any text' };
}

const hexToRgb = (hex) => {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? [...value].map((digit) => digit + digit).join('') : value;
  return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16));
};

// color-mix(in srgb, background, color share)
export const mixColor = (background, color, share) => {
  const [br, bg, bb] = hexToRgb(background);
  const [cr, cg, cb] = hexToRgb(color);
  const mix = (b, c) => Math.round(b + (c - b) * share);
  return `rgb(${mix(br, cr)} ${mix(bg, cg)} ${mix(bb, cb)})`;
};

const escapeAttribute = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// metaPaths / titlePaths: one SVG path string per line, drawn from (0, 0) on the baseline
// (measureSocialText). imageHref: URL or data: URI of the photo.
/**
 * @param {SocialLayoutFit} layoutResult
 * @param {{ color: string, background?: string, imageHref: string, metaPaths?: string[], titlePaths?: string[], badge?: { path: string, width: number } | null }} options
 */
export function socialPostSvg(
  layoutResult,
  {
    color,
    background = SOCIAL_BACKGROUND,
    imageHref,
    metaPaths = [],
    titlePaths = [],
    badge = null,
  },
) {
  const { depth: d, stroke: s } = SOCIAL_STYLE;
  const { width: W, height: H } = SOCIAL_SIZE;
  const { front, photo } = layoutResult;
  // Every line is drawn on its centre line, s wide: the faces share the front's right and bottom
  // centre lines (the front is drawn over them), so all box lines end up the same width.
  const left = front.x + s / 2;
  const top = front.y + s / 2;
  const right = front.x + front.width - s / 2;
  const bottom = front.y + front.height - s / 2;
  // the outer lines stay inside the canvas (the flush layout touches its edges)
  const outerRight = Math.min(right + d, W - s / 2);
  const outerBottom = Math.min(bottom + d, H - s / 2);
  const face = (points, fill) =>
    `<polygon points="${points.map((point) => point.join(',')).join(' ')}" fill="${fill}" stroke="${color}" stroke-width="${s}" stroke-linejoin="miter"/>`;
  const text = (paths, baselines) =>
    paths
      .map((d, index) =>
        baselines[index] === undefined
          ? ''
          : `<path d="${d}" fill="${color}" transform="translate(${photo.x} ${baselines[index]})"/>`,
      )
      .join('');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="${background}"/>`,
    face(
      [
        [right, top],
        [outerRight, top + (outerRight - right)],
        [outerRight, outerBottom],
        [right, bottom],
      ],
      mixColor(background, color, SOCIAL_STYLE.sideShade),
    ),
    face(
      [
        [left, bottom],
        [right, bottom],
        [outerRight, outerBottom],
        [left + (outerBottom - bottom), outerBottom],
      ],
      mixColor(background, color, SOCIAL_STYLE.bottomShade),
    ),
    `<rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="${background}" stroke="${color}" stroke-width="${s}"/>`,
    `<image x="${photo.x}" y="${photo.y}" width="${photo.width}" height="${photo.height}" preserveAspectRatio="xMidYMid meet" href="${escapeAttribute(imageHref)}" xlink:href="${escapeAttribute(imageHref)}"/>`,
    layoutResult.showMeta ? text(metaPaths, layoutResult.metaBaselines) : '',
    layoutResult.showTitle ? text(titlePaths, layoutResult.titleBaselines) : '',
    badge ? badgeSvg(badge, photo, color, background) : '',
    '</svg>',
  ].join('');
}

// "LAST WEEK" pill, as the site's event cards (LastWeekBadge): filled oval in the city colour with
// background-coloured uppercase meta text, at the photo's top-right.
export const SOCIAL_BADGE = {
  label: 'LAST WEEK!',
  inset: 24, // from the photo's top and right edges
  padTop: 12, // 0.25em
  padBottom: 15, // 0.3em
  padX: 34, // 0.7em
};

// Ongoing (started) and ending within today + 6 days, like CityEvent.endsSoon. Dates YYYY-MM-DD.
export function isLastWeek({ startDate, endDate, today }) {
  if (!endDate || endDate < today) return false;
  if (startDate && startDate > today) return false;
  const weekEnd = new Date(`${today}T00:00:00Z`);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  return endDate <= weekEnd.toISOString().slice(0, 10);
}

// The badge label as a glyph path (baseline at 0) plus its advance width.
export function measureSocialBadge(font, label = SOCIAL_BADGE.label) {
  const size = SOCIAL_STYLE.metaSize;
  const width = Math.round(lineWidth(font, label, size) * 10) / 10;
  return { path: linePath(font, label, size), width };
}

function badgeSvg(badge, photo, color, background) {
  const size = SOCIAL_STYLE.metaSize;
  const { inset, padTop, padBottom, padX } = SOCIAL_BADGE;
  const height = size + padTop + padBottom;
  const width = badge.width + 2 * padX;
  const x = photo.x + photo.width - inset - width;
  const y = photo.y + inset;
  // line-height 1: the baseline sits where GT Walsheim's ascent puts it inside a 1em box
  const baseline = y + padTop + Math.round(size * 0.828);
  return [
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="${color}"/>`,
    `<path d="${badge.path}" fill="${background}" transform="translate(${x + padX} ${baseline})"/>`,
  ].join('');
}

const round = (svgPath) =>
  svgPath.replace(/-?\d+\.\d+/g, (number) => String(Math.round(number * 10) / 10));

const lineWidth = (font, text, size) => (font.layout(text).advanceWidth * size) / font.unitsPerEm;

const linePath = (font, text, size) => {
  const run = font.layout(text);
  const scale = size / font.unitsPerEm;
  let x = 0;
  const parts = run.glyphs.map((glyph, index) => {
    const position = run.positions[index];
    const path = glyph.path
      .scale(scale, -scale)
      .translate(x + position.xOffset * scale, -position.yOffset * scale)
      .toSVG();
    x += position.xAdvance * scale;
    return path;
  });
  return round(parts.join(''));
};

// Greedy word wrap with fontkit metrics. Returns { lines: [...], paths: [...] }, or null when a
// character has no glyph in the font (GT Walsheim has no Japanese) or a word is wider than a line.
// Lines past maxLines end in an ellipsis.
export function measureSocialText(font, text, { size, maxWidth, maxLines }) {
  const clean = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return null;
  for (const character of clean) {
    if (character !== ' ' && !font.hasGlyphForCodePoint(character.codePointAt(0))) return null;
  }
  const lines = [];
  for (const word of clean.split(' ')) {
    if (lineWidth(font, word, size) > maxWidth) return null;
    const current = lines.at(-1);
    if (current !== undefined && lineWidth(font, `${current} ${word}`, size) <= maxWidth) {
      lines[lines.length - 1] = `${current} ${word}`;
    } else {
      lines.push(word);
    }
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.includes(' ') && lineWidth(font, `${last}…`, size) > maxWidth) {
      last = last.slice(0, last.lastIndexOf(' '));
    }
    lines[maxLines - 1] = `${last.replace(/[\s,.:;–—-]+$/, '')}…`;
  }
  return { lines, paths: lines.map((line) => linePath(font, line, size)) };
}

// Meta (venue line + date line, uppercase, each may wrap) and title, measured for one layout.
export function measureSocialPostText(font, { venue, date, title }, layout = 'inset') {
  const { contentWidth } = socialGeometry(layout);
  const style = SOCIAL_STYLE;
  const metaParts = [venue, date].filter(Boolean).map((part) =>
    measureSocialText(font, String(part).toUpperCase(), {
      size: style.metaSize,
      maxWidth: contentWidth,
      maxLines: style.metaMaxLines,
    }),
  );
  const metaPaths = metaParts.every(Boolean) ? metaParts.flatMap((part) => part.paths) : [];
  const titleText = measureSocialText(font, title, {
    size: style.titleSize,
    maxWidth: contentWidth,
    maxLines: style.titleMaxLines,
  });
  return {
    meta:
      metaPaths.length && metaPaths.length <= style.metaMaxLines + 1
        ? { lines: metaPaths.length }
        : null,
    metaPaths,
    title: titleText ? { lines: titleText.lines.length } : null,
    titlePaths: titleText?.paths ?? [],
  };
}
