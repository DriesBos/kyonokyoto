import type { AppCity } from './cities.ts';
import { cityCacheTag } from './cdnCache.ts';
import { supabaseEnv } from './env.ts';

// Source details (names, taxonomy, address, flags) come from public.source_profiles, which
// scripts/sync-sources.mjs fills on every scheduled crawl. A new source therefore shows up after
// its first crawl, with no Netlify deploy. The source JSON bundled at build stays the fallback.

export type SourceProfileRow = { slug: string; profile: Record<string, unknown> | null };

// One small request per city (~4-8 KB gzipped). An hour of fetch cache is plenty: sources only
// change when a crawl cycle syncs them, and crawls run every 36 hours.
const SOURCE_PROFILE_REVALIDATE_SECONDS = 3600;

// Supabase rows win over the bundled JSON for the same slug, and slugs only Supabase knows
// (sources added since the last deploy) are appended. Rows without a usable profile are ignored.
export const mergeSourceProfiles = <T extends { slug: string }>(
  bundled: T[],
  rows: SourceProfileRow[] | null,
): T[] => {
  if (!rows?.length) return bundled;
  const profiles = new Map<string, T>();
  for (const row of rows) {
    const profile = row?.profile;
    if (!row?.slug || !profile || typeof profile !== 'object' || Array.isArray(profile)) continue;
    if (typeof profile.name !== 'string' || !profile.name) continue;
    profiles.set(row.slug, { ...profile, slug: row.slug } as unknown as T);
  }
  const merged = bundled.map((source) => profiles.get(source.slug) ?? source);
  const known = new Set(bundled.map((source) => source.slug));
  for (const [slug, profile] of profiles) if (!known.has(slug)) merged.push(profile);
  return merged;
};

// Never throws: before the migration is applied, or on a Supabase hiccup, pages keep rendering
// from the bundled JSON.
export async function fetchSourceProfiles(city: AppCity): Promise<SourceProfileRow[] | null> {
  const { url, key } = supabaseEnv();
  if (!url || !key) return null;
  try {
    const endpoint = new URL('/rest/v1/source_profiles', url);
    endpoint.search = new URLSearchParams({
      select: 'slug,profile',
      city: `eq.${city}`,
    }).toString();
    const response = await fetch(endpoint, {
      headers: { apikey: key },
      next: { revalidate: SOURCE_PROFILE_REVALIDATE_SECONDS, tags: [cityCacheTag(city)] },
    });
    if (!response.ok) return null;
    const rows = (await response.json()) as unknown;
    return Array.isArray(rows) ? (rows as SourceProfileRow[]) : null;
  } catch {
    return null;
  }
}
