import {
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  supportedLocales,
  uiText,
} from "../lib/i18n";

const localeCookie = LOCALE_COOKIE;
const localeStorageKey = LOCALE_STORAGE_KEY;
const localeCodes = new Set(supportedLocales);
const maxAgeSeconds = 60 * 60 * 24 * 365;
const languageLabels = {
  en: "eng",
  ja: "jp",
};

const normalizeLocale = (value: unknown) => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "jp" || normalized.startsWith("ja")) return "ja";
  if (normalized.startsWith("en")) return "en";
  return null;
};

const localeFromPath = () => {
  const pathLocale =
    window.location.pathname.split("/").filter(Boolean)[0] ?? "";
  return localeCodes.has(pathLocale as never) ? pathLocale : null;
};

const getBrowserLocale = () => {
  const languages =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];

  for (const language of languages) {
    const locale = normalizeLocale(language);
    if (locale) return locale;
  }

  return null;
};

const getCookieLocale = () => {
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${localeCookie}=`));

  return normalizeLocale(
    match ? decodeURIComponent(match.slice(localeCookie.length + 1)) : "",
  );
};

const getStoredLocale = () => {
  try {
    return (
      normalizeLocale(window.localStorage?.getItem(localeStorageKey)) ??
      getCookieLocale()
    );
  } catch {
    return getCookieLocale();
  }
};

const setLocale = (locale: string) => {
  document.cookie = `${localeCookie}=${encodeURIComponent(locale)}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax`;
  try {
    window.localStorage?.setItem(localeStorageKey, locale);
  } catch {
    // Cookie still carries preference when storage fails.
  }
};

const getActiveLocale = (renderedLocale: string) =>
  normalizeLocale(document.documentElement.dataset.locale) ??
  normalizeLocale(document.documentElement.lang) ??
  renderedLocale;

const getLocalePayload = () => {
  const payloadScript = document.querySelector("[data-locale-payload]");
  if (!(payloadScript instanceof HTMLScriptElement)) return null;

  try {
    return JSON.parse(payloadScript.textContent || "{}");
  } catch {
    return null;
  }
};

const setLabel = (element: HTMLElement, value: string) => {
  const label = element.querySelector(".general-button__label");
  if (label) {
    label.textContent = value;
  } else {
    element.textContent = value;
  }
};

const setMetaContent = (selector: string, value: string) => {
  const element = document.querySelector(selector);
  if (element instanceof HTMLMetaElement) {
    element.content = value;
  }
};

const replacePathLocale = (locale: string) => {
  const url = new URL(window.location.href);
  const parts = url.pathname.split("/");
  const firstSegment = parts.findIndex(Boolean);

  if (firstSegment >= 0 && localeCodes.has(parts[firstSegment] as never)) {
    parts[firstSegment] = locale;
  } else {
    parts.splice(1, 0, locale);
  }

  url.pathname = parts.join("/") || `/${locale}/`;
  return url;
};

const applyLocale = (
  locale: string,
  options: { updateHistory?: boolean; persist?: boolean } = {},
) => {
  if (!localeCodes.has(locale as never)) return;

  const { updateHistory = true, persist = true } = options;
  const copy = uiText[locale as keyof typeof uiText] ?? uiText.en;
  const nextLocale = locale === "en" ? "ja" : "en";
  const payload = getLocalePayload();
  const meta = payload?.meta?.[locale];

  if (persist) {
    setLocale(locale);
  }

  document.documentElement.lang = copy.lang;
  document.documentElement.dataset.locale = locale;
  document.title = meta?.title ?? copy.title;
  setMetaContent(
    "meta[name='description']",
    meta?.description ?? copy.description,
  );
  setMetaContent("meta[property='og:title']", meta?.title ?? copy.title);
  setMetaContent(
    "meta[property='og:description']",
    meta?.description ?? copy.description,
  );

  const logo = document.querySelector(".mainHeader__logo");
  if (logo instanceof HTMLAnchorElement) {
    logo.href = `/${locale}/`;
    logo.setAttribute("aria-label", uiText.en.homeAria);
  }

  const localeButton = document.querySelector("[data-locale-toggle]");
  if (localeButton instanceof HTMLElement) {
    localeButton.dataset.localeOption = nextLocale;
    localeButton.dataset.localeHref = `/${nextLocale}/`;
    localeButton.setAttribute(
      "aria-label",
      `${uiText.en.languageAria}: ${languageLabels[locale as keyof typeof languageLabels]}`,
    );
    setLabel(
      localeButton,
      languageLabels[locale as keyof typeof languageLabels],
    );
  }

  const eventPayload = payload?.events ?? {};
  document.querySelectorAll("[data-event-card]").forEach((card) => {
    if (!(card instanceof HTMLElement)) return;
    const eventLocalePayload =
      eventPayload[card.dataset.eventId ?? ""]?.[locale];
    if (!eventLocalePayload) return;

    card.querySelectorAll("[data-event-field]").forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const field = element.dataset.eventField;
      if (!field || typeof eventLocalePayload[field] !== "string") return;
      element.textContent = eventLocalePayload[field];
    });

    card.querySelectorAll("[data-event-href]").forEach((element) => {
      if (!(element instanceof HTMLAnchorElement)) return;
      const field = element.dataset.eventHref;
      const value = field ? eventLocalePayload[field] : null;
      if (typeof value === "string" && value) {
        element.href = value;
      }
    });

    card.querySelectorAll("[data-apple-calendar-button]").forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      element.dataset.calendarTitle = eventLocalePayload.calendarTitle ?? "";
      element.dataset.calendarDetails =
        eventLocalePayload.calendarDetails ?? "";
      element.dataset.calendarLocation =
        eventLocalePayload.calendarLocation ?? "";
    });

    card.querySelectorAll("[data-event-image-alt]").forEach((element) => {
      if (element instanceof HTMLImageElement) {
        element.alt = eventLocalePayload.title ?? "";
      }
    });
  });

  if (updateHistory) {
    const nextUrl = replacePathLocale(locale);
    window.history.pushState({ locale }, "", nextUrl);
  }

  document.dispatchEvent(new CustomEvent("event-filter:updated"));
  document.dispatchEvent(
    new CustomEvent("kyo-locale:updated", { detail: { locale } }),
  );
};

export const initLocaleToggle = () => {
  if (window.__localeToggleBound) return;

  const renderedLocale =
    localeFromPath() ?? normalizeLocale(document.documentElement.lang) ?? "en";
  const initialPreferredLocale =
    getStoredLocale() ?? getBrowserLocale() ?? renderedLocale;

  if (initialPreferredLocale !== renderedLocale && getLocalePayload()) {
    applyLocale(initialPreferredLocale, { updateHistory: true, persist: true });
  } else if (getCookieLocale() !== renderedLocale) {
    setLocale(renderedLocale);
    document.documentElement.dataset.locale = renderedLocale;
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest("[data-locale-option]");
    if (!(button instanceof HTMLElement)) return;

    const nextLocale = normalizeLocale(button.dataset.localeOption);
    if (!nextLocale || nextLocale === getActiveLocale(renderedLocale)) return;

    event.preventDefault();
    if (!getLocalePayload()) {
      setLocale(nextLocale);
      window.location.assign(button.dataset.localeHref || `/${nextLocale}/`);
      return;
    }

    applyLocale(nextLocale);
  });

  window.addEventListener("popstate", () => {
    const pathLocale = localeFromPath();
    if (!pathLocale) return;
    applyLocale(pathLocale, { updateHistory: false, persist: true });
  });

  window.__localeToggleBound = true;
};
