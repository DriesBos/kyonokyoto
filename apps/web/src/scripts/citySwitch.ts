export const CITY_SWITCH_SKIP_LANDING_KEY = "kyo_skip_landing_once";
export const CITY_SWITCH_TRANSITION_MS = 330;

const cityToggleSelector = "[data-city-toggle]";
const transitionStyleId = "city-switch-color-transition";

type CitySwitchClick = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
};

type CitySwitchPlanInput = {
  buttonHref: string | null | undefined;
  buttonThemeColor: string | null | undefined;
  currentOrigin: string;
  event: CitySwitchClick;
};

type CitySwitchNavigationPlan = {
  href: string;
  themeColor: string;
  delayMs: number;
};

declare global {
  interface Window {
    __citySwitchBound?: boolean;
  }
}

export function createCitySwitchNavigationPlan({
  buttonHref,
  buttonThemeColor,
  currentOrigin,
  event,
}: CitySwitchPlanInput): CitySwitchNavigationPlan | null {
  if (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey ||
    !buttonHref ||
    !buttonThemeColor
  ) {
    return null;
  }

  const url = new URL(buttonHref, currentOrigin);
  if (url.origin !== currentOrigin) return null;

  return {
    href: url.href,
    themeColor: buttonThemeColor,
    delayMs: CITY_SWITCH_TRANSITION_MS,
  };
}

function ensureTransitionStyle() {
  if (document.getElementById(transitionStyleId)) return;

  const style = document.createElement("style");
  style.id = transitionStyleId;
  style.textContent = `
    html[data-city-switching] *,
    html[data-city-switching] *::before,
    html[data-city-switching] *::after,
    html[data-city-switching] svg,
    html[data-city-switching] svg * {
      transition-property: color, background-color, border-color, fill, stroke, box-shadow !important;
      transition-duration: ${CITY_SWITCH_TRANSITION_MS}ms !important;
      transition-timing-function: ease !important;
    }
  `;
  document.head.append(style);
}

function setSkipLandingFlag() {
  try {
    window.sessionStorage?.setItem(CITY_SWITCH_SKIP_LANDING_KEY, "1");
  } catch {
    // Navigation still works when sessionStorage is unavailable.
  }
}

function startThemeTransition(themeColor: string) {
  ensureTransitionStyle();
  document.documentElement.setAttribute("data-city-switching", "");
  document.documentElement.getBoundingClientRect();
  document.documentElement.style.setProperty("--color-green", themeColor);
}

export function initCitySwitch() {
  if (window.__citySwitchBound) return;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const toggle = target.closest(cityToggleSelector);
    if (!(toggle instanceof HTMLAnchorElement)) return;

    const plan = createCitySwitchNavigationPlan({
      buttonHref: toggle.getAttribute("href"),
      buttonThemeColor: toggle.dataset.cityThemeColor,
      currentOrigin: window.location.origin,
      event,
    });

    if (!plan) return;

    event.preventDefault();
    setSkipLandingFlag();
    startThemeTransition(plan.themeColor);
    window.setTimeout(() => {
      window.location.assign(plan.href);
    }, plan.delayMs);
  });

  window.__citySwitchBound = true;
}
