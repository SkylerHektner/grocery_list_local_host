// Light/dark theme (SPEC §3.11). Light is the default whatever the OS prefers; the header button
// switches to dark and back. The choice is per device (localStorage) and applied as
// <html data-theme="dark">, which app.css keys the dark palette on. An inline script in
// index.html applies a stored "dark" before the stylesheet paints (no light flash).
//
//   bindThemeToggle(button)   wire the header button (aria-pressed = dark is on)

export const THEME_KEY = 'grocery-theme';
const THEME_COLORS = { light: '#f6f2e9', dark: '#1b1a17' };

/**
 * The stored theme; 'light' when nothing (or junk) is stored or storage is unavailable.
 * @param {{getItem(key: string): string | null} | null | undefined} storage
 * @returns {'light' | 'dark'}
 */
export function readTheme(storage) {
  try {
    return storage?.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Stores `theme`; light is the default, so it is stored as "no entry".
 * @param {{setItem(key: string, value: string): void, removeItem(key: string): void} | null | undefined} storage
 * @param {'light' | 'dark'} theme
 */
export function writeTheme(storage, theme) {
  try {
    if (theme === 'dark') storage?.setItem(THEME_KEY, 'dark');
    else storage?.removeItem(THEME_KEY);
  } catch {
    // Private mode / blocked storage: the theme still applies until the page reloads.
  }
}

/** @param {'light' | 'dark'} theme */
export function otherTheme(theme) {
  return theme === 'dark' ? 'light' : 'dark';
}

function storage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** @param {'light' | 'dark'} theme */
function applyTheme(theme, button) {
  const root = document.documentElement;
  if (theme === 'dark') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
  const dark = theme === 'dark';
  button.setAttribute('aria-pressed', String(dark));
  button.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
}

/** @param {HTMLButtonElement} button */
export function bindThemeToggle(button) {
  let theme = readTheme(storage());
  applyTheme(theme, button);
  button.addEventListener('click', () => {
    theme = otherTheme(theme);
    writeTheme(storage(), theme);
    applyTheme(theme, button);
  });
}
