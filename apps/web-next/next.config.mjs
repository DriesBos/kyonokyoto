// @ts-check

// ponytail: no images.remotePatterns — event images go through Netlify Image CDN
// (/.netlify/images, allowlist in netlify.toml), same pipeline as apps/web.
// Next caps remotePatterns at 50; our source allowlist is 272 hosts.

// City and festival pages get their CDN lifetime and purge tag from src/proxy.ts (lib/cdnCache).

// Next streams its RSC payload through inline scripts, and pages are cached on the CDN, so a
// per-request nonce would be shared by every visitor of a cached copy. apps/web hashes inline
// scripts in its middleware; Next cannot rewrite the streamed HTML, so inline scripts stay allowed
// and the policy locks down every other resource type instead.
export const contentSecurityPolicy = ({ dev = false } = {}) =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''} https://www.googletagmanager.com https://www.youtube.com https://maps.googleapis.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com https://maps.googleapis.com https://maps.gstatic.com https://www.google.com https://www.youtube.com",
    'frame-src https://www.youtube.com',
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');

export const securityHeaders = ({ dev = false } = {}) => [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy({ dev }) },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
  trailingSlash: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders({ dev: process.env.NODE_ENV !== 'production' }),
      },
    ];
  },
};

export default nextConfig;
