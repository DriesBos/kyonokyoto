// @ts-check

// ponytail: no images.remotePatterns — event images go through Netlify Image CDN
// (/.netlify/images, allowlist in netlify.toml), same pipeline as apps/web.
// Next caps remotePatterns at 50; our source allowlist is 272 hosts.

const eventPageHeaders = [
  { key: 'Cache-Control', value: 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400' },
  { key: 'Netlify-CDN-Cache-Control', value: 'public, durable, s-maxage=300, stale-while-revalidate=86400' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  async headers() {
    return [
      { source: '/:city/:locale', headers: eventPageHeaders },
      { source: '/hong-kong', headers: eventPageHeaders },
    ];
  },
};

export default nextConfig;
