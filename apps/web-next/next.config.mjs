// @ts-check

// ponytail: no images.remotePatterns — event images go through Netlify Image CDN
// (/.netlify/images, allowlist in netlify.toml), same pipeline as apps/web.
// Next caps remotePatterns at 50; our source allowlist is 272 hosts.

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default nextConfig;
