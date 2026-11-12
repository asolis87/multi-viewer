/** Small UI contracts shared by the shell (App) and the views. */
import type { DocType } from "./doc.js";

export interface SideItem {
  id: string;
  label: string;
  /** Indentation level, 0 = top. */
  level: number;
  icon: string;
  mono?: boolean;
  meta?: string | null;
}

export interface SideOutline {
  sub: string;
  foot: string;
  items: SideItem[];
  /** Shown when there are no items. */
  empty: string;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function prefersReducedMotion(): boolean {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Scroll an element into view and move focus to it without a second scroll. */
export function reveal(el: HTMLElement | null, block: ScrollLogicalPosition = "start"): void {
  if (!el) return;
  el.scrollIntoView({ block, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}

export function themeBackground(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#ffffff";
}

/**
 * CSV documents get a collapsible outline on wide screens (S13, L38): closed on load and
 * toggled by the toolbar's Outline button. Other types keep the always-visible sidebar.
 */
export function collapsibleOutline(type: DocType): boolean {
  return type === "csv";
}
