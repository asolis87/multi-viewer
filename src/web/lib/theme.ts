export type ThemeChoice = "system" | "light" | "dark";

export const THEME_OPTIONS: readonly { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** System follows `prefers-color-scheme`; Light and Dark override it. */
export function resolveDark(choice: ThemeChoice, systemDark: boolean): boolean {
  return choice === "system" ? systemDark : choice === "dark";
}

/**
 * Apply the choice to the document root. A manual choice sets `data-theme`, which the
 * stylesheet uses instead of the media query; System removes it. Never persisted (S8, L11).
 */
export function applyTheme(choice: ThemeChoice, root: HTMLElement): void {
  if (choice === "system") {
    root.removeAttribute("data-theme");
    root.style.colorScheme = "";
  } else {
    root.dataset.theme = choice;
    root.style.colorScheme = choice;
  }
}
