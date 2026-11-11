<script lang="ts">
  import { untrack } from "svelte";
  import { intrinsicSize } from "../lib/mermaid.js";

  interface Props {
    /** Mermaid's own SVG output (securityLevel strict). */
    svg: string;
    label: string;
    onzoom: (pct: number) => void;
    onexport: (svg: SVGSVGElement) => void;
    onback?: () => void;
  }

  let { svg, label, onzoom, onexport, onback }: Props = $props();

  let canvas: HTMLDivElement | undefined = $state();
  let viewport: HTMLDivElement | undefined = $state();
  let zoom = $state(1);
  let tx = $state(0);
  let ty = $state(0);
  let dragging = $state(false);
  let size = { width: 0, height: 0 };
  let autoFit = true;
  let drag: { x: number; y: number } | null = null;

  const clamp = (v: number) => Math.min(4, Math.max(0.1, v));

  $effect(() => onzoom(Math.round(zoom * 100)));

  // Size the inserted SVG; fit on first render, keep the user's view across live reloads.
  $effect(() => {
    void svg;
    if (!viewport) return;
    const host = viewport;
    untrack(() => {
      const el = host.querySelector("svg");
      if (!el) return;
      size = intrinsicSize(el);
      if (autoFit) fit();
    });
  });

  $effect(() => {
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      if (autoFit) fit();
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  function rect() {
    return canvas?.getBoundingClientRect() ?? new DOMRect();
  }

  function zoomAt(factor: number, cx: number, cy: number) {
    autoFit = false;
    const next = clamp(zoom * factor);
    const k = next / zoom;
    tx = cx - (cx - tx) * k;
    ty = cy - (cy - ty) * k;
    zoom = next;
  }

  function zoomCenter(factor: number) {
    const r = rect();
    zoomAt(factor, r.width / 2, r.height / 2);
  }

  /** Fit the diagram into the canvas; re-fits on resize until the user pans or zooms. */
  export function fit() {
    const r = rect();
    if (!r.width || !size.width) return;
    autoFit = true;
    zoom = clamp(Math.min((r.width - 96) / size.width, (r.height - 120) / size.height, 2));
    tx = (r.width - size.width * zoom) / 2;
    ty = (r.height - size.height * zoom) / 2;
  }

  function actualSize() {
    zoomCenter(1 / zoom);
  }

  /** Center and highlight the first node whose text matches `text` (outline click). */
  export function focusLabel(text: string): boolean {
    if (!viewport || !canvas) return false;
    viewport.querySelectorAll(".mview-hl").forEach((n) => n.classList.remove("mview-hl"));
    const candidates = viewport.querySelectorAll<Element>("text, tspan, span, p, div");
    const match = [...candidates].find((n) => n.children.length === 0 && n.textContent?.trim() === text);
    if (!match) return false;
    const group = match.closest("g.node, g.actor, g[class*='actor'], g") ?? match;
    group.classList.add("mview-hl");
    const box = match.getBoundingClientRect();
    const r = rect();
    autoFit = false;
    tx += r.left + r.width / 2 - (box.left + box.width / 2);
    ty += r.top + r.height / 2 - (box.top + box.height / 2);
    canvas.focus({ preventScroll: true });
    return true;
  }

  function onWheel(e: WheelEvent) {
    if ((e.target as Element).closest(".cv-tools, .cv-hint, .cv-back")) return;
    e.preventDefault();
    const r = rect();
    zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
  }

  function onPointerDown(e: PointerEvent) {
    if ((e.target as Element).closest(".cv-tools, .cv-hint, .cv-back") || e.button !== 0) return;
    drag = { x: e.clientX, y: e.clientY };
    canvas?.setPointerCapture(e.pointerId);
    dragging = true;
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    autoFit = false;
    tx += e.clientX - drag.x;
    ty += e.clientY - drag.y;
    drag = { x: e.clientX, y: e.clientY };
  }

  function endDrag() {
    drag = null;
    dragging = false;
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.target !== canvas || e.metaKey || e.ctrlKey || e.altKey) return;
    const step = 48;
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    const move = pan[e.key];
    if (move) {
      autoFit = false;
      tx += move[0];
      ty += move[1];
    } else if (e.key === "+" || e.key === "=") zoomCenter(1.25);
    else if (e.key === "-" || e.key === "_") zoomCenter(1 / 1.25);
    else if (e.key === "0") fit();
    else if (e.key === "Escape" && onback) onback();
    else return;
    e.preventDefault();
  }

  function exportCurrent() {
    const el = viewport?.querySelector("svg");
    if (el) onexport(el);
  }
</script>

<!-- The canvas is a single keyboard-operable widget (pan with arrows, zoom with +/−/0). -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<div
  class="canvas"
  class:dragging
  bind:this={canvas}
  tabindex="0"
  role="application"
  aria-roledescription="diagram canvas"
  aria-label="{label}. Drag or use arrow keys to pan, scroll or plus and minus to zoom, 0 to fit."
  aria-describedby="cv-hint"
  style:background-position="{tx}px {ty}px"
  style:background-size="{16 * zoom}px {16 * zoom}px"
  onwheel={onWheel}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={endDrag}
  onpointercancel={endDrag}
  onkeydown={onKeydown}
>
  <div class="viewport" bind:this={viewport} style:transform="translate({tx}px, {ty}px) scale({zoom})">
    {@html svg}
  </div>
  {#if onback}
    <button class="btn cv-back" type="button" onclick={onback}>← Back to document</button>
  {/if}
  <div class="cv-tools" role="toolbar" aria-label="Diagram controls">
    <button class="btn ghost" type="button" aria-label="Zoom out" onclick={() => zoomCenter(1 / 1.25)}>−</button>
    <output aria-live="polite">{Math.round(zoom * 100)}%</output>
    <button class="btn ghost" type="button" aria-label="Zoom in" onclick={() => zoomCenter(1.25)}>+</button>
    <button class="btn ghost" type="button" onclick={() => fit()}>Fit</button>
    <button class="btn ghost" type="button" onclick={actualSize}>100%</button>
    <span class="sep" aria-hidden="true"></span>
    <button class="btn" type="button" onclick={exportCurrent}>Export SVG</button>
  </div>
  <div class="cv-hint" id="cv-hint">Drag to pan · Scroll to zoom · <kbd>0</kbd> fits</div>
</div>
