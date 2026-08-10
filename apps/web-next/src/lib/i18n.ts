export type AppLocale = 'en' | 'ja';

export const LOCALE_COOKIE = 'kyo_locale';

export const uiText = {
  en: {
    lang: 'en',
    description:
      'Discover current and upcoming art exhibitions, museum shows, and cultural events, with dates, venues, maps, and official links.',
    filtersAria: 'Filter events',
    controlsAria: 'Site controls',
    languageAria: 'Language',
    filter: 'filter',
    map: 'map',
    cities: 'cities',
    ongoing: 'ongoing',
    upcoming: 'upcoming',
    permanent: 'permanent',
    noEvents: 'No events!',
    unsetFilters: 'Please unset some filters.',
    emptyTitle: 'No ongoing or upcoming events yet',
    emptyDescription: 'New events will appear here automatically.',
    alsoVisit: 'also visit',
    getReady: 'get ready!',
    findMe: 'Find me',
    mapUnavailable: 'Map unavailable.',
    noMapLocations: 'No map locations available.',
    addMapsEnv: 'Add Google Maps API key and map ID.',
    mapFailed: 'Map failed to load.',
    findingLocation: 'finding location',
    locationUnavailable: 'location unavailable',
    directions: 'Directions',
    google: 'Google',
    apple: 'Apple',
    website: 'Website',
    eventLinks: 'Event links',
    scrollTop: 'Scroll to top',
  },
  ja: {
    lang: 'ja',
    description:
      '開催中・開催予定の展覧会、美術館の企画展、文化イベントを、日程・会場・地図・公式リンクとともに紹介します。',
    filtersAria: 'イベントを絞り込む',
    controlsAria: 'サイト操作',
    languageAria: '言語',
    filter: '絞り込み',
    map: '地図',
    cities: '都市',
    ongoing: '開催中',
    upcoming: '開催予定',
    permanent: '常設',
    noEvents: 'イベントなし',
    unsetFilters: '絞り込みを外してください。',
    emptyTitle: '開催中・開催予定のイベントはまだありません',
    emptyDescription: '新しいイベントは自動的に表示されます。',
    alsoVisit: 'あわせて',
    getReady: 'もうすぐ',
    findMe: '現在地',
    mapUnavailable: '地図を表示できません。',
    noMapLocations: '地図に表示できる場所がありません。',
    addMapsEnv: 'Google Maps API キーと Map ID を設定してください。',
    mapFailed: '地図の読み込みに失敗しました。',
    findingLocation: '現在地を検索中',
    locationUnavailable: '現在地を取得できません',
    directions: '行き方',
    google: 'Google',
    apple: 'Apple',
    website: '公式サイト',
    eventLinks: 'イベントリンク',
    scrollTop: 'ページ上部へ',
  },
} as const;

export function normalizeLocale(value: unknown): AppLocale | null {
  if (typeof value !== 'string') return null;
  const locale = value.trim().toLowerCase();
  if (locale === 'jp' || locale.startsWith('ja')) return 'ja';
  if (locale.startsWith('en')) return 'en';
  return null;
}
