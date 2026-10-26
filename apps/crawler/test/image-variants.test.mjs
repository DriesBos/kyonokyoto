import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  eventExtractors,
  extractFukudaListingUrlsBySchedule,
  isUsableNativeLocaleUrl,
  normalizeEventImagesForSource,
} from '../src/run-once.mjs';

const source = {
  slug: 'example',
  name: 'Example',
  language: 'ja',
  taxonomy: {
    venue_category: ['gallery'],
    display_category: ['contemporary'],
    event_category: ['exhibition'],
  },
  address_text: 'Kyoto',
};
const noProbe = async () => {
  throw new Error('no network in tests');
};

test('final media boundary collapses artlogic and Shopify size variants of one image', async () => {
  const artlogic = (transform, folder) =>
    `https://static-assets.artlogic.net/${transform}/ws-artlogicwebsite0038/usr/images/exhibitions/${folder}/96/chrcul_2026_city-filmmaker_01.jpg`;
  const shopify = (width) =>
    `https://kuramonzen.com/cdn/shop/articles/WebBanner_9e65.jpg?v=1790041086&width=${width}`;
  const other =
    'https://kuramonzen.com/cdn/shop/articles/WebBanner_b4c1.jpg?v=1789788197&width=533';

  const event = await normalizeEventImagesForSource(
    {
      source_url: 'https://www.nonaka-hill.com/exhibitions/96-christopher-culver-house-on-canal/',
      primary_image_url: artlogic(
        'w_920,h_920,c_limit,f_auto,fl_lossy,q_auto',
        'group_images_override',
      ),
      image_urls: [
        artlogic('w_920,h_920,c_limit,f_auto,fl_lossy,q_auto', 'group_images_override'),
        artlogic('w_1200,h_630,c_fill,f_auto,fl_lossy,q_auto', 'main_image_override'),
        shopify(1100),
        shopify(533),
        other,
      ],
    },
    source,
    { fetchImageDimensionsFn: noProbe },
  );

  assert.deepEqual(event.image_urls, [
    artlogic('w_920,h_920,c_limit,f_auto,fl_lossy,q_auto', 'group_images_override'),
    shopify(1100),
    other,
  ]);
});

test('Kuramonzen uses the article images below the title, not the banner', () => {
  const event = eventExtractors.kuramonzen(
    `
      <meta property="og:image" content="https://kuramonzen.com/cdn/shop/articles/WebBanner_9e.jpg?v=1">
      <article class="article-template">
        <img src="//kuramonzen.com/cdn/shop/articles/WebBanner_9e.jpg?v=1&width=1100" width="3972" height="2648">
        <h1 class="article-template__title">Living National Treasures</h1>
        <p><strong>2026.10.17 - 12.10</strong></p>
        <p>KURA MONZEN Gallery will hold a special exhibition from 10/17, introducing works of craft.</p>
        <img src="https://cdn.shopify.com/s/files/1/0658/files/work-1.png?v=1" width="631" height="450">
        <img src="https://cdn.shopify.com/s/files/1/0658/files/work-2.png?v=1" width="631" height="450">
        <div class="article-template__back"><a href="/blogs/exhibitions">Back</a></div>
      </article>
    `,
    { ...source, slug: 'kuramonzen', name: 'Kuramonzen', language: 'en' },
    'https://kuramonzen.com/blogs/exhibitions/living-national-treasures',
  );

  assert.deepEqual(event.image_urls, [
    'https://cdn.shopify.com/s/files/1/0658/files/work-1.png?v=1',
    'https://cdn.shopify.com/s/files/1/0658/files/work-2.png?v=1',
  ]);
  assert.equal(event.primary_image_url, event.image_urls[0]);
});

test('Fukuda uses post-body artwork images instead of the short hero strip', () => {
  const upload = 'https://fukuda-art-museum.jp/wp/wp-content/uploads/2026';
  const event = eventExtractors['fukuda-art-museum'](
    `
      <div id="eyeVisual" class="eye_exhibition" style="background-image: url('${upload}/06/banner_w1100_h360_72.jpg')"></div>
      <article class="post ex">
        <h1 class="title">愛のカタチ</h1>
        <div class="postBody">
          <img src="${upload}/07/artboard-1-scaled.jpg" width="2560" height="913">
          <img src="${upload}/07/artboard-2-scaled.jpg" width="2560" height="913">
          <table><tr><th>会期</th><td>2026年9月19日（土）～2027年1月17日（日）</td></tr></table>
          <p><a href="https://example.com"><img src="${upload}/10/image0.jpeg" width="1050" height="300"></a></p>
        </div>
        <aside class="postRelation"><img src="${upload}/04/related-491x600.jpg"></aside>
      </article>
    `,
    { ...source, slug: 'fukuda-art-museum', name: 'Fukuda Art Museum' },
    'https://fukuda-art-museum.jp/exhibition/202607014791',
  );

  assert.deepEqual(event.image_urls, [
    `${upload}/07/artboard-1-scaled.jpg`,
    `${upload}/07/artboard-2-scaled.jpg`,
  ]);
});

test('Fukuda EN listing cards map date ranges to EN detail pages', () => {
  const pairs = extractFukudaListingUrlsBySchedule(
    `
      <section id="exArv">
        <article class="postbox"><a href="/en/exhibition/202607011995">
          <h3>Forms of Love</h3><p>September 19, 2026〜January 17, 2027</p>
        </a></article>
      </section>
    `,
    'https://fukuda-art-museum.jp/en/exhibition',
  );

  assert.deepEqual(pairs, [
    ['2026-09-19|2027-01-17', 'https://fukuda-art-museum.jp/en/exhibition/202607011995'],
  ]);
});

test('a language switch that points at a listing page is not a native locale page', () => {
  const source = {
    allowed_domains: ['fukuda-art-museum.jp'],
    start_urls: ['https://fukuda-art-museum.jp/exhibition'],
    locales: { en: { start_urls: ['https://fukuda-art-museum.jp/en/exhibition'] } },
  };
  const detailUrl = 'https://fukuda-art-museum.jp/exhibition/202607014791';

  assert.equal(
    isUsableNativeLocaleUrl(detailUrl, 'https://fukuda-art-museum.jp/en/exhibition', source),
    false,
  );
  assert.equal(
    isUsableNativeLocaleUrl(
      detailUrl,
      'https://fukuda-art-museum.jp/en/exhibition/202607011995',
      source,
    ),
    true,
  );
});
