import { DEV_PAGE_ENABLED } from '@/lib/devPage';
import { isImageRating } from '@/lib/imageRanking';
import { setImageRating } from '@/lib/imageRatingsFile';

// Local dev only (/dev/images/): writes data/image-ratings.json. Production builds answer 404.
export async function POST(request: Request) {
  if (!DEV_PAGE_ENABLED) return new Response('Not found', { status: 404 });
  const body = await request.json().catch(() => null);
  if (typeof body?.url !== 'string' || !isImageRating(body?.rating)) {
    return Response.json({ error: 'Expected { url, rating: -2..2 }' }, { status: 400 });
  }
  return Response.json(await setImageRating(body.url, body.rating));
}
