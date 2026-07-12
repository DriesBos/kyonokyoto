import { createHash, randomBytes } from 'node:crypto';
import { defineMiddleware } from 'astro:middleware';
import { partytownSnippet } from '@qwik.dev/partytown/integration';

const partytownLib = '/~partytown/';
const partytownBootstrap = `${partytownSnippet({
  lib: partytownLib,
  forward: ['dataLayer.push'],
  debug: import.meta.env.DEV,
})};(e=>{e.addEventListener("astro:before-swap",e=>{let r=document.body.querySelector("iframe[src*='${partytownLib}']");if(r)e.newDocument.body.append(r)})})(document);`;
const partytownHash = createHash('sha256').update(partytownBootstrap).digest('base64');

const securityHeaders = (nonce: string) => ({
  'Content-Security-Policy': `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' 'nonce-${nonce}' 'sha256-${partytownHash}' https://www.googletagmanager.com https://www.youtube.com https://maps.googleapis.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://maps.googleapis.com https://maps.gstatic.com https://www.google.com https://www.youtube.com; frame-src https://www.youtube.com; worker-src 'self' blob:; manifest-src 'self'`,
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
});

export const onRequest = defineMiddleware(async (context, next) => {
  const nonce = randomBytes(16).toString('base64');
  context.locals.cspNonce = nonce;
  const response = await next();

  for (const [name, value] of Object.entries(securityHeaders(nonce))) {
    response.headers.set(name, value);
  }

  return response;
});
