import landingBlocklist from '../../../../data/landing-blocklist.json' with { type: 'json' };
import { aspectClassFor, transformSizeFor } from './landingImages.ts';

export type BlocksLandingCandidate = {
  id: string;
  title: string;
  institution: string;
  date: string;
  sourceSlug: string;
  images: { src: string; width: number; height: number }[];
};

export type ResolvedBlocksLandingSlide = Omit<BlocksLandingCandidate, 'images'> & {
  src: string;
  width: number;
  height: number;
};

type BlocksLandingEvent = {
  id: string;
  title: string;
  institution: string;
  date: string;
  group: 'ongoing' | 'upcoming' | 'permanent';
  sourceSlug: string | null;
  landingEligible: boolean;
  images: {
    url: string;
    width: number | null;
    height: number | null;
    landingOk?: boolean | null;
  }[];
};

const minimumCoverDensity = 1;
const maximumCoverDensity = 2;
const maximumRequiredWidth = 1920;
const maximumRequiredHeight = 1080;
const maximumTransformWidth = 2560;
const maximumTransformHeight = 1440;
const defaultLandingSlideLimit = 3;
const minimumCuratedSources = 3;
const excludedLandingSourceSlugs = new Set(['kyoto-city-kyocera-museum-of-art', 'momak']);
// Manual overrides on top of the crawler's landing check: image URLs or event ids that never
// show on the landing. Edited from /dev/landing/ in local dev.
const blockedLandingImages = new Set<string>(landingBlocklist.images);
const blockedLandingEvents = new Set<string>(landingBlocklist.events);

export const blocksLandingCandidatesForEvents = (
  events: BlocksLandingEvent[],
): BlocksLandingCandidate[] => {
  const eligibleEvents = events.filter(
    (event) =>
      event.group !== 'permanent' &&
      Boolean(event.sourceSlug) &&
      !excludedLandingSourceSlugs.has(event.sourceSlug ?? ''),
  );
  // The landing pool is the landing_slider sources; other sources only fill in when fewer than
  // three of them have events.
  const curatedEvents = eligibleEvents.filter((event) => event.landingEligible);
  const curatedSources = new Set(curatedEvents.map((event) => event.sourceSlug));
  const orderedEvents =
    curatedSources.size >= minimumCuratedSources
      ? curatedEvents
      : [...curatedEvents, ...eligibleEvents.filter((event) => !event.landingEligible)];

  return orderedEvents.flatMap((event) => {
    if (!event.sourceSlug) return [];

    if (blockedLandingEvents.has(event.id)) return [];
    // images the landing check rejected never show; approved ones go before unchecked ones
    const usableImages = event.images
      .filter((image) => image.landingOk !== false && !blockedLandingImages.has(image.url))
      .toSorted(
        (left, right) => Number(right.landingOk === true) - Number(left.landingOk === true),
      );
    const images = usableImages.flatMap((image) => {
      return typeof image.url === 'string' &&
        image.url.length > 0 &&
        Number.isFinite(image.width) &&
        Number(image.width) > 0 &&
        Number.isFinite(image.height) &&
        Number(image.height) > 0
        ? [{ src: image.url, width: Number(image.width), height: Number(image.height) }]
        : [];
    });

    return images.length > 0
      ? [
          {
            id: event.id,
            title: event.title,
            institution: event.institution,
            date: event.date,
            sourceSlug: event.sourceSlug,
            images,
          },
        ]
      : [];
  });
};

export const coverDensityFor = (
  image: Pick<BlocksLandingCandidate['images'][number], 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
) => Math.min(image.width / viewportWidth, image.height / viewportHeight);

export const resolveBlocksLandingSlides = ({
  candidates,
  viewportWidth,
  viewportHeight,
  devicePixelRatio = 1,
  limit = defaultLandingSlideLimit,
}: {
  candidates: BlocksLandingCandidate[];
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio?: number;
  limit?: number;
}): ResolvedBlocksLandingSlide[] => {
  if (viewportWidth <= 0 || viewportHeight <= 0 || limit <= 0) return [];

  const requiredWidth = Math.min(viewportWidth, maximumRequiredWidth);
  const requiredHeight = Math.min(viewportHeight, maximumRequiredHeight);
  const preferredDensity = Math.min(
    maximumCoverDensity,
    Math.max(minimumCoverDensity, devicePixelRatio),
  );
  const seenSources = new Set<string>();
  const seenIds = new Set<string>();
  const slides: ResolvedBlocksLandingSlide[] = [];

  const addCandidate = (candidate: BlocksLandingCandidate, allowRepeatedSource: boolean) => {
    if (seenIds.has(candidate.id)) return;
    if (!allowRepeatedSource && seenSources.has(candidate.sourceSlug)) return;
    const image =
      candidate.images.find(
        (item) => coverDensityFor(item, requiredWidth, requiredHeight) >= minimumCoverDensity,
      ) ??
      candidate.images.toSorted(
        (left, right) =>
          coverDensityFor(right, requiredWidth, requiredHeight) -
          coverDensityFor(left, requiredWidth, requiredHeight),
      )[0];
    if (!image) return;

    const density = Math.min(
      preferredDensity,
      coverDensityFor(image, requiredWidth, requiredHeight),
      maximumTransformWidth / requiredWidth,
      maximumTransformHeight / requiredHeight,
    );
    // snap to a shared crop ratio + size bucket so visitors hit warm CDN transforms
    const size = transformSizeFor(
      image,
      aspectClassFor(viewportWidth, viewportHeight),
      Math.floor(requiredWidth * density),
      Math.floor(requiredHeight * density),
    );
    if (!size) return;
    const { width, height } = size;
    slides.push({
      id: candidate.id,
      title: candidate.title,
      institution: candidate.institution,
      date: candidate.date,
      sourceSlug: candidate.sourceSlug,
      src: image.src,
      width,
      height,
    });
    seenSources.add(candidate.sourceSlug);
    seenIds.add(candidate.id);
  };

  for (const candidate of candidates) {
    addCandidate(candidate, false);
    if (slides.length >= limit) break;
  }
  if (slides.length < limit) {
    for (const candidate of candidates) {
      addCandidate(candidate, true);
      if (slides.length >= limit) break;
    }
  }

  return slides;
};

export type BlocksLandingHero = { id: string; src: string; width: number; height: number };

// Cover targets for the server-rendered first slide, largest first.
const heroCoverTargets = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
];

export type BlocksLandingHeroOption = BlocksLandingHero & { sourceSlug: string };

// One possible first slide per source: its first event with an image that covers a large screen.
// The page's inline script (lib/landingHero.ts) picks one of these per visit, before first paint.
export const blocksLandingHeroOptions = (
  candidates: BlocksLandingCandidate[],
): BlocksLandingHeroOption[] => {
  const options = new Map<string, BlocksLandingHeroOption>();
  for (const target of heroCoverTargets) {
    for (const candidate of candidates) {
      if (options.has(candidate.sourceSlug)) continue;
      const image = candidate.images.find(
        (item) => coverDensityFor(item, target.width, target.height) >= 1,
      );
      if (image) {
        options.set(candidate.sourceSlug, {
          id: candidate.id,
          sourceSlug: candidate.sourceSlug,
          ...image,
        });
      }
    }
  }
  return [...options.values()];
};

export const shuffled = <T>(items: T[], random: () => number = Math.random): T[] => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
};

// Unseen first (shuffled), then seen ones from the longest ago. `seen` lists event ids oldest
// first (lib/landingSeen.ts).
const freshestFirst = <T>(
  items: T[],
  idOf: (item: T) => string,
  seen: string[],
  random: () => number,
): T[] => {
  const rank = (item: T) => seen.indexOf(idOf(item));
  return [
    ...shuffled(
      items.filter((item) => rank(item) < 0),
      random,
    ),
    ...items.filter((item) => rank(item) >= 0).toSorted((a, b) => rank(a) - rank(b)),
  ];
};

// This visit's landing order: one event per source first (the visitor's unseen events and
// sources lead, in random order), then every other event, so rotation can run through the whole
// pool. `firstId` (the hero the inline script picked) goes first.
export const landingVisitOrder = (
  candidates: BlocksLandingCandidate[],
  seen: string[],
  random: () => number = Math.random,
  firstId: string | null = null,
): BlocksLandingCandidate[] => {
  const bySource = new Map<string, BlocksLandingCandidate[]>();
  for (const candidate of candidates) {
    bySource.set(candidate.sourceSlug, [...(bySource.get(candidate.sourceSlug) ?? []), candidate]);
  }
  const leads: BlocksLandingCandidate[] = [];
  const rest: BlocksLandingCandidate[] = [];
  for (const group of bySource.values()) {
    const ordered = freshestFirst(group, (candidate) => candidate.id, seen, random);
    const first = ordered.find((candidate) => candidate.id === firstId) ?? ordered[0];
    leads.push(first);
    rest.push(...ordered.filter((candidate) => candidate !== first));
  }
  const order = [
    ...freshestFirst(leads, (candidate) => candidate.id, seen, random),
    ...freshestFirst(rest, (candidate) => candidate.id, seen, random),
  ];
  const firstIndex = order.findIndex((candidate) => candidate.id === firstId);
  return firstIndex > 0
    ? [order[firstIndex], ...order.filter((_, index) => index !== firstIndex)]
    : order;
};

// Slides only become active once their image has decoded, so the landing never shows an empty
// box. The first slide is whichever image finished first; rotation skips slides still loading.
export const firstReadySlideIndex = (slideIds: string[], loadedOrder: string[]) => {
  for (const id of loadedOrder) {
    const index = slideIds.indexOf(id);
    if (index >= 0) return index;
  }
  return -1;
};

export const nextReadySlideIndex = (current: number, ready: boolean[]) => {
  for (let step = 1; step < ready.length; step += 1) {
    const index = (current + step) % ready.length;
    if (ready[index]) return index;
  }
  return current;
};
