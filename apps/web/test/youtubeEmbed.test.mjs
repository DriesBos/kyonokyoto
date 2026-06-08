import assert from 'node:assert/strict';
import test from 'node:test';

import { buildYouTubeEmbedSrc } from '../src/lib/youtubeEmbed.ts';

test('ambient YouTube embed URL uses documented player params for control-less looping playback', () => {
  const src = buildYouTubeEmbedSrc('kK0xC3yRJ3I', {
    origin: 'https://kyo.example',
  });
  const url = new URL(src);

  assert.equal(url.origin, 'https://www.youtube.com');
  assert.equal(url.pathname, '/embed/kK0xC3yRJ3I');
  assert.equal(url.searchParams.get('autoplay'), '0');
  assert.equal(url.searchParams.get('controls'), '0');
  assert.equal(url.searchParams.get('disablekb'), '1');
  assert.equal(url.searchParams.get('enablejsapi'), '1');
  assert.equal(url.searchParams.get('fs'), '0');
  assert.equal(url.searchParams.get('iv_load_policy'), '3');
  assert.equal(url.searchParams.get('loop'), '1');
  assert.equal(url.searchParams.get('mute'), '1');
  assert.equal(url.searchParams.get('origin'), 'https://kyo.example');
  assert.equal(url.searchParams.get('playlist'), 'kK0xC3yRJ3I');
  assert.equal(url.searchParams.get('playsinline'), '1');
  assert.equal(url.searchParams.get('rel'), '0');
  assert.equal(url.searchParams.has('modestbranding'), false);
});
