import type { AppLocale } from './i18n';
import type { ClassifiedEvent } from './events';
import type { SourceConfig } from './sources';

export type MediaEmbed = {
  type: 'youtube';
  url: string;
  video_id?: string;
};

type HighlightCadence = 'permanent' | 'occasional';

export type PermanentExhibitionHighlight = {
  slug: string;
  cadence?: HighlightCadence;
  name?: string;
  names?: Partial<Record<AppLocale, string>>;
  base_url?: string;
  source_categories?: string[];
  address_text?: string;
  directions_query?: string | null;
  lat?: number;
  lng?: number;
  is_active?: boolean;
  beta?: boolean;
  urls?: Partial<Record<AppLocale, string>>;
  description?: Partial<Record<AppLocale, string>> | string | null;
  image_urls?: string[];
  primary_image_url?: string | null;
  media_embeds?: MediaEmbed[];
};

const localizedValue = (
  values: Partial<Record<AppLocale, string>> | undefined,
  activeLocale: AppLocale,
  fallback: string,
) => values?.[activeLocale] || values?.en || values?.ja || fallback;

const localizedDescription = (
  value: PermanentExhibitionHighlight['description'],
  activeLocale: AppLocale,
) => {
  if (!value) return null;
  if (typeof value === 'string') return value;

  return value[activeLocale] ?? value.en ?? value.ja ?? null;
};

export const youtubeVideoIdFromUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] ?? null;
    if (url.hostname.endsWith('youtube.com')) return url.searchParams.get('v');
  } catch {
    return null;
  }

  return null;
};

const normalizeMediaEmbeds = (mediaEmbeds: MediaEmbed[] | undefined) =>
  (mediaEmbeds ?? [])
    .map((embed) => {
      if (embed.type !== 'youtube') return null;

      const videoId = embed.video_id ?? youtubeVideoIdFromUrl(embed.url);
      if (!videoId) return null;

      return {
        type: 'youtube' as const,
        url: embed.url,
        video_id: videoId,
      };
    })
    .filter((embed): embed is MediaEmbed & { video_id: string } => embed !== null);

const cadenceDateText: Record<AppLocale, string> = {
  en: 'also visit',
  ja: 'あわせて',
};

export const permanentEventsForLocale = ({
  highlights,
  configuredSources,
  activeLocale,
}: {
  highlights: PermanentExhibitionHighlight[];
  configuredSources: SourceConfig[];
  activeLocale: AppLocale;
}): ClassifiedEvent[] => {
  const sourceBySlug = new Map(configuredSources.map((source) => [source.slug, source]));

  return highlights
    .filter((highlight) => highlight.is_active !== false)
    .filter((highlight) => !highlight.beta || import.meta.env.DEV)
    .map((highlight) => {
      const source = sourceBySlug.get(highlight.slug);
      const name = source?.name ?? highlight.name;
      const baseUrl = source?.base_url ?? highlight.base_url;
      if (!name || !baseUrl) return null;

      const institutionName = localizedValue(source?.names ?? highlight.names, activeLocale, name);
      const sourceUrl = localizedValue(highlight.urls, activeLocale, baseUrl);
      const cadence = highlight.cadence ?? 'permanent';

      return {
        id: `${cadence}:${highlight.slug}`,
        source_id: highlight.slug,
        title: institutionName,
        categories: source?.source_categories ?? highlight.source_categories ?? [],
        date_text: cadenceDateText[activeLocale],
        institution_name: institutionName,
        venue_name: null,
        address_text: source?.address_text ?? highlight.address_text ?? null,
        directions_query: highlight.directions_query ?? null,
        lat: source?.lat ?? highlight.lat ?? null,
        lng: source?.lng ?? highlight.lng ?? null,
        start_date: null,
        end_date: null,
        calendar_starts_at: null,
        calendar_ends_at: null,
        primary_image_url: highlight.primary_image_url ?? null,
        image_urls: highlight.image_urls ?? [],
        media_embeds: normalizeMediaEmbeds(highlight.media_embeds),
        source_url: sourceUrl,
        description: localizedDescription(highlight.description, activeLocale),
        schedule_type: 'unknown',
        occurrence_dates: [],
        timing: 'permanent',
      } satisfies ClassifiedEvent;
    })
    .filter((event) => event !== null) as ClassifiedEvent[];
};

export const permanentEventsByLocale = ({
  highlights,
  configuredSources,
  supportedLocales,
}: {
  highlights: PermanentExhibitionHighlight[];
  configuredSources: SourceConfig[];
  supportedLocales: AppLocale[];
}) =>
  Object.fromEntries(
    supportedLocales.map((supportedLocale) => [
      supportedLocale,
      permanentEventsForLocale({
        highlights,
        configuredSources,
        activeLocale: supportedLocale,
      }),
    ]),
  ) as Record<AppLocale, ClassifiedEvent[]>;
