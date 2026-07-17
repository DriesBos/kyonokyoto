import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ request }) => {
  const origin = new URL(import.meta.env.PUBLIC_SITE_URL || request.url).origin;

  return new Response(
    `User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`,
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    },
  );
};
