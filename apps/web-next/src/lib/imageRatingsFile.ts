import 'server-only';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { type ImageRating, isImageRating } from './imageRanking';

// Writes Dries's manual image ratings from /dev/images/ (local dev only) to
// data/image-ratings.json as { ratings: { "<image url>": rating } }. They override the site's
// image ranking (lib/imageRanking.ts) once deployed, and the crawler sends rated images to the AI
// as examples. 0 (neutral) is not stored.
export type ImageRatings = Record<string, ImageRating>;

// data/image-ratings.json in the repo; next dev runs from apps/web-next.
const ratingsPath = () => resolve(process.cwd(), '../../data/image-ratings.json');

export const readImageRatings = async (): Promise<ImageRatings> => {
  try {
    const parsed = JSON.parse(await readFile(ratingsPath(), 'utf8'));
    return Object.fromEntries(
      Object.entries(parsed.ratings ?? {}).filter(
        (entry): entry is [string, ImageRating] => isImageRating(entry[1]) && entry[1] !== 0,
      ),
    );
  } catch {
    return {};
  }
};

// Kept in rating order, newest last: the crawler sends the latest +2/-2 ratings as examples.
export const setImageRating = async (url: string, rating: ImageRating) => {
  const ratings = await readImageRatings();
  delete ratings[url];
  if (rating !== 0) ratings[url] = rating;
  await writeFile(ratingsPath(), `${JSON.stringify({ ratings }, null, 2)}\n`);
  return ratings;
};
