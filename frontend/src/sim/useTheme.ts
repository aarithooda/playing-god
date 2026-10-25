// Light/dark theme choice. Dark is the default and is never inferred from the operating system: only an explicit choice
// (stored in this browser) selects light. The choice is applied as `data-theme` on <html>, which index.css turns into the token
// values every component reads through `theme` (components/ui/theme.ts). Storage can be refused (private windows): the
// choice then simply lasts for the page's lifetime.
import { useSyncExternalStore } from "react";

export type ThemeName = "dark" | "light";

export const THEME_STORAGE_KEY = "pg-theme";
export const DEFAULT_THEME: ThemeName = "dark";
const META_COLOR: Record<ThemeName, string> = { dark: "#04060a", light: "#ece8df" };

let current: ThemeName = DEFAULT_THEME;
const listeners = new Set<() => void>();

function isTheme(value: unknown): value is ThemeName {
  return value === "dark" || value === "light";
}

export function readStoredTheme(): ThemeName {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isTheme(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function apply(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR[theme]);
}

/** Applies the stored choice to the page; call once before the first render so there is no flash of the wrong theme. */
export function initTheme(): ThemeName {
  current = readStoredTheme();
  apply(current);
  listeners.forEach((l) => l());
  return current;
}

export function setTheme(theme: ThemeName): void {
  current = theme;
  apply(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* not persisted; the theme still applies for this page */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTheme(): { theme: ThemeName; setTheme: (t: ThemeName) => void; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, () => current, () => DEFAULT_THEME);
  return { theme, setTheme, toggle: () => setTheme(current === "dark" ? "light" : "dark") };
}
