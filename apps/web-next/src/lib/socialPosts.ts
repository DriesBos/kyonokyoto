import type { CityEvent } from './cityEvents';

// Instagram auto poster, step 1: which events to propose. The Socials tab (/dev/socials/) lists
// the best-scoring events of a city, rendered as the post (packages/shared/social-post.mjs);
// Dries ticks the ones to post, which stores them in Supabase (social_posts). The VPS publisher
// (apps/crawler/src/social-publish.mjs) then posts one approved post a day.
// See docs/instagram-autopost.md.

// Local dev and preview (branch-deploy / deploy-preview) builds only, like beta events.
export const SOCIALS_ENABLED =
  process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_BETA_QA === '1';

// Points per reason. Image quality: the crawler's AI score (1-10) scaled to 0-4, +1 when the AI
// found it clean (no flyer text), and Dries's /dev/images rating (-2..+2) on top.
export const SOCIAL_POINTS = {
  startsThisWeek: 3,
  endsThisWeek: 3,
  imageScoreMax: 4,
  imageClean: 1,
  imageRatingStep: 1,
  // narrower than this (px, when known) looks soft on a 1080 px post
  smallImageWidth: 800,
  smallImage: -2,
};

export type SocialEventInput = Pick<
  CityEvent,
  | 'id'
  | 'group'
  | 'beta'
  | 'title'
  | 'institution'
  | 'venue'
  | 'date'
  | 'calendarStartsAt'
  | 'calendarEndsAt'
  | 'endsSoon'
  | 'startsSoon'
  | 'images'
  | 'eventKind'
> &
  Partial<Pick<CityEvent, 'filterTags' | 'venueInstagram'>>;

export type SocialCandidate = {
  event: SocialEventInput;
  score: number;
  reasons: string[];
  imageUrl: string;
  imageWidth: number | null;
  imageHeight: number | null;
  startDate: string | null;
  endDate: string | null;
};

const addDays = (dateOnly: string, days: number) => {
  const date = new Date(`${dateOnly}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const dateOnly = (value: string | null | undefined) =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

// "This week" = today and the six days after it, in the city's time zone (today is passed in).
export function scoreSocialEvent(event: SocialEventInput, today: string): SocialCandidate | null {
  if (event.beta || event.group === 'permanent' || event.eventKind === 'festival_program') {
    return null;
  }
  // only venues we can tag (source config "instagram"), so they see the post
  if (!instagramHandle(event.venueInstagram)) return null;
  const image = event.images[0];
  if (!image || image.rating === -2) return null;

  const weekEnd = addDays(today, 6);
  const start = dateOnly(event.calendarStartsAt);
  const startsThisWeek = Boolean(start && start >= today && start <= weekEnd);

  const reasons: string[] = [];
  let score = 0;
  if (startsThisWeek) {
    score += SOCIAL_POINTS.startsThisWeek;
    reasons.push(`starts this week +${SOCIAL_POINTS.startsThisWeek}`);
  }
  if (event.endsSoon) {
    score += SOCIAL_POINTS.endsThisWeek;
    reasons.push(`ends this week +${SOCIAL_POINTS.endsThisWeek}`);
  }
  if (typeof image.score === 'number') {
    const points = Math.round((image.score / 10) * SOCIAL_POINTS.imageScoreMax * 10) / 10;
    score += points;
    reasons.push(`image ${image.score}/10 +${points}`);
  }
  if (image.landingOk === true) {
    score += SOCIAL_POINTS.imageClean;
    reasons.push(`clean image +${SOCIAL_POINTS.imageClean}`);
  }
  if (image.rating) {
    const points = image.rating * SOCIAL_POINTS.imageRatingStep;
    score += points;
    reasons.push(`your rating ${points > 0 ? '+' : ''}${points}`);
  }
  if (image.width && image.width < SOCIAL_POINTS.smallImageWidth) {
    score += SOCIAL_POINTS.smallImage;
    reasons.push(`small image (${image.width}px) ${SOCIAL_POINTS.smallImage}`);
  }

  return {
    event,
    score: Math.round(score * 10) / 10,
    reasons,
    imageUrl: image.url,
    imageWidth: image.width ?? null,
    imageHeight: image.height ?? null,
    startDate: start,
    endDate: dateOnly(event.calendarEndsAt),
  };
}

export const rankSocialCandidates = (events: SocialEventInput[], today: string) =>
  events
    .map((event) => scoreSocialEvent(event, today))
    .filter((candidate): candidate is SocialCandidate => candidate !== null)
    .sort((left, right) => right.score - left.score);

// "Kyoto City KYOCERA Museum of Art" → "kyotocitykyoceramuseumofart" (letters and digits only,
// accents dropped); null when nothing usable is left (e.g. a Japanese-only name).
export const hashtagFor = (value: string | null | undefined) => {
  const tag = String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return tag ? `#${tag}` : null;
};

// Filter tags (data/categories.mjs filterTagsFor): type:art → #art, sub:art:painting → #painting.
export const categoryHashtags = (filterTags: string[] = []) => {
  const types = filterTags.filter((tag) => tag.startsWith('type:')).map((tag) => tag.slice(5));
  const subs = filterTags
    .filter((tag) => tag.startsWith('sub:'))
    .map((tag) => tag.split(':').at(-1) ?? '');
  return [...types, ...subs].map(hashtagFor).filter((tag): tag is string => Boolean(tag));
};

export const instagramHandle = (value: string | null | undefined) => {
  const handle = String(value ?? '')
    .trim()
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^@/, '')
    .replace(/\/.*$/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? `@${handle}` : null;
};

// Same content as the event card: title, dates, venue (@instagram when the source config has
// one), then #category #subcategories #venue.
// Status lead line instead of a badge on the image (Dries, 2026-11-11): the site's "Opening soon" /
// "Last week" pills.
export const socialStatusLine = (event: Pick<SocialEventInput, 'endsSoon' | 'startsSoon'>) =>
  event.endsSoon ? 'Last week:' : event.startsSoon ? 'Opening soon:' : null;

export function socialCaption(event: SocialEventInput) {
  const venue = event.institution || event.venue || '';
  const tags = [
    ...new Set([...categoryHashtags(event.filterTags), hashtagFor(venue)].filter(Boolean)),
  ];
  const status = socialStatusLine(event);
  return [
    ...(status ? [status] : []),
    `"${event.title}"`,
    event.date,
    instagramHandle(event.venueInstagram) ?? venue,
    '',
    tags.join(' '),
  ]
    .join('\n')
    .trim();
}
