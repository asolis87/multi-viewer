// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme, resolveDark, THEME_OPTIONS } from "../../src/web/lib/theme.js";

describe("theme", () => {
  afterEach(() => {
    // Each test starts from a page with no manual theme (T22: no state shared between tests).
    applyTheme("system", document.documentElement);
    vi.restoreAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("offers System, Light and Dark, defaulting to System", () => {
    expect(THEME_OPTIONS).toEqual([
      { value: "system", label: "System" },
      { value: "light", label: "Light" },
      { value: "dark", label: "Dark" },
    ]);
  });

  it("System follows prefers-color-scheme; Light and Dark override it", () => {
    expect(resolveDark("system", true)).toBe(true);
    expect(resolveDark("system", false)).toBe(false);
    expect(resolveDark("light", true)).toBe(false);
    expect(resolveDark("dark", false)).toBe(true);
  });

  it("applyTheme sets data-theme only for a manual choice", () => {
    const root = document.documentElement;
    applyTheme("dark", root);
    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    applyTheme("light", root);
    expect(root.dataset.theme).toBe("light");
    expect(root.style.colorScheme).toBe("light");
    applyTheme("system", root);
    expect(root.dataset.theme).toBeUndefined();
    expect(root.style.colorScheme).toBe("");
  });

  it("is not persisted between page loads (no storage writes, no cookies)", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const cookieBefore = document.cookie;
    for (const choice of ["dark", "light", "system"] as const) applyTheme(choice, document.documentElement);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe(cookieBefore);
  });
});
