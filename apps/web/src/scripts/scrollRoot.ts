export const isElementScrollable = (element: HTMLElement) => {
  const overflowY = getComputedStyle(element).overflowY;
  if (overflowY === 'visible' || overflowY === 'clip') return false;
  return element.scrollHeight > element.clientHeight + 1;
};

export const scrollRootFor = (element: Element | null) => {
  const root = element?.closest('[data-events-section]');
  return root instanceof HTMLElement && isElementScrollable(root) ? root : null;
};
