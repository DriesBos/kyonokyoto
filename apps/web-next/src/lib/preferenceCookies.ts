import { CITY_COOKIE, CITY_STORAGE_KEY, type AppCity } from './cities.ts';
import { LOCALE_COOKIE, type AppLocale } from './i18n.ts';

// Netlify redirect rules can only test whether a cookie exists, not its value, so the language
// preference is also stored as a cookie per language (kyo_pref_en / kyo_pref_ja). netlify.toml
// sends `/` to /kyoto/<that language>/ at the edge, with no function call.
export const localePreferenceCookie = (locale: AppLocale) => `kyo_pref_${locale}`;
const PREFERENCE_LOCALES: AppLocale[] = ['en', 'ja'];
const YEAR = 31536000;

export function persistPreference(city: AppCity, locale: AppLocale) {
  const cookie = (name: string, value: string, maxAge = YEAR) => {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; samesite=lax`;
  };
  cookie(CITY_COOKIE, city);
  cookie(LOCALE_COOKIE, locale);
  PREFERENCE_LOCALES.forEach((candidate) =>
    cookie(localePreferenceCookie(candidate), '1', candidate === locale ? YEAR : 0),
  );
  try {
    window.localStorage.setItem(CITY_STORAGE_KEY, city);
  } catch {
    // private mode / storage blocked: the cookies still carry the preference
  }
}
