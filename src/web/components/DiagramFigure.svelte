<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { intrinsicSize, renderDiagram } from "../lib/mermaid.js";
  import { mermaidErrorInfo, type MermaidErrorInfo } from "../lib/mermaidInfo.js";

  interface Props {
    id: string;
    source: string;
    keyword: string;
    dark: boolean;
    onopencanvas: (id: string) => void;
    onexport: (svg: SVGSVGElement, id: string) => void;
  }

  let { id, source, keyword, dark, onopencanvas, onexport }: Props = $props();

  let svg = $state<string | null>(null);
  let error = $state<MermaidErrorInfo | null>(null);
  let zoom = $state(1);
  let natural = { width: 0, height: 0 };
  let scrollEl: HTMLDivElement | undefined = $state();
  let svgEl: SVGSVGElement | null = null;
  let seq = 0;

  const clamp = (v: number) => Math.min(3, Math.max(0.25, v));

  async function draw(src: string, isDark: boolean) {
    const mine = ++seq;
    try {
      const out = await renderDiagram(src, isDark);
      if (mine !== seq) return;
      error = null;
      svg = out.svg;
    } catch (e) {
      if (mine !== seq) return;
      svg = null;
      error = mermaidErrorInfo(e);
    }
  }

  $effect(() => {
    draw(source, dark);
  });

  // Mermaid's own SVG output (securityLevel strict) is the only HTML inserted here.
  $effect(() => {
    if (!svg || !scrollEl) return;
    const host = scrollEl;
    untrack(() => {
      svgEl = host.querySelector("svg");
      if (!svgEl) return;
      natural = intrinsicSize(svgEl);
      const room = host.clientWidth - 32;
      zoom = clamp(room > 0 ? Math.min(1, room / natural.width) : 1);
      applyZoom();
    });
  });

  function applyZoom() {
    if (!svgEl) return;
    svgEl.style.width = `${natural.width * zoom}px`;
    svgEl.style.height = `${natural.height * zoom}px`;
  }

  function setZoom(v: number) {
    zoom = clamp(v);
    applyZoom();
  }

  onMount(() => () => {
    seq++;
  });
</script>

<figure class="fig" aria-label="Diagram: {keyword}">
  <div class="fig-bar" role="toolbar" aria-label="Diagram tools">
    <span class="fig-title">mermaid · {keyword}</span>
    {#if svg}
      <button class="btn ghost" type="button" aria-label="Zoom out" onclick={() => setZoom(zoom / 1.25)}>−</button>
      <output aria-live="polite">{Math.round(zoom * 100)}%</output>
      <button class="btn ghost" type="button" aria-label="Zoom in" onclick={() => setZoom(zoom * 1.25)}>+</button>
      <button class="btn ghost" type="button" onclick={() => onopencanvas(id)}>Open in canvas</button>
      <button class="btn ghost" type="button" onclick={() => svgEl && onexport(svgEl, id)}>Export SVG</button>
    {/if}
  </div>
  <div class="fig-scroll" bind:this={scrollEl}>
    {#if svg}
      {@html svg}
    {:else if error}
      <p class="fig-err" role="alert">
        Can’t render this diagram{error.line ? ` — parse error on line ${error.line}` : ""}. The rest of the document is unaffected.
      </p>
      <pre class="fig-err-src">{error.message}</pre>
    {:else}
      <p class="fig-msg">Rendering diagram…</p>
    {/if}
  </div>
</figure>
