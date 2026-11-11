import landingBlocklist from '../../../../data/landing-blocklist.json' with { type: 'json' };
import { landingFileFor, type LandingFiles } from './landingImages.ts';

export type BlocksLandingCandidate = {
  id: string;
  title: string;
  institution: string;
  date: string;
  sourceSlug: string;
  // the event's two landing files (lib/landingImages.ts)
  files: LandingFiles;
};

export type ResolvedBlocksLandingSlide = Omit<BlocksLandingCandidate, 'files'> & {
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
    landingOk?: boolean | null;
    rating?: number | null;
    landingDesktop?: string | null;
    landingMobile?: string | null;
  }[];
};

const defaultLandingSlideLimit = 3;
// Each city's landing uses at most this many events (one image each), so the image CDN only ever
// holds 2 files per event and stays warm (docs/supabase-free-plan.md).
export const maximumLandingEvents = 12;
const excludedLandingSourceSlugs = new Set(['kyoto-city-kyocera-museum-of-art', 'momak']);
// Manual overrides on top of the crawler's landing check: image URLs or event ids that never
// show on the landing. Edited from /dev/landing/ in local dev.
const blockedLandingImages = new Set<string>(landingBlocklist.images);
const blockedLandingEvents = new Set<string>(landingBlocklist.events);

// One event per source first, then the rest, in their original order.
const spreadBySource = <T extends { sourceSlug: string }>(items: T[]): T[] => {
  const bySource = new Map<string, T[]>();
  for (const item of items) {
    bySource.set(item.sourceSlug, [...(bySource.get(item.sourceSlug) ?? []), item]);
  }
  const groups = [...bySource.values()];
  const result: T[] = [];
  for (let round = 0; result.length < items.length; round += 1) {
    for (const group of groups) if (group[round]) result.push(group[round]);
  }
  return result;
};

// The landing pool: landing_slider events whose landing image has its two files, spread over
// sources, at most maximumLandingEvents.
export const blocksLandingCandidatesForEvents = (
  events: BlocksLandingEvent[],
): BlocksLandingCandidate[] => {
  const candidates = events.flatMap((event): BlocksLandingCandidate[] => {
    if (
      event.group === 'permanent' ||
      !event.landingEligible ||
      !event.sourceSlug ||
      excludedLandingSourceSlugs.has(event.sourceSlug) ||
      blockedLandingEvents.has(event.id)
    ) {
      return [];
    }
    // images the AI check rejected or Dries rated -2 never show
    const image = event.images.find(
      (item) =>
        item.landingDesktop &&
        item.landingMobile &&
        item.landingOk !== false &&
        item.rating !== -2 &&
        !blockedLandingImages.has(item.url),
    );
    if (!image?.landingDesktop || !image.landingMobile) return [];
    return [
      {
        id: event.id,
        title: event.title,
        institution: event.institution,
        date: event.date,
        sourceSlug: event.sourceSlug,
        files: { desktop: image.landingDesktop, mobile: image.landingMobile },
      },
    ];
  });
  return spreadBySource(candidates).slice(0, maximumLandingEvents);
};

export const resolveBlocksLandingSlides = ({
  candidates,
  viewportWidth,
  viewportHeight,
  limit = defaultLandingSlideLimit,
}: {
  candidates: BlocksLandingCandidate[];
  viewportWidth: number;
  viewportHeight: number;
  limit?: number;
}): ResolvedBlocksLandingSlide[] => {
  if (viewportWidth <= 0 || viewportHeight <= 0 || limit <= 0) return [];
  return spreadBySource(candidates)
    .slice(0, limit)
    .map(({ files, ...candidate }) => ({
      ...candidate,
      ...landingFileFor(files, viewportWidth, viewportHeight),
    }));
};

export type BlocksLandingHeroOption = { id: string; sourceSlug: string; files: LandingFiles };

// One possible first slide per source: its first landing event. The page's inline script
// (lib/landingHero.ts) picks one of these per visit, before first paint.
export const blocksLandingHeroOptions = (
  candidates: BlocksLandingCandidate[],
): BlocksLandingHeroOption[] => {
  const options = new Map<string, BlocksLandingHeroOption>();
  for (const candidate of candidates) {
    if (!options.has(candidate.sourceSlug)) {
      options.set(candidate.sourceSlug, {
        id: candidate.id,
        sourceSlug: candidate.sourceSlug,
        files: candidate.files,
      });
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
