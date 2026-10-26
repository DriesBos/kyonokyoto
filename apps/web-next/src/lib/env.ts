// Single place for environment reads. PUBLIC_* are the V1 (Astro) names, kept during cutover.
// NEXT_PUBLIC_* must be read with literal `process.env.NEXT_PUBLIC_X` so Next inlines them into
// client bundles.

export const supabaseEnv = () => ({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.PUBLIC_SUPABASE_URL,
  key:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

export const configuredSiteUrl = () =>
  process.env.NEXT_PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL;

export const googleMapsEnv = () => ({
  apiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? process.env.PUBLIC_GOOGLE_MAPS_API_KEY,
  mapId: process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID ?? process.env.PUBLIC_GOOGLE_MAPS_MAP_ID,
});

// NETLIFY is only set during the Netlify build, not when ISR re-renders a page at runtime, so the
// build inlines NEXT_PUBLIC_IMAGE_CDN (netlify.toml) for server and client code alike.
export const imageCdnEnabled = () =>
  process.env.NEXT_PUBLIC_IMAGE_CDN === '1' || Boolean(process.env.NETLIFY);
