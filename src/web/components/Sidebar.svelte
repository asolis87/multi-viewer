<script lang="ts">
  import type { SideItem, SideOutline } from "../lib/ui.js";

  interface Props {
    outline: SideOutline;
    active: string | null;
    element?: HTMLElement;
    onpick: (item: SideItem) => void;
  }

  let { outline, active, element = $bindable(), onpick }: Props = $props();
</script>

<nav class="sidebar" id="sidebar" aria-label="Outline" bind:this={element} tabindex="-1">
  <div class="side-head">
    <h2>Outline</h2>
    {#if outline.sub}<div class="side-sub">{outline.sub}</div>{/if}
  </div>
  {#if outline.items.length}
    <ul class="outline">
      {#each outline.items as item (item.id)}
        <li>
          <button type="button" style:--lv={item.level} aria-current={item.id === active ? "true" : undefined} onclick={() => onpick(item)}>
            <span class="o-ico" aria-hidden="true">{item.icon}</span>
            <span class="o-label" class:o-mono={item.mono}>{item.label}</span>
            {#if item.meta}<span class="o-meta">{item.meta}</span>{/if}
          </button>
        </li>
      {/each}
    </ul>
  {:else if outline.empty}
    <p class="side-empty">{outline.empty}</p>
  {/if}
  {#if outline.foot && outline.items.length}
    <div class="side-foot">{outline.foot}</div>
  {/if}
</nav>
