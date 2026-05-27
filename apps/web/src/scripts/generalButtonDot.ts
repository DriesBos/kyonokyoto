const buttonSelector = ".general-button";
const dotSelector = ".general-button__dot";

const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

const setOrganicDotShape = (target: HTMLElement) => {
  const variant = Math.floor(Math.random() * 3) + 1;
  target.style.setProperty("--dot-mask", `var(--dot-mask-${variant})`);
  target.style.setProperty(
    "--dot-rotation",
    `${randomBetween(-18, 18).toFixed(2)}deg`,
  );
  target.style.setProperty(
    "--dot-scale-x",
    randomBetween(0.94, 1.06).toFixed(3),
  );
  target.style.setProperty(
    "--dot-scale-y",
    randomBetween(0.96, 1.08).toFixed(3),
  );
};

const setButtonDotPosition = (
  button: HTMLElement,
  clientX: number,
  clientY: number,
) => {
  const rect = button.getBoundingClientRect();
  button.style.setProperty(
    "--general-button-dot-left",
    `${clientX - rect.left - button.clientLeft}px`,
  );
  button.style.setProperty(
    "--general-button-dot-top",
    `${clientY - rect.top - button.clientTop}px`,
  );
  setOrganicDotShape(button);
};

export const initGeneralButtonDot = () => {
  if (window.__generalButtonDotBound) return;

  document.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest(buttonSelector);
    if (!(button instanceof HTMLElement)) return;
    if (!button.querySelector(dotSelector)) return;

    setButtonDotPosition(button, event.clientX, event.clientY);
  });

  window.__generalButtonDotBound = true;
};
