import { DEV_PAGE_ENABLED } from '@/lib/devPage';
import { setLandingBlocked } from '@/lib/landingBlocklistFile';

// Local dev only (/dev/landing/): writes data/landing-blocklist.json, which ships with the next
// deploy. Production builds answer 404.
export async function POST(request: Request) {
  if (!DEV_PAGE_ENABLED) return new Response('Not found', { status: 404 });
  const body = await request.json().catch(() => null);
  const kind = body?.kind;
  if ((kind !== 'images' && kind !== 'events') || typeof body?.value !== 'string') {
    return Response.json(
      { error: 'Expected { kind: "images" | "events", value, blocked }' },
      { status: 400 },
    );
  }
  return Response.json(await setLandingBlocked(kind, body.value, body.blocked !== false));
}
