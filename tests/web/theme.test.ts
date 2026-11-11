// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyTheme, resolveDark, THEME_OPTIONS } from "../../src/web/lib/theme.js";

describe("theme", () => {
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

  it("is not persisted between page loads", () => {
    applyTheme("dark", document.documentElement);
    expect(localStorage.length).toBe(0);
  });
});
