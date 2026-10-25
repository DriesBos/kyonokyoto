import type { LandingSlideImage } from './landingSlides';

export type LandingImageSize = {
  width: number;
  height: number;
};

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

export const maximumTransformWidth = 2560;
export const maximumTransformHeight = 1440;
export const imageQuality = 82;

const ratioValue = ([width, height]: [number, number]) => width / height;

export const coverDensityFor = (
  image: Pick<LandingSlideImage, 'width' | 'height'>,
  viewportWidth: number,
  viewportHeight: number,
) => Math.min(image.width / viewportWidth, image.height / viewportHeight);

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
  image: Pick<LandingSlideImage, 'width' | 'height'>,
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
  image: Pick<LandingSlideImage, 'width' | 'height'>,
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

export const landingImageUrl = (src: string, { width, height }: LandingImageSize) => {
  try {
    if (!src.startsWith('/') && new URL(src).protocol !== 'https:') return null;
  } catch {
    return null;
  }

  if (import.meta.env?.DEV) return src;

  const params = new URLSearchParams({
    url: src,
    w: String(width),
    h: String(height),
    fit: 'cover',
    position: 'center',
    q: String(imageQuality),
  });
  return `/.netlify/images?${params}`;
};

const ratioQuery = ([width, height]: [number, number]) => `${width}/${height}`;

// Server-rendered first slide: one source per crop class, with sizes matching
// object-fit: cover so the browser picks the same buckets the slider script uses.
export const landingPictureSourcesFor = (image: LandingSlideImage) =>
  landingAspectClasses.flatMap((aspectClass) => {
    const candidates = transformCandidatesFor(image, aspectClass);
    const srcset = candidates
      .flatMap((size) => {
        const url = landingImageUrl(image.src, size);
        return url ? [`${url} ${size.width}w`] : [];
      })
      .join(', ');
    if (!srcset) return [];

    const [ratioWidth, ratioHeight] = aspectClass.ratio;
    return [
      {
        media: aspectClass.maxViewportRatio
          ? `(max-aspect-ratio: ${ratioQuery(aspectClass.maxViewportRatio)})`
          : undefined,
        srcset,
        sizes: `(min-aspect-ratio: ${ratioQuery(aspectClass.ratio)}) 100vw, calc(100vh * ${ratioWidth} / ${ratioHeight})`,
        fallbackSrc: landingImageUrl(image.src, candidates[candidates.length - 1]),
      },
    ];
  });
