<script lang="ts">
  /** Review mode icons (design/mview-review/01-margin-rail.html): kinds, comment, sent, warning. */
  interface Props {
    name: "change" | "answer" | "note" | "comment" | "bubble" | "check" | "warn";
  }
  let { name }: Props = $props();
</script>

<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round">
  {#if name === "change"}
    <path d="M3 13l.8-3.2L10.6 3 13 5.4l-6.8 6.8L3 13z" />
  {:else if name === "answer"}
    <path d="M6.5 4L3 7.5 6.5 11M3.5 7.5H9a4 4 0 0 1 4 4V13" />
  {:else if name === "note"}
    <rect x="3" y="2.5" width="10" height="11" rx="1.5" /><path d="M5.5 6h5M5.5 9h3" />
  {:else if name === "comment"}
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" /><path d="M8 5.3v3.4M6.3 7h3.4" />
  {:else if name === "bubble"}
    <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" stroke-width="1.3" />
  {:else if name === "check"}
    <path d="M3 8.5l3 3 7-7" stroke-width="1.8" />
  {:else}
    <path d="M8 1.8l6.5 12H1.5z" /><path d="M8 6.5v3.2M8 11.6v.1" stroke-width="1.6" />
  {/if}
</svg>
