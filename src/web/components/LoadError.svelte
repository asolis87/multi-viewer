<script lang="ts">
  interface Props {
    title: string;
    message: string;
    hint: string;
    onretry: () => void;
  }

  let { title, message, hint, onretry }: Props = $props();
</script>

<section class="err" aria-label="Error">
  <div class="err-box" role="alert">
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2l8.5 15h-17z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /><path d="M10 8v4M10 14.5v.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
    <div>
      <h1>{title}</h1>
      <p><code>{message}</code></p>
      <p class="err-meta">{hint}</p>
      <div class="err-actions">
        <button class="btn" type="button" onclick={onretry}>Try again</button>
      </div>
    </div>
  </div>
</section>
