import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLocale, shouldShowLanguageOption } from '../src/lib/i18n.ts';

test('English remains default until a locale preference exists', () => {
  assert.equal(resolveLocale({ acceptLanguage: 'ja-JP,ja;q=0.9' }), 'en');
  assert.equal(resolveLocale({ cookieLocale: 'ja' }), 'ja');
});

test('language option appears only for Japan, Japanese preference, or Japanese escape', () => {
  assert.equal(
    shouldShowLanguageOption({ countryCode: 'JP', acceptLanguage: 'en-US', locale: 'en' }),
    true,
  );
  assert.equal(
    shouldShowLanguageOption({ countryCode: 'US', acceptLanguage: 'ja-JP', locale: 'en' }),
    true,
  );
  assert.equal(
    shouldShowLanguageOption({ countryCode: 'US', acceptLanguage: 'en-US', locale: 'ja' }),
    true,
  );
  assert.equal(
    shouldShowLanguageOption({ countryCode: 'US', acceptLanguage: 'en-US', locale: 'en' }),
    false,
  );
});
