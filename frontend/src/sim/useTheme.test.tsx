import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle } from "../components/ui/ToolRail";
import { DEFAULT_THEME, initTheme, readStoredTheme, setTheme, THEME_STORAGE_KEY } from "./useTheme";

const root = () => document.documentElement;

beforeEach(() => {
  window.localStorage.clear();
  delete root().dataset.theme;
});
afterEach(() => {
  vi.restoreAllMocks();
  act(() => initTheme());
});

describe("theme choice", () => {
  it("is dark by default and does not follow the operating system", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((q) => ({ matches: q.includes("light"), media: q } as MediaQueryList));
    expect(DEFAULT_THEME).toBe("dark");
    expect(initTheme()).toBe("dark");
    expect(root().dataset.theme).toBe("dark");
  });

  it("restores a stored light choice before the first render", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(initTheme()).toBe("light");
    expect(root().dataset.theme).toBe("light");
  });

  it("falls back to dark for a stored value it does not know", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readStoredTheme()).toBe("dark");
    expect(initTheme()).toBe("dark");
  });

  it("still switches for the page when storage refuses reads and writes", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(initTheme()).toBe("dark");
    act(() => setTheme("light"));
    expect(root().dataset.theme).toBe("light");
  });
});

describe("theme toggle", () => {
  it("switches the whole page and remembers the choice, in both directions", () => {
    act(() => initTheme());
    render(<ThemeToggle />);
    const button = screen.getByTestId("theme-toggle");
    expect(button.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(button);
    expect(root().dataset.theme).toBe("light");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(button.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(button);
    expect(root().dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});

describe("theme tokens", () => {
  it("every colour the UI reads is a CSS variable defined for both themes", async () => {
    const nodeFs = "node:fs"; // a variable specifier: the app's tsconfig has no Node types, and vitest strips CSS imports
    const fs = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync: (p: string, enc: string) => string };
    const css = fs.readFileSync("src/index.css", "utf8") // vitest runs from frontend/;
    const { theme } = await import("../components/ui/theme");
    const dark = css.slice(css.indexOf(":root {"), css.indexOf(':root[data-theme="light"]'));
    const light = css.slice(css.indexOf(':root[data-theme="light"]'), css.indexOf("* {"));
    const colourKeys = Object.entries(theme).filter(([, v]) => typeof v === "string" && v.startsWith("var(")).map(([, v]) => (v as string).slice(4, -1));
    expect(colourKeys.length).toBeGreaterThan(20);
    for (const name of colourKeys) {
      expect(dark, `dark defines ${name}`).toContain(`${name}:`);
      expect(light, `light defines ${name}`).toContain(`${name}:`);
    }
  });
});
