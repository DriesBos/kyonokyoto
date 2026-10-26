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
  images: { url: string; width: number | null; height: number | null }[];
};

const minimumCoverDensity = 1;
const maximumCoverDensity = 2;
const maximumRequiredWidth = 1920;
const maximumRequiredHeight = 1080;
const maximumTransformWidth = 2560;
const maximumTransformHeight = 1440;
const defaultLandingSlideLimit = 3;
const excludedLandingSourceSlugs = new Set(['kyoto-city-kyocera-museum-of-art', 'momak']);

export const blocksLandingCandidatesForEvents = (
  events: BlocksLandingEvent[],
): BlocksLandingCandidate[] => {
  const eligibleEvents = events.filter(
    (event) =>
      event.group !== 'permanent' &&
      Boolean(event.sourceSlug) &&
      !excludedLandingSourceSlugs.has(event.sourceSlug ?? ''),
  );
  const orderedEvents = [
    ...eligibleEvents.filter((event) => event.landingEligible),
    ...eligibleEvents.filter((event) => !event.landingEligible),
  ];

  return orderedEvents.flatMap((event) => {
    if (!event.sourceSlug) return [];

    const images = event.images.flatMap((image) => {
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

// Moves the first candidate with an image that covers a large screen to the front (with that
// image first), so the server can render it as the first slide before the client measures.
export const blocksLandingCandidatesWithHero = (
  candidates: BlocksLandingCandidate[],
): { candidates: BlocksLandingCandidate[]; hero: BlocksLandingHero | null } => {
  for (const target of heroCoverTargets) {
    for (const [index, candidate] of candidates.entries()) {
      const image = candidate.images.find(
        (item) => coverDensityFor(item, target.width, target.height) >= 1,
      );
      if (!image) continue;
      return {
        candidates: [
          { ...candidate, images: [image, ...candidate.images.filter((item) => item !== image)] },
          ...candidates.filter((_, other) => other !== index),
        ],
        hero: { id: candidate.id, ...image },
      };
    }
  }
  return { candidates, hero: null };
};
