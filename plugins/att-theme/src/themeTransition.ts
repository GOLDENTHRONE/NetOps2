// Circular "reveal" animation for theme switches, using the View Transitions API.
// Falls back to an instant theme swap when the API or reduced-motion isn't available.
import { flushSync } from 'react-dom';

type TransitionOrigin = {
  x: number;
  y: number;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (updateCallback: () => void) => unknown;
};

const STYLE_ID = 'att-theme-transition-styles';

// Injects the keyframes + ::view-transition-new(root) rule once per page load.
function ensureTransitionStylesInjected(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
@keyframes att-theme-reveal {
  to {
    clip-path: circle(var(--att-theme-transition-radius) at var(--att-theme-transition-origin-x) var(--att-theme-transition-origin-y));
  }
}
@supports (view-transition-name: root) {
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation: none;
    mix-blend-mode: normal;
  }
  ::view-transition-new(root) {
    clip-path: circle(0 at var(--att-theme-transition-origin-x) var(--att-theme-transition-origin-y));
    animation: att-theme-reveal 340ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
}
`;
  document.head.appendChild(style);
}

const hasBrowserApis = (): boolean =>
  typeof window !== 'undefined' && typeof document !== 'undefined';

const prefersReducedMotion = (): boolean => {
  if (!hasBrowserApis() || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
};

const clampToViewport = (origin: TransitionOrigin): TransitionOrigin => ({
  x: Math.min(Math.max(origin.x, 0), window.innerWidth),
  y: Math.min(Math.max(origin.y, 0), window.innerHeight),
});

const computeRevealRadius = (origin: TransitionOrigin): number => {
  const maxX = Math.max(origin.x, window.innerWidth - origin.x);
  const maxY = Math.max(origin.y, window.innerHeight - origin.y);
  return Math.hypot(maxX, maxY);
};

const setTransitionCssVars = (origin: TransitionOrigin): void => {
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--att-theme-transition-origin-x', `${origin.x}px`);
  rootStyle.setProperty('--att-theme-transition-origin-y', `${origin.y}px`);
  rootStyle.setProperty('--att-theme-transition-radius', `${computeRevealRadius(origin)}px`);
};

export const getViewportPointFromElement = (element: Element | null): TransitionOrigin | null => {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
};

export const runThemeModeTransition = (
  applyThemeChange: () => void,
  options?: {
    origin?: TransitionOrigin | null;
    reduceMotion?: boolean;
  }
): void => {
  if (!hasBrowserApis()) {
    applyThemeChange();
    return;
  }

  ensureTransitionStylesInjected();

  const skipAnimation = options?.reduceMotion || prefersReducedMotion() || window.innerWidth <= 0;
  const transitionDoc = document as ViewTransitionDocument;

  if (skipAnimation || typeof transitionDoc.startViewTransition !== 'function') {
    applyThemeChange();
    return;
  }

  const fallbackOrigin: TransitionOrigin = {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  };

  try {
    const origin = clampToViewport(options?.origin ?? fallbackOrigin);
    setTransitionCssVars(origin);
    transitionDoc.startViewTransition(() => {
      flushSync(() => {
        applyThemeChange();
      });
    });
  } catch {
    applyThemeChange();
  }
};
