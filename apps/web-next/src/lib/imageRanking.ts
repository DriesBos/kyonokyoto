import imageRatingsFile from '../../../../data/image-ratings.json' with { type: 'json' };

// Ranks an event's images using the tags the crawler's image check stores (clean, subject,
// busyness, 1-10 score) and Dries's manual ratings (data/image-ratings.json, set at /dev/images/).
// Tune taste here: changing a weight re-ranks every event on the next render and never needs new
// image checks. Untagged, unrated images score 0, and ties keep source order. The crawler also
// sends rated images to the AI as examples, so ratings improve future tags too.

export type ImageSubject =
  | 'artwork'
  | 'illustration'
  | 'installation'
  | 'interior'
  | 'exterior'
  | 'event'
  | 'people'
  | 'graphic';
export type ImageBusyness = 'calm' | 'medium' | 'busy';
export type ImageConfidence = 'high' | 'medium' | 'low';

// Manual rating: 2 = preferred (front), 1 = keep, 0 = neutral, -1 = not preferred but keep,
// -2 = leave out (never shown on cards or the landing).
export type ImageRating = -2 | -1 | 0 | 1 | 2;
export const IMAGE_RATINGS: ImageRating[] = [-2, -1, 0, 1, 2];

export const isImageRating = (value: unknown): value is ImageRating =>
  IMAGE_RATINGS.includes(value as ImageRating);

const storedRatings: Record<string, unknown> = imageRatingsFile.ratings ?? {};

export const imageRatingFor = (url: string): ImageRating => {
  const rating = storedRatings[url];
  return isImageRating(rating) ? rating : 0;
};

export type RankableImage = {
  rating?: ImageRating | null;
  landingOk?: boolean | null;
  subject?: ImageSubject | null;
  busyness?: ImageBusyness | null;
  score?: number | null;
};

export const IMAGE_RANK_WEIGHTS = {
  // flyers, posters and images with overlaid text or logos go last
  notClean: -10,
  subject: {
    artwork: 3,
    illustration: 2,
    installation: 2,
    event: 1,
    interior: 0,
    exterior: 0,
    people: -1,
    graphic: -5,
  } satisfies Record<ImageSubject, number>,
  busyness: { calm: 2, medium: 0, busy: -2 } satisfies Record<ImageBusyness, number>,
  // the 1-10 quality score adds 0 (score 1) up to this bonus (score 10)
  maxScoreBonus: 3,
  // manual ratings outweigh the AI tags; -2 images are dropped (isLeftOut) before ranking
  rating: { 2: 100, 1: 6, 0: 0, '-1': -6, '-2': -100 } satisfies Record<ImageRating, number>,
};

export const isLeftOut = (image: RankableImage) => image.rating === -2;

export const imageRank = (image: RankableImage, weights = IMAGE_RANK_WEIGHTS) => {
  let rank = 0;
  if (image.rating) rank += weights.rating[image.rating] ?? 0;
  if (image.landingOk === false) rank += weights.notClean;
  if (image.subject) rank += weights.subject[image.subject] ?? 0;
  if (image.busyness) rank += weights.busyness[image.busyness] ?? 0;
  if (typeof image.score === 'number' && Number.isFinite(image.score)) {
    const score = Math.min(10, Math.max(1, image.score));
    rank += ((score - 1) / 9) * weights.maxScoreBonus;
  }
  return rank;
};

// The AI-only rank (tags, no manual rating): what the AI would pick on its own.
export const aiImageRank = (image: RankableImage, weights = IMAGE_RANK_WEIGHTS) =>
  imageRank({ ...image, rating: 0 }, weights);

// Best image first; a stable sort, so equal ranks (e.g. all untagged) keep the source's order.
export const rankImages = <T extends RankableImage>(images: T[], weights = IMAGE_RANK_WEIGHTS) =>
  images
    .map((image, index) => ({ image, index, rank: imageRank(image, weights) }))
    .sort((left, right) => right.rank - left.rank || left.index - right.index)
    .map(({ image }) => image);
