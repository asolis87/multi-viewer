<script lang="ts">
  import { TYPE_LABEL, type SelectValue } from "../lib/typeState.js";
  import type { DocType } from "../lib/doc.js";

  interface Props {
    name: string;
    sourceLabel: string;
    /** null while there is nothing to render (empty page). */
    detected: DocType | null;
    value: SelectValue;
    drawerOpen: boolean;
    outlineButton?: HTMLButtonElement;
    ontoggleoutline: () => void;
    onselect: (value: SelectValue) => void;
  }

  let { name, sourceLabel, detected, value, drawerOpen, outlineButton = $bindable(), ontoggleoutline, onselect }: Props = $props();
</script>

<header class="toolbar">
  <button
    class="btn outline-btn"
    type="button"
    bind:this={outlineButton}
    aria-controls="sidebar"
    aria-expanded={drawerOpen}
    onclick={ontoggleoutline}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>Outline
  </button>
  <div class="brand">
    <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="1" y="3" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M5 13V7l2.5 3L10 7v6M13 7l2 6 2-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>
    <span>mview</span>
  </div>
  <div class="file">
    <span class="file-name">{name}</span>
    <span class="chip" title="Where this content came from">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5V5h3.5" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" /></svg>
      <span class="sr">Source:</span><span class="chip-text">{sourceLabel}</span>
    </span>
  </div>
  <div class="spacer"></div>
  <div class="type">
    <label for="type-select">Render as</label>
    <select
      id="type-select"
      disabled={detected === null}
      {value}
      onchange={(e) => onselect((e.currentTarget as HTMLSelectElement).value as SelectValue)}
    >
      <option value="auto">Auto · {detected ? TYPE_LABEL[detected] : "waiting"}</option>
      <option value="markdown">Markdown</option>
      <option value="mermaid">Mermaid</option>
      <option value="json">JSON</option>
    </select>
    {#if value !== "auto"}
      <span class="manual-tag" title="Manual type is kept across live reloads until you change it">Manual</span>
    {/if}
  </div>
</header>
