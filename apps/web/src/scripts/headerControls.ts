import {
  fadeIn,
  fadeOut,
  killFadeTransitionTweens,
  setFadeHidden,
  setFadeVisible,
} from '../lib/fadeTransition';
import {
  createHeightTransitionTimeline,
  killHeightTransitionTweens,
  toHeight,
} from '../lib/heightTransition';
import { matchesCategoryGroups } from '../lib/sources';
import { scrollRootFor } from './scrollRoot';

export const initHeaderControls = () => {
  const root = document.querySelector('[data-category-filter]');
  if (!root) return;

  const headerCategoryButtons = Array.from(root.querySelectorAll('[data-category-button]'));
  const categoryButtons = Array.from(document.querySelectorAll('[data-category-button]'));
  const timingButtons = Array.from(root.querySelectorAll('[data-timing-button]'));
  const starredButton = root.querySelector('[data-starred-button]');
  const buttons = [...timingButtons, ...headerCategoryButtons, starredButton].filter(Boolean);
  const disclosure = root.querySelector('[data-filter-disclosure]');
  const filterPanel = root.querySelector('[data-filter-options]');
  const cityDisclosure = root.querySelector('[data-city-disclosure]');
  const cityPanel = root.querySelector('[data-city-options]');
  const cityButtons = Array.from(root.querySelectorAll('[data-city-button]')).filter(
    (button): button is HTMLElement => button instanceof HTMLElement,
  );
  const cards = Array.from(document.querySelectorAll('[data-event-card]'));
  const groups = Array.from(document.querySelectorAll('[data-event-group]'));
  const dividers = Array.from(document.querySelectorAll('[data-event-divider]'));
  const filteredEmptyState = document.querySelector('[data-filter-empty]');
  const mapToggle = root.querySelector('[data-map-toggle]');
  const contentContainer = document.querySelector('[data-content-container]');
  const mapSection = document.querySelector('[data-map-section]');
  const mapResizer = document.querySelector('[data-map-resizer]');
  const eventsSection = document.querySelector('[data-events-section]');
  const mainHeader = root.querySelector('[data-main-header]');

  const activeCategories = new Set(
    categoryButtons
      .filter((button) => button.getAttribute('aria-pressed') === 'true')
      .map((button) => (button instanceof HTMLElement ? button.dataset.category || '' : ''))
      .filter(Boolean),
  );
  let activeTiming = root instanceof HTMLElement ? root.dataset.activeTiming || '' : '';
  let activeStarred = false;
  let filterExpandedScrollOrigin: number | null = null;
  let cityExpandedScrollOrigin: number | null = null;
  const filterButtons = buttons.filter(
    (button): button is HTMLElement => button instanceof HTMLElement,
  );
  const getScrollRoot = () => scrollRootFor(eventsSection) ?? window;
  const getScrollTop = () => {
    const scrollRoot = getScrollRoot();
    return scrollRoot instanceof HTMLElement ? scrollRoot.scrollTop : window.scrollY;
  };
  const getScrollHeight = () => {
    const scrollRoot = getScrollRoot();
    return scrollRoot instanceof HTMLElement ? scrollRoot.clientHeight : window.innerHeight;
  };

  const isDisclosureExpanded = (target: Element | null) =>
    target instanceof HTMLElement && target.getAttribute('aria-expanded') === 'true';
  const isFilterExpanded = () => isDisclosureExpanded(disclosure);
  const isCityExpanded = () => isDisclosureExpanded(cityDisclosure);
  const isFilteringActive = () => Boolean(activeCategories.size || activeTiming || activeStarred);

  const activeCategoriesByDimension = () => {
    const groups = new Map<string, string[]>();
    categoryButtons.forEach((button) => {
      if (!(button instanceof HTMLElement)) return;
      const category = button.dataset.category || '';
      const dimension = button.dataset.categoryDimension || '';
      if (!activeCategories.has(category) || !dimension) return;
      groups.set(dimension, [...(groups.get(dimension) ?? []), category]);
    });
    return groups;
  };

  const syncFilterDisclosureButtonState = () => {
    if (!(disclosure instanceof HTMLElement)) return;

    const isExpanded = isFilterExpanded();
    const filteringActive = isFilteringActive();
    disclosure.setAttribute('aria-pressed', String(isExpanded || filteringActive));
    disclosure.dataset.filteringActive = String(filteringActive);
  };

  const setPanelInteractivity = (
    panel: Element | null,
    panelButtons: HTMLElement[],
    isInteractive: boolean,
  ) => {
    if (!(panel instanceof HTMLElement)) return;

    panel.toggleAttribute('inert', !isInteractive);
    panel.setAttribute('aria-hidden', String(!isInteractive));
    panelButtons.forEach((button) => {
      if (isInteractive) {
        button.removeAttribute('tabindex');
      } else {
        button.setAttribute('tabindex', '-1');
      }
    });
  };

  const animateDisclosure = (
    panel: Element | null,
    panelButtons: HTMLElement[],
    nextExpanded: boolean,
  ) => {
    if (!(panel instanceof HTMLElement)) {
      panel?.toggleAttribute('data-mobile-open', nextExpanded);
      return;
    }

    const startHeight = panel.offsetHeight;

    killHeightTransitionTweens(panel);
    killFadeTransitionTweens(panelButtons);
    panel.style.height = `${startHeight}px`;
    panel.style.overflow = 'hidden';
    panel.toggleAttribute('data-mobile-open', nextExpanded);
    setPanelInteractivity(panel, panelButtons, nextExpanded);
    if (nextExpanded) {
      setFadeHidden(panelButtons);
    } else {
      fadeOut(panelButtons);
    }

    const targetHeight = nextExpanded ? panel.scrollHeight : 0;

    const timeline = createHeightTransitionTimeline({
      onComplete: () => {
        panel.style.height = nextExpanded ? 'auto' : '0px';
        panel.style.overflow = nextExpanded ? '' : 'hidden';
      },
    });

    toHeight(timeline, panel, targetHeight, nextExpanded, 0);
    if (nextExpanded) {
      fadeIn(panelButtons, { delay: 0.06 });
    }
  };

  const setFilterDisclosureExpanded = (nextExpanded: boolean) => {
    if (!(disclosure instanceof HTMLElement)) return;

    disclosure.setAttribute('aria-expanded', String(nextExpanded));
    syncFilterDisclosureButtonState();
    filterExpandedScrollOrigin = nextExpanded ? getScrollTop() : null;
    animateDisclosure(filterPanel, filterButtons, nextExpanded);
  };

  const closeFilterDisclosure = () => {
    if (!isFilterExpanded()) return;

    setFilterDisclosureExpanded(false);
  };

  const syncDisclosurePanelState = (
    targetDisclosure: Element | null,
    panel: Element | null,
    panelButtons: HTMLElement[],
  ) => {
    if (!(panel instanceof HTMLElement) || !(targetDisclosure instanceof HTMLElement)) return;

    killHeightTransitionTweens(panel);

    const isExpanded = targetDisclosure.getAttribute('aria-expanded') === 'true';
    panel.toggleAttribute('data-mobile-open', isExpanded);
    panel.style.height = isExpanded ? 'auto' : '0px';
    panel.style.overflow = isExpanded ? '' : 'hidden';
    if (isExpanded) {
      setFadeVisible(panelButtons);
    } else {
      setFadeHidden(panelButtons);
    }
    setPanelInteractivity(panel, panelButtons, isExpanded);
  };

  const setCityDisclosureExpanded = (nextExpanded: boolean) => {
    if (!(cityDisclosure instanceof HTMLElement)) return;

    cityDisclosure.setAttribute('aria-expanded', String(nextExpanded));
    cityDisclosure.setAttribute('aria-pressed', String(nextExpanded));
    cityExpandedScrollOrigin = nextExpanded ? getScrollTop() : null;
    animateDisclosure(cityPanel, cityButtons, nextExpanded);
  };

  const closeCityDisclosure = () => {
    if (isCityExpanded()) setCityDisclosureExpanded(false);
  };

  const hasStarredCards = () =>
    cards.some((card) => card instanceof HTMLElement && card.dataset.starred === 'true');

  const syncStarredButtonState = () => {
    if (!(starredButton instanceof HTMLElement)) return;

    const hasStars = hasStarredCards();
    starredButton.hidden = !hasStars;
    starredButton.toggleAttribute('inert', !hasStars);
    if (!hasStars) {
      activeStarred = false;
      starredButton.setAttribute('aria-pressed', 'false');
    }
  };

  const applyFilter = () => {
    let visibleCount = 0;
    syncStarredButtonState();
    const activeGroups = activeCategoriesByDimension();

    cards.forEach((card) => {
      const categories = (card.getAttribute('data-categories') || '')
        .split('|')
        .filter(Boolean)
        .map((category) => category.trim());
      const timing =
        card.getAttribute('data-timing') ||
        card.closest('[data-event-group]')?.getAttribute('data-event-group-name') ||
        '';
      const matchesCategory = matchesCategoryGroups(categories, activeGroups);
      const matchesTiming = !activeTiming || timing === activeTiming;
      const matchesStarred =
        !activeStarred || (card instanceof HTMLElement && card.dataset.starred === 'true');
      const matches = matchesCategory && matchesTiming && matchesStarred;

      card.toggleAttribute('hidden', !matches);

      if (matches) visibleCount += 1;
    });

    let visibleGroups = 0;

    groups.forEach((group) => {
      const visibleCards = group.querySelectorAll('[data-event-card]:not([hidden])').length;
      group.toggleAttribute('hidden', visibleCards === 0);

      if (visibleCards > 0) visibleGroups += 1;
    });

    dividers.forEach((divider) => {
      if (!(divider instanceof HTMLElement)) return;

      const beforeGroup = groups.find(
        (group) =>
          group instanceof HTMLElement &&
          group.dataset.eventGroupName === divider.dataset.beforeGroup,
      );
      const afterGroup = groups.find(
        (group) =>
          group instanceof HTMLElement &&
          group.dataset.eventGroupName === divider.dataset.afterGroup,
      );
      const hasVisibleBefore =
        beforeGroup instanceof HTMLElement && !beforeGroup.hasAttribute('hidden');
      const hasVisibleAfter =
        afterGroup instanceof HTMLElement && !afterGroup.hasAttribute('hidden');

      divider.toggleAttribute('hidden', visibleGroups < 2 || !hasVisibleBefore || !hasVisibleAfter);
    });

    if (filteredEmptyState) {
      filteredEmptyState.toggleAttribute('hidden', visibleCount > 0 || !isFilteringActive());
    }

    syncFilterDisclosureButtonState();
    document.dispatchEvent(new CustomEvent('event-filter:updated'));
  };

  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (!(button instanceof HTMLElement)) return;
      const nextCategory = button.dataset.category || '';
      if (activeCategories.has(nextCategory)) {
        activeCategories.delete(nextCategory);
      } else {
        activeCategories.add(nextCategory);
      }
      activeStarred = false;
      if (starredButton instanceof HTMLElement) {
        starredButton.setAttribute('aria-pressed', 'false');
      }

      button.setAttribute('aria-pressed', String(activeCategories.has(nextCategory)));

      applyFilter();
    });
  });

  timingButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (!(button instanceof HTMLElement)) return;
      const nextTiming = button.dataset.timing || '';
      activeTiming = activeTiming === nextTiming ? '' : nextTiming;
      activeStarred = false;
      if (starredButton instanceof HTMLElement) {
        starredButton.setAttribute('aria-pressed', 'false');
      }

      timingButtons.forEach((item) => {
        if (!(item instanceof HTMLElement)) return;
        const isActive = item.dataset.timing === activeTiming;
        item.setAttribute('aria-pressed', String(isActive));
      });

      applyFilter();
    });
  });

  if (starredButton instanceof HTMLElement) {
    starredButton.addEventListener('click', () => {
      if (starredButton.hidden) return;

      activeStarred = !activeStarred;
      starredButton.setAttribute('aria-pressed', String(activeStarred));
      if (activeStarred) {
        activeCategories.clear();
        activeTiming = '';
        categoryButtons.forEach((item) => {
          if (item instanceof HTMLElement) item.setAttribute('aria-pressed', 'false');
        });
        timingButtons.forEach((item) => {
          if (item instanceof HTMLElement) item.setAttribute('aria-pressed', 'false');
        });
      }
      applyFilter();
    });
  }

  document.addEventListener('event-stars:updated', applyFilter);
  syncStarredButtonState();

  if (disclosure && filterPanel) {
    syncDisclosurePanelState(disclosure, filterPanel, filterButtons);
    filterExpandedScrollOrigin = isFilterExpanded() ? getScrollTop() : null;

    disclosure.addEventListener('click', () => {
      const nextExpanded = !isFilterExpanded();
      if (nextExpanded) closeCityDisclosure();
      setFilterDisclosureExpanded(nextExpanded);
    });
  }

  if (cityDisclosure && cityPanel) {
    syncDisclosurePanelState(cityDisclosure, cityPanel, cityButtons);
    cityExpandedScrollOrigin = isCityExpanded() ? getScrollTop() : null;

    cityDisclosure.addEventListener('click', () => {
      const nextExpanded = !isCityExpanded();
      if (nextExpanded) closeFilterDisclosure();
      setCityDisclosureExpanded(nextExpanded);
    });
  }

  syncFilterDisclosureButtonState();

  const setMapVisible = (nextVisible: boolean) => {
    if (!(contentContainer instanceof HTMLElement) || !(mapSection instanceof HTMLElement)) return;

    const isVisible = contentContainer.hasAttribute('data-map-visible');
    if (isVisible === nextVisible) return;

    if (nextVisible) {
      mapSection.hidden = false;
      if (mapResizer instanceof HTMLElement) {
        mapResizer.hidden = false;
        mapResizer.removeAttribute('inert');
      }
      mapSection.removeAttribute('data-map-closing');
      mapSection.removeAttribute('inert');

      window.requestAnimationFrame(() => {
        contentContainer.toggleAttribute('data-map-visible', true);
      });
    } else {
      mapSection.toggleAttribute('data-map-closing', true);
      contentContainer.toggleAttribute('data-map-visible', false);
      mapSection.toggleAttribute('inert', true);
      if (mapResizer instanceof HTMLElement) {
        mapResizer.toggleAttribute('inert', true);
        mapResizer.hidden = true;
      }

      const hideAfterTransition = (event: Event) => {
        if (event.target !== mapSection) return;
        if (contentContainer.hasAttribute('data-map-visible')) {
          mapSection.removeEventListener('transitionend', hideAfterTransition);
          return;
        }

        mapSection.hidden = true;
        mapSection.removeAttribute('data-map-closing');
        mapSection.removeEventListener('transitionend', hideAfterTransition);
      };

      mapSection.addEventListener('transitionend', hideAfterTransition);
      window.setTimeout(() => {
        if (!contentContainer.hasAttribute('data-map-visible')) {
          mapSection.hidden = true;
          mapSection.removeAttribute('data-map-closing');
          mapSection.removeEventListener('transitionend', hideAfterTransition);
        }
      }, 360);
    }

    mapSection.toggleAttribute('inert', !nextVisible);
    if (mapResizer instanceof HTMLElement) {
      mapResizer.toggleAttribute('inert', !nextVisible);
      mapResizer.hidden = !nextVisible;
    }

    if (mapToggle instanceof HTMLElement) {
      mapToggle.setAttribute('aria-pressed', String(nextVisible));
      mapToggle.setAttribute('aria-expanded', String(nextVisible));
    }

    if (nextVisible) {
      window.setTimeout(() => {
        document.dispatchEvent(new CustomEvent('map-layout:updated'));
        window.dispatchEvent(new Event('resize'));
      }, 280);
    }
  };

  if (mapToggle instanceof HTMLElement) {
    mapSection?.toggleAttribute('inert', true);
    mapToggle.addEventListener('click', () => {
      const nextVisible = !(
        contentContainer instanceof HTMLElement && contentContainer.hasAttribute('data-map-visible')
      );
      closeFilterDisclosure();
      closeCityDisclosure();
      setMapVisible(nextVisible);
    });
  }

  const stickyOffset = () => {
    const pagePaddingY = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--page-padding-y'),
    );
    return Number.isFinite(pagePaddingY) ? pagePaddingY : 0;
  };

  const syncStickyState = () => {
    if (!(mainHeader instanceof HTMLElement)) return;
    const scrollRoot = getScrollRoot();
    const scrollRootTop =
      scrollRoot instanceof HTMLElement ? scrollRoot.getBoundingClientRect().top : 0;
    const isStuck = mainHeader.getBoundingClientRect().top <= scrollRootTop + stickyOffset() + 0.5;
    mainHeader.toggleAttribute('data-stuck', isStuck);
  };

  const maybeCloseDisclosuresOnScroll = () => {
    const scrollTop = getScrollTop();
    const threshold = getScrollHeight() * 0.5;
    if (
      filterExpandedScrollOrigin !== null &&
      Math.abs(scrollTop - filterExpandedScrollOrigin) > threshold
    )
      closeFilterDisclosure();
    if (
      cityExpandedScrollOrigin !== null &&
      Math.abs(scrollTop - cityExpandedScrollOrigin) > threshold
    )
      closeCityDisclosure();
  };

  syncStickyState();
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Node)) return;
    if (root.contains(event.target)) return;

    closeFilterDisclosure();
    closeCityDisclosure();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;

    closeFilterDisclosure();
    closeCityDisclosure();
    setMapVisible(false);
    document.dispatchEvent(new CustomEvent('event-card:deactivate-all'));
  });
  getScrollRoot().addEventListener('scroll', syncStickyState, {
    passive: true,
  });
  getScrollRoot().addEventListener('scroll', maybeCloseDisclosuresOnScroll, {
    passive: true,
  });
  window.addEventListener('resize', syncStickyState);
};
