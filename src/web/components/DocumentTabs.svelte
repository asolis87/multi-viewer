<script lang="ts">
  import { tick } from "svelte";
  import type { TabRef } from "../lib/tabs.js";

  interface Props {
    /** Two or more open documents (the caller hides the strip below that). */
    items: TabRef[];
    selected: string | null;
    /** A click or a keyboard selection; the page keeps it local (never a server write). */
    onselect: (id: string) => void;
  }

  let { items, selected, onselect }: Props = $props();

  let listEl: HTMLDivElement | undefined = $state();
  const active = $derived(selected ?? items[0]?.id ?? null);

  function tabId(index: number): string {
    return `tab-${index}`;
  }

  async function activate(index: number) {
    const tab = items[index];
    if (!tab) return;
    onselect(tab.id);
    await tick();
    const button = listEl?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index];
    button?.focus();
    button?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function onKeydown(event: KeyboardEvent, index: number) {
    const count = items.length;
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? count - 1
          : event.key === "ArrowLeft"
            ? (index - 1 + count) % count
            : event.key === "ArrowRight"
              ? (index + 1) % count
              : null;
    if (next === null) return;
    event.preventDefault();
    void activate(next);
  }
</script>

<section class="documents" aria-label="Open documents">
  <h2 class="sr">Documents</h2>
  <div class="tablist" role="tablist" aria-label="Documents" aria-orientation="horizontal" bind:this={listEl}>
    {#each items as tab, index (tab.id)}
      <button
        id={tabId(index)}
        role="tab"
        type="button"
        aria-selected={tab.id === active}
        aria-controls="doc-panel"
        tabindex={tab.id === active ? 0 : -1}
        title={tab.name}
        onclick={() => onselect(tab.id)}
        onkeydown={(event) => onKeydown(event, index)}
      >
        {tab.name}
      </button>
    {/each}
  </div>
</section>
