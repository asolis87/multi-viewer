<script lang="ts">
  import { tick } from "svelte";
  import { lineRange, type EditNotice } from "../lib/edit.js";

  interface Props {
    /** `<name> · <type>` in the column head. */
    title: string;
    name: string;
    text: string;
    notice: EditNotice | null;
    oninput: (text: string) => void;
    oncopy: () => void;
    ondownload: () => void;
    onclose: () => void;
    ondiscard: () => void;
  }

  let { title, name, text, notice, oninput, oncopy, ondownload, onclose, ondiscard }: Props = $props();

  let box: HTMLTextAreaElement | undefined = $state();

  const noticeText = $derived(
    notice?.kind === "changed"
      ? `${name} changed on disk. Your edits are kept in this tab and the preview still shows them.`
      : notice?.kind === "unreadable"
        ? `${name} could not be read (${notice.error}). Your edits are kept in this tab.`
        : "",
  );

  export function focus(): void {
    box?.focus();
  }

  /** `Go to line N` (S18, L99): select that line and focus the editor. */
  export async function goToLine(line: number): Promise<void> {
    await tick();
    if (!box) return;
    const [start, end] = lineRange(box.value, line);
    box.focus();
    box.setSelectionRange(start, end);
    const lineHeight = parseFloat(getComputedStyle(box).lineHeight) || 20;
    box.scrollTop = Math.max(0, (line - 1) * lineHeight - box.clientHeight / 3);
  }
</script>

<section class="editor" id="editor" aria-label="Editor">
  <div class="ed-col-head">
    <h2>Editor</h2>
    <span class="ed-sub" title={title}>{title}</span>
    <button class="btn" type="button" onclick={oncopy}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M10.5 3V2.5h-8v8H3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>Copy
    </button>
    <button class="btn" type="button" onclick={ondownload}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8m-3.5-3.5L8 10l3.5-3.5M2.5 12.5v1h11v-1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>Download
    </button>
    <button class="ins-close" type="button" aria-label="Close the editor (edits are kept)" title="Close the editor (edits are kept)" onclick={onclose}>×</button>
  </div>
  {#if notice}
    <div class="ed-notice">
      <div class="notice" role="status">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8l6.5 12H1.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" /><path d="M8 6.5v3.2M8 11.6v.1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        <span class="n-text">{noticeText}</span>
        <button class="btn" type="button" onclick={ondiscard}>Discard edits and load the file</button>
      </div>
    </div>
  {/if}
  <textarea
    bind:this={box}
    value={text}
    spellcheck="false"
    aria-label="Edited text"
    oninput={(e) => oninput((e.currentTarget as HTMLTextAreaElement).value)}
  ></textarea>
  <div class="ed-foot">Changes stay in this tab; nothing is saved to the file. Reloading the tab drops them.</div>
</section>
