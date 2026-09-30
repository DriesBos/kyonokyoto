import type { APIRoute } from 'astro';
import hongKongSourcesPayload from '../../../../data/sources/hong-kong-sources.json';
import kyotoSourcesPayload from '../../../../data/sources/kyoto-sources.json';
import osakaSourcesPayload from '../../../../data/sources/osaka-sources.json';
import tokyoSourcesPayload from '../../../../data/sources/tokyo-sources.json';
import { cityConfigs } from '../lib/cities';
import type { AppCity } from '../lib/cities';
import type { AppLocale } from '../lib/i18n';
import { configuredSourcesFrom, type SourceConfig } from '../lib/sources';
import { supabase } from '../lib/supabase';

const locales: AppLocale[] = ['en', 'ja'];
const escapeXml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export const GET: APIRoute = async ({ request }) => {
  const origin = new URL(import.meta.env.PUBLIC_SITE_URL || request.url).origin;
  const sourcePayloads = {
    kyoto: kyotoSourcesPayload,
    osaka: osakaSourcesPayload,
    tokyo: tokyoSourcesPayload,
    'hong-kong': hongKongSourcesPayload,
  } satisfies Record<AppCity, { sources: SourceConfig[] }>;
  const publicSourceSlugs = new Map(
    cityConfigs.map(({ slug }) => [
      slug,
      new Set(configuredSourcesFrom(sourcePayloads[slug].sources as SourceConfig[]).map((source) => source.slug)),
    ]),
  );
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
  const { data: festivals, error } = await supabase
    .from('events')
    .select('city, festival_slug, sources(slug)')
    .eq('status', 'published')
    .eq('event_kind', 'festival')
    .not('festival_slug', 'is', null);
  if (error) throw error;
  for (const festival of festivals ?? []) {
    if (!festival.festival_slug || !cityConfigs.some((city) => city.slug === festival.city)) continue;
    const sourceRelation = Array.isArray(festival.sources) ? festival.sources[0] : festival.sources;
    if (!publicSourceSlugs.get(festival.city as AppCity)?.has(sourceRelation?.slug ?? '')) continue;
    const pathFor = (locale: AppLocale) =>
      `/${festival.city}/${locale}/festivals/${encodeURIComponent(festival.festival_slug)}/`;
    for (const locale of locales) {
      const location = new URL(pathFor(locale), origin).href;
      const alternates = locales
        .map((alternateLocale) => `<xhtml:link rel="alternate" hreflang="${alternateLocale}" href="${escapeXml(new URL(pathFor(alternateLocale), origin).href)}" />`)
        .join('');
      const defaultAlternate = `<xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(new URL(pathFor('en'), origin).href)}" />`;
      urls.push(`<url><loc>${escapeXml(location)}</loc>${alternates}${defaultAlternate}</url>`);
    }
  }

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
