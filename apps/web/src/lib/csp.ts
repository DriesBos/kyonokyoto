import { createHash } from 'node:crypto';

// Inline scripts are allowed by hash, not nonce: pages are cached on the CDN, so a nonce would be
// shared by every visitor served that copy. Hashing the rendered HTML also covers the Partytown
// snippet and define:vars scripts whose contents vary per city and locale.
const inlineScriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

export const inlineScriptHashes = (html: string) => [
  ...new Set(
    [...html.matchAll(inlineScriptPattern)]
      .filter(([, attributes, body]) => body && !/\bsrc\s*=/i.test(attributes))
      .map(([, , body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`),
  ),
];
