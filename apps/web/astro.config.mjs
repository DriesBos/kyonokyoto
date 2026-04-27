// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import partytown from '@astrojs/partytown';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: netlify(),
  devToolbar: {
    enabled: false,
  },
  integrations: [
    partytown({ config: { forward: ['dataLayer.push'] } }),
  ],
  image: {
    remotePatterns: [
      { protocol: "https" },
      { protocol: "http" },
    ],
  },
});
