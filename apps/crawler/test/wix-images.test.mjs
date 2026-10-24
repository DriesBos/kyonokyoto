import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventExtractors } from '../src/run-once.mjs';

const asset = 'fc5b76_49c4f0e8646d4a1fb6b5859d2dac3072~mv2.jpg';
const wixUrl = (transform) =>
  `https://static.wixstatic.com/media/${asset}/v1/fill/${transform}/${asset}`;
const source = {
  name: 'Kankakari',
  taxonomy: {
    venue_category: ['gallery'],
    display_category: ['ceramics'],
    event_category: ['exhibition'],
  },
  address_text: '15 Murasakino Shimotsukiyama-cho, Kita-ku, Kyoto Japan',
};
const detailUrl = 'https://www.kankakari.com/single-post/takayuki-watanabe-exhibition-11-6-23';

test('Wix srcset URLs with commas resolve to the original Wix asset', () => {
  const event = eventExtractors.kankakari(
    `
      <meta property="og:title" content="Takayuki Watanabe exhibition 11/6-23">
      <meta property="og:description" content="渡辺隆之 展 2026. 11. 6 fri - 23 mon 13:00-18:00">
      <meta property="article:published_time" content="2026-10-20T01:30:14.114Z">
      <article>
        <img
          src="${wixUrl('w_147,h_205,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto')}"
          srcset="${wixUrl('w_490,h_684,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto')} 1x, ${wixUrl('w_980,h_1369,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto')} 2x"
          width="490"
          height="684"
          alt="Takayuki Watanabe">
      </article>
    `,
    source,
    detailUrl,
  );

  assert.equal(event.primary_image_url, `https://static.wixstatic.com/media/${asset}`);
  assert.deepEqual(event.image_urls, [`https://static.wixstatic.com/media/${asset}`]);
});

test('Wix og:image transforms resolve to the original Wix asset', () => {
  const event = eventExtractors.kankakari(
    `
      <meta property="og:title" content="Takayuki Watanabe exhibition 11/6-23">
      <meta property="og:description" content="渡辺隆之 展 2026. 11. 6 fri - 23 mon">
      <meta property="article:published_time" content="2026-10-20T01:30:14.114Z">
      <meta property="og:image" content="https://static.wixstatic.com/media/${asset}/v1/fill/w_716,h_1000,al_c,q_85,usm_0.66_1.00_0.01/${asset}">
    `,
    source,
    detailUrl,
  );

  assert.equal(event.primary_image_url, `https://static.wixstatic.com/media/${asset}`);
});
