import type { Mermaid } from "mermaid";

let loaded: Promise<Mermaid> | null = null;
let currentTheme: "dark" | "default" | null = null;
let counter = 0;

/** Mermaid is loaded lazily (its own chunk) and only when a diagram is shown. */
function load(): Promise<Mermaid> {
  loaded ??= import("mermaid").then((m) => m.default);
  return loaded;
}

function configure(mermaid: Mermaid, dark: boolean): void {
  const theme = dark ? "dark" : "default";
  if (theme === currentTheme) return;
  currentTheme = theme;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  });
}

export interface RenderedDiagram {
  svg: string;
  diagramType: string;
}

/** Parse then render. Throws the parser error so callers can show line information. */
export async function renderDiagram(source: string, dark: boolean): Promise<RenderedDiagram> {
  const mermaid = await load();
  configure(mermaid, dark);
  const id = `mview-mermaid-${++counter}`;
  try {
    await mermaid.parse(source);
    const { svg, diagramType } = await mermaid.render(id, source);
    return { svg, diagramType };
  } finally {
    // Mermaid can leave its temporary container behind when rendering fails.
    document.getElementById(`d${id}`)?.remove();
  }
}

/**
 * Give an inserted Mermaid SVG its intrinsic size (Mermaid sets width="100%" and a
 * max-width) so the canvas and inline zoom can scale it explicitly. Returns the size.
 */
export function intrinsicSize(svg: SVGSVGElement): { width: number; height: number } {
  const box = svg.viewBox?.baseVal;
  let width = box?.width ?? 0;
  let height = box?.height ?? 0;
  if (!width || !height) {
    const r = svg.getBBox();
    width = r.width || 600;
    height = r.height || 400;
  }
  svg.removeAttribute("style");
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  return { width, height };
}
