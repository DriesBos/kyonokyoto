export type AppLocale = 'en' | 'ja';

export const LOCALE_COOKIE = 'kyo_locale';

export const uiText = {
  en: {
    lang: 'en',
    title: 'Kyoto Art & Culture Calendar | Kyō no Kyōto',
    description:
      'Discover current and upcoming art exhibitions, museum shows, and cultural events across Kyoto, with dates, venues, maps, and official links.',
    mapTitle: 'Map | Kyō no Kyōto',
    mapDescription: 'Kyoto cultural institution map from KyōNoKyōto',
    homeAria: 'KyōNoKyōto home',
    filtersAria: 'Filter events',
    controlsAria: 'Site controls',
    languageAria: 'Language',
    filter: 'filter',
    map: 'map',
    ongoing: 'ongoing',
    upcoming: 'upcoming',
    starred: 'starred',
    noEvents: 'No events!',
    unsetFilters: 'Please unset some filters.',
    emptyTitle: 'No ongoing or upcoming events yet',
    emptyDescription:
      'The crawler is connected. Once ongoing or upcoming events are available, they will appear here automatically.',
    apple: 'Apple',
    google: 'Google',
    directions: 'Directions',
    website: 'Website',
    mapEventsTitle: 'Happening here',
    fallbackExcerpt: 'More details available on the original source page.',
    upcomingEventsAria: 'upcoming events',
    getReady: 'get ready!',
  },
  ja: {
    lang: 'ja',
    title: '京都の展覧会・文化イベント | 京の京都',
    description:
      '京都で開催中・開催予定の展覧会、美術館の企画展、文化イベントを、日程・会場・地図・公式リンクとともに紹介します。',
    mapTitle: '地図 | 京の京都',
    mapDescription: 'KyōNoKyōto の京都文化施設マップ',
    homeAria: 'KyōNoKyōto ホーム',
    filtersAria: 'イベントを絞り込む',
    controlsAria: 'サイト操作',
    languageAria: '言語',
    filter: '絞り込み',
    map: '地図',
    ongoing: '開催中',
    upcoming: '開催予定',
    starred: 'スター付き',
    noEvents: 'イベントなし',
    unsetFilters: '絞り込みを外してください。',
    emptyTitle: '開催中・開催予定のイベントはまだありません',
    emptyDescription:
      'クローラーは接続済みです。開催中・開催予定のイベントが見つかると自動で表示されます。',
    apple: 'Apple',
    google: 'Google',
    directions: '行き方',
    website: '公式サイト',
    mapEventsTitle: 'ここで開催',
    fallbackExcerpt: '詳細は公式サイトで確認してください。',
    upcomingEventsAria: '開催予定イベント',
    getReady: 'もうすぐ',
  },
} as const;

export function normalizeLocale(value: unknown): AppLocale | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'jp') return 'ja';
  if (normalized.startsWith('ja')) return 'ja';
  if (normalized.startsWith('en')) return 'en';
  return null;
}

export function localeFromAcceptLanguage(value: string | null | undefined): AppLocale | null {
  if (!value) return null;

  const preferred = value
    .split(',')
    .map((part) => part.trim().split(';')[0])
    .map(normalizeLocale)
    .find(Boolean);

  return preferred ?? null;
}

export function resolveLocale({
  cookieLocale,
  fallback = 'en',
}: {
  cookieLocale?: string | null;
  fallback?: AppLocale;
}): AppLocale {
  return normalizeLocale(cookieLocale) ?? fallback;
}

export function shouldShowLanguageOption({
  countryCode,
  acceptLanguage,
  locale,
}: {
  countryCode?: string | null;
  acceptLanguage?: string | null;
  locale: AppLocale;
}): boolean {
  return (
    locale === 'ja' ||
    countryCode?.trim().toUpperCase() === 'JP' ||
    localeFromAcceptLanguage(acceptLanguage) === 'ja'
  );
}
