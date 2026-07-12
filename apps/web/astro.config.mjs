// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import partytown from '@astrojs/partytown';

/** @param {string} filePath */
export const preventJavaScriptInlining = (filePath) =>
  /\.(?:m?js)$/.test(filePath) ? false : undefined;

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: netlify(),
  devToolbar: {
    enabled: false,
  },
  integrations: [partytown({ config: { forward: ['dataLayer.push'] } })],
  vite: {
    build: {
      assetsInlineLimit: preventJavaScriptInlining,
    },
  },
  image: {
    remotePatterns: [{ protocol: 'https' }, { protocol: 'http' }],
  },
});
