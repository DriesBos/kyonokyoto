import type { APIRoute } from 'astro';
import { cityConfigs } from '../lib/cities';
import type { AppLocale } from '../lib/i18n';

const locales: AppLocale[] = ['en', 'ja'];
const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const GET: APIRoute = ({ request }) => {
  const origin = new URL(import.meta.env.PUBLIC_SITE_URL || request.url).origin;
  const urls = cityConfigs.flatMap(({ slug }) =>
    locales.map((locale) => {
      const location = new URL(`/${slug}/${locale}/`, origin).href;
      const alternates = locales
        .map(
          (alternateLocale) =>
            `<xhtml:link rel="alternate" hreflang="${alternateLocale}" href="${escapeXml(new URL(`/${slug}/${alternateLocale}/`, origin).href)}" />`,
        )
        .join('');
      const defaultAlternate = `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(new URL(`/${slug}/en/`, origin).href)}" />`;

      return `<url><loc>${escapeXml(location)}</loc>${alternates}${defaultAlternate}</url>`;
    }),
  );

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls.join('')}</urlset>\n`,
    {
      headers: {
        'Cache-Control': 'public, max-age=3600',
        'Content-Type': 'application/xml; charset=utf-8',
      },
    },
  );
};
