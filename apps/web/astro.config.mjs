// @ts-check
import { defineConfig } from 'astro/config';
import netlify from '@astrojs/netlify';
import partytown from '@astrojs/partytown';
import { readdirSync, readFileSync } from 'node:fs';

const sourceConfigDirectory = new URL('../../data/sources/', import.meta.url);
const sharedImageHosts = [
  'art-view.roppongihills.com',
  'atz-image.s3.ap-northeast-1.amazonaws.com',
  'baseec-img-mng.akamaized.net',
  'blogger.googleusercontent.com',
  'cdn.sanity.io',
  'cdn.shopify.com',
  'i.ytimg.com',
  'image.jimcdn.com',
  'images.microcms-assets.io',
  'images.squarespace-cdn.com',
  'standingpine.storage.googleapis.com',
  'static-assets.artlogic.net',
  'static.wixstatic.com',
  'static1.squarespace.com',
  'storage.googleapis.com',
  'tcv.roppongihills.com',
  'white-cube.transforms.svdcdn.com',
  'www.pacegallery.com',
  'www.polamuseum.or.jp',
];

const sourceImagePatterns = readdirSync(sourceConfigDirectory)
  .filter((fileName) => fileName.endsWith('-sources.json'))
  .flatMap((fileName) => {
    const config = JSON.parse(readFileSync(new URL(fileName, sourceConfigDirectory), 'utf8'));
    return (config.sources ?? []).flatMap((source) => {
      try {
        const baseUrl = new URL(source.base_url);
        const protocol = baseUrl.protocol.slice(0, -1);
        if (protocol !== 'https' && protocol !== 'http') return [];
        return [...new Set([baseUrl.hostname, ...(source.allowed_domains ?? [])])].map(
          (hostname) => ({
            protocol,
            hostname,
          }),
        );
      } catch {
        // Invalid source URLs cannot become an image allowlist entry.
        return [];
      }
    });
  });

export const imageRemotePatterns = [
  ...sourceImagePatterns,
  ...sharedImageHosts.map((hostname) => ({ protocol: 'https', hostname })),
]
  .filter(({ hostname }) => /^[a-z0-9.-]+$/i.test(hostname))
  .filter(
    ({ protocol, hostname }, index, patterns) =>
      patterns.findIndex(
        (pattern) => pattern.protocol === protocol && pattern.hostname === hostname,
      ) === index,
  )
  .sort((left, right) =>
    `${left.protocol}:${left.hostname}`.localeCompare(`${right.protocol}:${right.hostname}`),
  );

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
    remotePatterns: imageRemotePatterns,
  },
});
