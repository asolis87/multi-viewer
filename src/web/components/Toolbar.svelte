<script lang="ts">
  import { TYPE_LABEL, TYPE_OPTIONS, type SelectValue } from "../lib/typeState.js";
  import type { DocType } from "../lib/doc.js";
  import { THEME_OPTIONS, type ThemeChoice } from "../lib/theme.js";
  import type { ReviewControls } from "../lib/review.js";
  import ReviewIcon from "./ReviewIcon.svelte";

  interface Props {
    name: string;
    sourceLabel: string;
    /** null while there is nothing to render (empty page). */
    detected: DocType | null;
    value: SelectValue;
    drawerOpen: boolean;
    /** Show the Outline button on wide screens too (CSV, S13). */
    outlineAlways?: boolean;
    outlineButton?: HTMLButtonElement;
    ontoggleoutline: () => void;
    onselect: (value: SelectValue) => void;
    theme: ThemeChoice;
    ontheme: (theme: ThemeChoice) => void;
    /** Review page controls (S17); null on every other page. */
    review?: ReviewControls | null;
    /** Edit mode (S18): null when `Edit` is not offered. */
    edit?: { open: boolean; edited: boolean; ontoggle: () => void } | null;
    editButton?: HTMLButtonElement;
    outlineTitle?: string;
  }

  let {
    name,
    sourceLabel,
    detected,
    value,
    drawerOpen,
    outlineAlways = false,
    outlineButton = $bindable(),
    ontoggleoutline,
    onselect,
    theme,
    ontheme,
    review = null,
    edit = null,
    editButton = $bindable(),
    outlineTitle = "Show or hide the column outline",
  }: Props = $props();
</script>

<header class="toolbar">
  <button
    class="btn outline-btn"
    class:always={outlineAlways}
    type="button"
    title={outlineAlways ? outlineTitle : undefined}
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
    {#if review}
      <span class="chip" title="Comment on this document, then request changes or approve it"><ReviewIcon name="bubble" /><span class="chip-text">Review</span></span>
    {/if}
  </div>
  <div class="spacer"></div>
  <div class="type">
    <label for="type-select">Render as</label>
    <select
      id="type-select"
      disabled={detected === null || !!review}
      {value}
      onchange={(e) => onselect((e.currentTarget as HTMLSelectElement).value as SelectValue)}
    >
      <option value="auto">Auto · {detected ? TYPE_LABEL[detected] : "waiting"}</option>
      {#each TYPE_OPTIONS as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
    {#if value !== "auto"}
      <span class="manual-tag" title="Manual type is kept across live reloads until you change it">Manual</span>
    {/if}
  </div>
  <div class="theme">
    <label for="theme-select">Theme</label>
    <select
      id="theme-select"
      value={theme}
      onchange={(e) => ontheme((e.currentTarget as HTMLSelectElement).value as ThemeChoice)}
    >
      {#each THEME_OPTIONS as option (option.value)}
        <option value={option.value}>{option.label}</option>
      {/each}
    </select>
  </div>
  {#if edit}
    <span class="tb-sep" aria-hidden="true"></span>
    <div class="edit-tools">
      <button
        class="btn"
        type="button"
        bind:this={editButton}
        aria-pressed={edit.open}
        aria-controls={edit.open ? "editor" : undefined}
        title="Edit the text in this tab; nothing is saved to the file"
        onclick={edit.ontoggle}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 13l.8-3.2L10.5 3l2.5 2.5-6.7 6.7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>Edit
      </button>
      {#if edit.edited && !edit.open}
        <span class="manual-tag" title="The text was edited in this tab and is not saved to the file">Edited</span>
      {/if}
    </div>
  {/if}
  {#if review}
    <span class="tb-sep" aria-hidden="true"></span>
    {#if review.sent}
      <p class="sent-msg"><ReviewIcon name="check" />Review sent — you can close this tab</p>
    {:else}
      <div class="decide">
        <button class="btn" type="button" aria-describedby="req-hint" disabled={review.count === 0 || review.busy} onclick={review.onrequest}>Request changes</button>
        <button class="btn primary" type="button" disabled={review.busy} onclick={review.onapprove}>{review.count > 0 ? "Approve with comments" : "Approve"}</button>
      </div>
    {/if}
  {/if}
</header>
