import assert from "node:assert/strict";
import test from "node:test";

import {
  CITY_SWITCH_TRANSITION_MS,
  createCitySwitchNavigationPlan,
} from "../src/scripts/citySwitch.ts";

test("city switch plan delays same-origin navigations for theme transition", () => {
  const plan = createCitySwitchNavigationPlan({
    buttonHref: "/osaka/en/",
    buttonThemeColor: "#7d4cff",
    currentOrigin: "https://example.test",
    event: { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
  });

  assert.deepEqual(plan, {
    href: "https://example.test/osaka/en/",
    themeColor: "#7d4cff",
    delayMs: CITY_SWITCH_TRANSITION_MS,
  });
});

test("city switch plan ignores modified or external navigations", () => {
  assert.equal(
    createCitySwitchNavigationPlan({
      buttonHref: "/tokyo/en/",
      buttonThemeColor: "#006fd6",
      currentOrigin: "https://example.test",
      event: { button: 0, metaKey: true, ctrlKey: false, shiftKey: false, altKey: false },
    }),
    null,
  );

  assert.equal(
    createCitySwitchNavigationPlan({
      buttonHref: "https://other.test/tokyo/en/",
      buttonThemeColor: "#006fd6",
      currentOrigin: "https://example.test",
      event: { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false },
    }),
    null,
  );
});
