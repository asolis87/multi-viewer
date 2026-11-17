<script lang="ts">
  import { KIND_LABEL, lineLabel, type Draft } from "../lib/review.js";
  import ReviewIcon from "./ReviewIcon.svelte";

  interface Props {
    /** Comments in document order. */
    comments: Draft[];
    /** How many blocks each comment marks now (0: not highlighted). */
    marked: Map<number, number>;
    active: number | null;
    sent: boolean;
    /** Card tops when they sit level with their blocks (wide screens); null stacks them. */
    tops: Map<number, number> | null;
    height: number | null;
    cards: Map<number, HTMLElement>;
    list?: HTMLOListElement;
    onshow: (id: number) => void;
    onedit: (id: number, button: HTMLElement) => void;
    ondelete: (id: number) => void;
  }

  let { comments, marked, active, sent, tops, height, cards, list = $bindable(), onshow, onedit, ondelete }: Props = $props();

  function card(node: HTMLElement, id: number) {
    cards.set(id, node);
    return {
      destroy() {
        if (cards.get(id) === node) cards.delete(id);
      },
    };
  }
</script>

<aside class="rail" aria-labelledby="rail-title">
  <h2 class="rail-head" id="rail-title">Comments <span>{comments.length ? `· ${comments.length}` : ""}</span></h2>
  {#if !sent}
    <p class="rail-note">In document order. Drafts stay in this tab until you send.</p>
  {/if}
  {#if !comments.length}
    <p class="rail-empty">No comments yet. Select text in the document, or use the comment button beside a block.</p>
  {/if}
  <p class="req-hint" id="req-hint" hidden={comments.length > 0 || sent}>Add a comment to request changes, or approve the plan as it is.</p>
  <ol class="c-list rail-list" class:is-aligned={tops !== null} aria-labelledby="rail-title" bind:this={list} style:height={height !== null ? `${height}px` : null}>
    {#each comments as c, i (c.id)}
      {@const blocks = marked.get(c.id) ?? 0}
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
      <li class="c-item" class:is-active={c.id === active} use:card={c.id} style:top={tops?.has(c.id) ? `${tops.get(c.id)}px` : null} onclick={() => onshow(c.id)}>
        <div class="c-head">
          <button
            class="c-go"
            type="button"
            data-comment={c.id}
            aria-label="Comment {i + 1}: {KIND_LABEL[c.kind]}, {lineLabel(c.start, c.end)}. Show in the document"
            onclick={(e) => {
              e.stopPropagation();
              onshow(c.id);
            }}
          >
            <span class="kind kind-{c.kind}"><ReviewIcon name={c.kind} />{KIND_LABEL[c.kind]}</span>
            <span class="lines">{lineLabel(c.start, c.end)}</span>
          </button>
        </div>
        {#if c.quote}
          <blockquote class="c-quote">{c.quote}</blockquote>
        {:else}
          <p class="c-whole">{blocks > 1 ? "Whole blocks" : "Whole block"}</p>
        {/if}
        <p class="c-text">{c.text}</p>
        {#if blocks === 0}
          <p class="c-gone">Not highlighted: no block has these lines now</p>
        {/if}
        {#if !sent}
          <div class="c-actions">
            <button
              class="btn ghost"
              type="button"
              aria-label="Edit comment {i + 1}"
              onclick={(e) => {
                e.stopPropagation();
                onedit(c.id, e.currentTarget);
              }}>Edit</button
            >
            <button
              class="btn ghost"
              type="button"
              aria-label="Delete comment {i + 1}"
              onclick={(e) => {
                e.stopPropagation();
                ondelete(c.id);
              }}>Delete</button
            >
          </div>
        {/if}
      </li>
    {/each}
  </ol>
</aside>
