import { defineMiddleware } from 'astro:middleware';
import { inlineScriptHashes } from './lib/csp';

const contentSecurityPolicy = (scriptHashes: string[]) =>
  `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src ${["'self'", ...scriptHashes].join(' ')} https://www.googletagmanager.com https://www.youtube.com https://maps.googleapis.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co https://*.google-analytics.com https://*.analytics.google.com https://maps.googleapis.com https://maps.gstatic.com https://www.google.com https://www.youtube.com; frame-src https://www.youtube.com; worker-src 'self' blob:; manifest-src 'self'`;

const securityHeaders = {
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();

  for (const [name, value] of Object.entries(securityHeaders)) {
    response.headers.set(name, value);
  }

  if (!response.headers.get('content-type')?.includes('text/html') || !response.body) {
    response.headers.set('Content-Security-Policy', contentSecurityPolicy([]));
    return response;
  }

  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.set('Content-Security-Policy', contentSecurityPolicy(inlineScriptHashes(html)));
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
});
