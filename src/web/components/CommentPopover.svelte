<script lang="ts">
  import { onMount } from "svelte";
  import type { CommentKind } from "../../shared/review.js";
  import { KIND_LABEL, KINDS } from "../lib/review.js";
  import ReviewIcon from "./ReviewIcon.svelte";

  interface Props {
    title: string;
    /** Selected text, or null for a whole-block comment. */
    quote: string | null;
    /** Several blocks (only matters without a quote). */
    multi: boolean;
    kind: CommentKind;
    text: string;
    editing: boolean;
    left: number;
    top: number;
    element?: HTMLDivElement;
    onsave: (kind: CommentKind, text: string) => void;
    oncancel: () => void;
  }

  let { title, quote, multi, kind: initialKind, text: initialText, editing, left, top, element = $bindable(), onsave, oncancel }: Props = $props();

  // Edited locally; the initial values come from the comment being edited (or the defaults).
  // svelte-ignore state_referenced_locally
  let kind = $state<CommentKind>(initialKind);
  // svelte-ignore state_referenced_locally
  let text = $state(initialText);
  let textarea: HTMLTextAreaElement | undefined = $state();
  const blank = $derived(!text.trim());

  function save() {
    if (!blank) onsave(kind, text);
  }

  onMount(() => textarea?.focus({ preventScroll: true }));
</script>

<div class="pop" role="dialog" aria-labelledby="pop-title" bind:this={element} style:left="{left}px" style:top="{top}px">
  <p class="pop-title" id="pop-title">{title}</p>
  {#if quote}
    <blockquote class="c-quote">{quote}</blockquote>
  {:else}
    <p class="c-whole">{multi ? "Whole blocks, no quote" : "Whole block, no quote"}</p>
  {/if}
  <fieldset class="kinds">
    <legend>Kind</legend>
    {#each KINDS as k (k)}
      <label>
        <input type="radio" name="comment-kind" value={k} bind:group={kind} />
        <span class="kind kind-{k}"><ReviewIcon name={k} />{KIND_LABEL[k]}</span>
      </label>
    {/each}
  </fieldset>
  <div>
    <label class="pop-lbl" for="pop-text">Comment <span>Required</span></label>
    <textarea
      id="pop-text"
      required
      aria-required="true"
      aria-describedby="pop-hint"
      bind:this={textarea}
      bind:value={text}
      onkeydown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          save();
        }
      }}
    ></textarea>
  </div>
  <div class="pop-foot">
    <p class="pop-hint" id="pop-hint">{blank ? "Write a comment to add it." : "Ctrl+Enter or ⌘+Enter to save."}</p>
    <button class="btn ghost" type="button" onclick={oncancel}>Cancel</button>
    <button class="btn primary" type="button" disabled={blank} onclick={save}>{editing ? "Save" : "Add comment"}</button>
  </div>
</div>
