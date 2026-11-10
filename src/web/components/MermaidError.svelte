<script lang="ts">
  import type { MermaidErrorInfo } from "../lib/mermaidInfo.js";
  import { reveal } from "../lib/ui.js";

  interface Props {
    info: MermaidErrorInfo;
    source: string;
    name: string;
    watching: boolean;
    oncopy: (text: string, label: string) => void;
  }

  let { info, source, name, watching, oncopy }: Props = $props();

  const lines = $derived(source.replace(/\n$/, "").split(/\r?\n/));
  const messageLines = $derived(info.message.split(/\r?\n/).filter((l) => l.trim()));
  // Jison messages end with "Expecting …, got …": the most useful line on its own.
  const summary = $derived(messageLines.at(-1) ?? info.message);
  const title = $derived(`Can’t render ${name}${info.line ? ` — parse error on line ${info.line}` : ""}`);

  let list: HTMLOListElement | undefined = $state();

  export function jumpToLine(): void {
    reveal(list?.querySelector<HTMLElement>("li.bad") ?? null, "center");
  }

  function copyError() {
    const where = info.line ? ` line ${info.line}` : "";
    oncopy(`${name}${where}: ${info.message}`, "error message");
  }
</script>

<section class="err" aria-label="Mermaid error">
  <div class="err-box" role="alert">
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2l8.5 15h-17z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><path d="M10 8v4M10 14.5v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
    <div>
      <h1>{title}</h1>
      <p><code>{summary}</code></p>
      <p class="err-meta">
        {watching
          ? "The file is still being watched. Save a fix and the diagram renders again automatically."
          : "Fix the source and render it again, or pick another type in “Render as”."}
      </p>
      {#if messageLines.length > 1}
        <details>
          <summary>Parser output</summary>
          <pre>{info.message}</pre>
        </details>
      {/if}
      <div class="err-actions">
        {#if info.line}
          <button class="btn" type="button" onclick={jumpToLine}>Go to line {info.line}</button>
        {/if}
        <button class="btn" type="button" onclick={copyError}>Copy error</button>
      </div>
    </div>
  </div>
  <div class="src-wrap">
    <div class="src-head">{name} · source</div>
    <ol class="src" aria-label="Diagram source" bind:this={list}>
      {#each lines as line, i (i)}
        {#if info.line === i + 1}
          <li class="bad" tabindex="-1"><span class="sr">Error on this line: </span>{line}</li>
        {:else}
          <li>{line}</li>
        {/if}
      {/each}
    </ol>
  </div>
</section>
