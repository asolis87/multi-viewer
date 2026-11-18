<script lang="ts">
  interface Props {
    live: { text: string; dot: "ok" | "off" | "idle" };
    typeText: string;
    zoom: number | null;
    lastCopied: string | null;
    message: string;
    /** Review pages (S17): the comment count. */
    comments?: string | null;
    /** Edit mode (S18): shown while there are edits, e.g. "in this tab · not saved". */
    edits?: string | null;
  }

  let { live, typeText, zoom, lastCopied, message, comments = null, edits = null }: Props = $props();
</script>

<footer class="status" aria-label="Status">
  <div>
    <span class="dot" class:off={live.dot === "off"} class:idle={live.dot === "idle"} aria-hidden="true"></span>
    <span>{live.text}</span>
  </div>
  <div>{typeText}</div>
  {#if comments !== null}
    <div>{comments}</div>
  {/if}
  {#if edits !== null}
    <div><strong>Edited</strong> {edits}</div>
  {/if}
  {#if zoom !== null}
    <div class="opt">Zoom <strong>{zoom}%</strong></div>
  {/if}
  {#if lastCopied}
    <div class="opt">Last copied: <code>{lastCopied}</code></div>
  {/if}
  <div class="grow" role="status" aria-live="polite">{message}</div>
</footer>
