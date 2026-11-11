<script lang="ts">
  import { onDestroy } from "svelte";
  import MermaidCanvas from "./MermaidCanvas.svelte";
  import MermaidError from "./MermaidError.svelte";
  import { renderDiagram } from "../lib/mermaid.js";
  import { diagramKeyword, mermaidErrorInfo, mermaidOutline, type MermaidErrorInfo } from "../lib/mermaidInfo.js";
  import type { SideOutline } from "../lib/ui.js";

  interface Props {
    source: string;
    name: string;
    dark: boolean;
    watching: boolean;
    onoutline: (outline: SideOutline) => void;
    onstatus: (text: string | null) => void;
    onzoom: (pct: number | null) => void;
    oncopy: (text: string, label: string) => void;
    onexport: (svg: SVGSVGElement) => void;
    onback?: () => void;
  }

  let { source, name, dark, watching, onoutline, onstatus, onzoom, oncopy, onexport, onback }: Props = $props();

  type Result = { kind: "loading" } | { kind: "ok"; svg: string } | { kind: "error"; info: MermaidErrorInfo };
  let result = $state<Result>({ kind: "loading" });
  let canvas: MermaidCanvas | undefined = $state();
  let errorView: MermaidError | undefined = $state();
  let seq = 0;

  $effect(() => {
    const src = source;
    const isDark = dark;
    const mine = ++seq;
    renderDiagram(src, isDark).then(
      (out) => {
        if (mine === seq) result = { kind: "ok", svg: out.svg };
      },
      (e) => {
        if (mine === seq) result = { kind: "error", info: mermaidErrorInfo(e) };
      },
    );
  });

  $effect(() => {
    if (result.kind === "error") {
      const line = result.info.line;
      onstatus(`Mermaid · parse error${line ? ` (line ${line})` : ""}`);
      onzoom(null);
      onoutline({
        sub: "Diagram did not parse",
        foot: "Fix the source; the outline returns when the diagram parses.",
        empty: "",
        items: [{ id: "error-line", label: line ? `Line ${line} · parse error` : "Parse error", level: 0, icon: "!" }],
      });
      return;
    }
    onstatus(null);
    const outline = result.kind === "ok" ? mermaidOutline(source) : null;
    onoutline({
      sub: outline ? `${outline.title} · ${outline.items.length}` : diagramKeyword(source),
      foot: outline ? "Highlights the item and centers it on the canvas." : "",
      empty: result.kind === "loading" ? "Rendering…" : "No outline for this diagram type.",
      items: (outline?.items ?? []).map((item, i) => ({
        id: `node-${i}`,
        label: item.label,
        meta: item.meta,
        level: 0,
        icon: "▭",
        mono: true,
      })),
    });
  });

  onDestroy(() => {
    seq++;
    onzoom(null);
    onstatus(null);
  });

  export function reveal(id: string, label: string): boolean {
    if (id === "error-line") {
      errorView?.jumpToLine();
      return true;
    }
    return canvas?.focusLabel(label) ?? false;
  }
</script>

<section class="view-fill" aria-label="Mermaid diagram">
  {#if result.kind === "ok"}
    <MermaidCanvas bind:this={canvas} svg={result.svg} label="Diagram {name}" {onzoom} {onexport} {onback} />
  {:else if result.kind === "error"}
    <div class="view-scroll">
      {#if onback}
        <div class="err err-back">
          <button class="btn" type="button" onclick={onback}>← Back to document</button>
        </div>
      {/if}
      <MermaidError bind:this={errorView} info={result.info} {source} {name} {watching} {oncopy} />
    </div>
  {:else}
    <p class="loading" role="status">Rendering diagram…</p>
  {/if}
</section>
