<script lang="ts">
  import { mount, unmount, untrack } from "svelte";
  import DiagramFigure from "./DiagramFigure.svelte";
  import { renderMarkdown, type DiagramBlock } from "../lib/markdown.js";
  import { reveal as revealEl, type SideOutline } from "../lib/ui.js";

  interface Props {
    content: string;
    dark: boolean;
    scrollRoot: HTMLElement;
    onoutline: (outline: SideOutline) => void;
    onactive: (id: string | null) => void;
    onopencanvas: (diagram: DiagramBlock) => void;
    onexport: (svg: SVGSVGElement, suffix: string) => void;
  }

  let { content, dark, scrollRoot, onoutline, onactive, onopencanvas, onexport }: Props = $props();

  let article: HTMLElement | undefined = $state();
  const rendered = $derived(renderMarkdown(content));

  $effect(() => {
    const { outline } = rendered;
    const top = Math.min(...outline.filter((o) => o.kind === "heading").map((o) => o.level), 6);
    const headings = outline.filter((o) => o.kind === "heading").length;
    onoutline({
      sub: `Headings · ${headings}`,
      foot: "Click an item to jump to it.",
      empty: "No headings in this document.",
      items: outline.map((o) => ({
        id: o.id,
        label: o.label,
        level: Math.max(0, o.level - top),
        icon: o.kind === "diagram" ? "◇" : "#",
        mono: o.kind === "diagram",
      })),
    });
  });

  // Embedded diagrams: mount a figure (with its own tools) into each sanitized placeholder.
  $effect(() => {
    const { diagrams } = rendered;
    const isDark = dark;
    if (!article) return;
    const host = article;
    const mounted = untrack(() =>
      diagrams.flatMap((d) => {
        const slot = host.querySelector<HTMLElement>(`#${CSS.escape(d.id)}`);
        if (!slot) return [];
        return [
          mount(DiagramFigure, {
            target: slot,
            props: {
              id: d.id,
              source: d.source,
              keyword: d.keyword,
              dark: isDark,
              onopencanvas: () => onopencanvas(d),
              onexport: (svg: SVGSVGElement) => onexport(svg, d.id),
            },
          }),
        ];
      }),
    );
    return () => mounted.forEach((m) => unmount(m));
  });

  // Active heading tracking: the last outline target above the top of the scroll area.
  $effect(() => {
    const ids = rendered.outline.map((o) => o.id);
    const root = scrollRoot;
    let frame = 0;
    let current: string | null = null;
    const update = () => {
      frame = 0;
      const limit = root.getBoundingClientRect().top + 24;
      let active: string | null = ids[0] ?? null;
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= limit) active = id;
      }
      if (active !== current) {
        current = active;
        onactive(active);
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      root.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  });

  export function reveal(id: string): void {
    revealEl(document.getElementById(id));
  }
</script>

<section aria-label="Markdown document">
  <!-- DOMPurify output only (see lib/markdown.ts). -->
  <article class="md" bind:this={article}>{@html rendered.html}</article>
</section>
