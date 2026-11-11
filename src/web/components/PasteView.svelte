<script lang="ts">
  interface Props {
    onrender: (text: string) => void;
  }

  let { onrender }: Props = $props();

  let text = $state("");
  let message = $state("");
  let box: HTMLTextAreaElement | undefined = $state();

  function submit(value: string) {
    if (!value.trim()) {
      message = "Nothing to render: the pasted text is empty.";
      return;
    }
    message = "";
    onrender(value);
  }

  // Cmd/Ctrl+V anywhere in the window renders the clipboard text right away.
  $effect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.target === box) return;
      e.preventDefault();
      submit(e.clipboardData?.getData("text/plain") ?? "");
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });
</script>

<section class="paste" aria-label="Paste content">
  <h1>Paste to view</h1>
  <p class="lead">
    Press <kbd>⌘</kbd> <kbd>V</kbd> on macOS or <kbd>Ctrl</kbd> <kbd>V</kbd> elsewhere, anywhere in this window. mview detects Markdown, Mermaid or JSON.
  </p>
  <label for="paste-box">Or paste or type here</label>
  <textarea
    id="paste-box"
    bind:this={box}
    bind:value={text}
    spellcheck="false"
    aria-describedby="paste-note paste-msg"
    placeholder={"sequenceDiagram\n  Storefront->>Gateway: POST /checkout"}
  ></textarea>
  <div class="paste-actions">
    <button class="btn primary" type="button" onclick={() => submit(text)}>Render</button>
    <span class="paste-msg" id="paste-msg" role="status">{message}</span>
    <span class="paste-note" id="paste-note">Pasted content stays in this tab only. Reloading the page clears it.</span>
  </div>
  <div class="ways">
    <h2>Other ways in</h2>
    <dl>
      <dt><code>mview notes.md</code></dt>
      <dd>Open a file and reload when it changes on disk</dd>
      <dt><code>mview --paste</code></dt>
      <dd>Render what is on the clipboard</dd>
      <dt><code>cat out.json | mview</code></dt>
      <dd>Render piped input</dd>
    </dl>
  </div>
</section>
