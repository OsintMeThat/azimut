/**
 * Light / dark theme. The whole UI reads design tokens (app.css), so a theme is
 * just which palette those tokens resolve to: we stamp `data-theme` on the root
 * element and the CSS does the rest.
 *
 * Dark is the default — the app was built for it, and existing users should see
 * no change until they flip the switch. The choice survives reloads via
 * localStorage; a missing or garbage value falls back to dark.
 */

export const THEMES = ['dark', 'light'];
export const DEFAULT_THEME = 'dark';

const KEY = 'azimut:theme';

/** Snap anything — stored, passed, or garbage — to a known theme. */
export function normalizeTheme(t) {
  return THEMES.includes(t) ? t : DEFAULT_THEME;
}

export function loadTheme() {
  try {
    return normalizeTheme(localStorage.getItem(KEY));
  } catch {
    return DEFAULT_THEME; // localStorage unavailable (private mode) — non-fatal
  }
}

export function saveTheme(t) {
  try {
    localStorage.setItem(KEY, normalizeTheme(t));
  } catch {
    /* ignore */
  }
}

/** Stamp the theme onto <html> so the token overrides in app.css take effect. */
export function applyTheme(t) {
  document.documentElement.dataset.theme = normalizeTheme(t);
}
