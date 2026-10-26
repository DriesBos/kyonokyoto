import { safeEventImageSource } from './mediaDelivery.ts';

// Ported from apps/web src/lib/landingImages.ts.
export type LandingImageSize = { width: number; height: number };

export type LandingAspectClass = {
  ratio: [number, number];
  // Viewports up to this aspect ratio use the class; the last class has no upper bound.
  maxViewportRatio?: [number, number];
};

// Transforms snap to a few crop ratios and long-side buckets so visitors share
// Netlify Image CDN cache entries instead of each viewport creating a cold transform.
export const landingAspectClasses: LandingAspectClass[] = [
  { ratio: [1, 2], maxViewportRatio: [11, 18] },
  { ratio: [3, 4], maxViewportRatio: [1, 1] },
  { ratio: [4, 3], maxViewportRatio: [20, 13] },
  { ratio: [16, 9] },
];
export const landingLongSideBuckets = [960, 1280, 1440, 1600, 1920, 2560];

const maximumTransformWidth = 2560;
const maximumTransformHeight = 1440;
const imageQuality = 82;

const ratioValue = ([width, height]: [number, number]) => width / height;

export const aspectClassFor = (viewportWidth: number, viewportHeight: number) => {
  const viewportRatio = viewportWidth / viewportHeight;
  return (
    landingAspectClasses.find(
      (aspectClass) =>
        aspectClass.maxViewportRatio && viewportRatio <= ratioValue(aspectClass.maxViewportRatio),
    ) ?? landingAspectClasses[landingAspectClasses.length - 1]
  );
};

const sizeForLongSide = (aspectClass: LandingAspectClass, longSide: number): LandingImageSize => {
  const ratio = ratioValue(aspectClass.ratio);
  return ratio >= 1
    ? { width: longSide, height: Math.floor(longSide / ratio) }
    : { width: Math.floor(longSide * ratio), height: longSide };
};

export const transformCandidatesFor = (
  image: LandingImageSize,
  aspectClass: LandingAspectClass,
): LandingImageSize[] => {
  const ratio = ratioValue(aspectClass.ratio);
  const cropWidth = Math.min(image.width, image.height * ratio);
  const cropLongSide = Math.floor(ratio >= 1 ? cropWidth : cropWidth / ratio);
  const longSides = [
    ...new Set(landingLongSideBuckets.map((bucket) => Math.min(bucket, cropLongSide))),
  ];

  return longSides
    .map((longSide) => sizeForLongSide(aspectClass, longSide))
    .filter(
      (size) =>
        size.width > 0 &&
        size.height > 0 &&
        size.width <= maximumTransformWidth &&
        size.height <= maximumTransformHeight,
    );
};

export const transformSizeFor = (
  image: LandingImageSize,
  aspectClass: LandingAspectClass,
  minimumWidth: number,
  minimumHeight: number,
) => {
  const candidates = transformCandidatesFor(image, aspectClass);
  return (
    candidates.find((size) => size.width >= minimumWidth && size.height >= minimumHeight) ??
    candidates[candidates.length - 1] ??
    null
  );
};

const netlifyLandingUrl = (source: string, { width, height }: LandingImageSize) =>
  `/.netlify/images?${new URLSearchParams({
    url: source,
    w: String(width),
    h: String(height),
    fit: 'cover',
    position: 'center',
    q: String(imageQuality),
  })}`;

const ratioQuery = ([width, height]: [number, number]) => `${width}/${height}`;

// Server-rendered first slide: one <source> per crop class, with sizes matching
// object-fit: cover so the browser picks the same buckets the client resolver uses.
// Without the image CDN (dev) there is nothing to choose between, so no sources.
export const landingPictureSourcesFor = (
  image: { src: string } & LandingImageSize,
  useNetlifyImageCdn: boolean,
) => {
  const source = safeEventImageSource(image.src);
  if (!source || !useNetlifyImageCdn) return [];

  return landingAspectClasses.flatMap((aspectClass) => {
    const candidates = transformCandidatesFor(image, aspectClass);
    if (candidates.length === 0) return [];
    const [ratioWidth, ratioHeight] = aspectClass.ratio;
    return [
      {
        media: aspectClass.maxViewportRatio
          ? `(max-aspect-ratio: ${ratioQuery(aspectClass.maxViewportRatio)})`
          : undefined,
        srcSet: candidates
          .map((size) => `${netlifyLandingUrl(source, size)} ${size.width}w`)
          .join(', '),
        sizes: `(min-aspect-ratio: ${ratioQuery(aspectClass.ratio)}) 100vw, calc(100vh * ${ratioWidth} / ${ratioHeight})`,
      },
    ];
  });
};
