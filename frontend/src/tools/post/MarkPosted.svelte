<script>
  /**
   * Mark as posted: a small popover under what opened it (the header's button, a card's
   * ⋯) or at the pointer for a right-click. Its one field takes the post's link when the
   * analyst has it, written as the browser shows it; an empty field marks the post posted
   * with no link, and a link that is no X or Bluesky post is said so and marks nothing.
   * `onsubmit(url)` gets the link written the one way, or null.
   */
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import { postedAddress } from '../../lib/post.js';

  let {
    anchor = null,
    at = null,
    /** 'end' lines it up with the right of an opener near a panel's right side. */
    align = 'start',
    /** The link it holds already, for Change link…. */
    link = '',
    /** The primary button: Mark as posted, or Save link on a post already out. */
    submitLabel = 'Mark as posted',
    onsubmit,
    oncancel,
  } = $props();

  // seeded once: the popover opens on the link the post holds
  let text = $state((() => link ?? '')());
  let error = $state('');
  let field = $state(null);
  const fieldId = `mark-posted-${Math.random().toString(36).slice(2, 8)}`;

  $effect(() => {
    field?.focus();
    field?.select();
  });

  function submit(event) {
    event.preventDefault();
    const typed = text.trim();
    if (!typed) {
      onsubmit?.(null);
      return;
    }
    const found = postedAddress(typed);
    if (!found) {
      error = 'That is not the link of an X or Bluesky post.';
      field?.focus();
      return;
    }
    onsubmit?.(found.url);
  }
</script>

<FloatingMenu {anchor} {at} width={300} {align} role="dialog" label="Mark as posted" onclose={() => oncancel?.()}>
  <form class="mp" onsubmit={submit}>
    <label class="mp-label" for={fieldId}>Link to the post (optional)</label>
    <input id={fieldId} class="input mp-field" class:invalid={!!error} bind:this={field} bind:value={text}
      oninput={() => (error = '')} placeholder="https://x.com/…" spellcheck="false" autocomplete="off"
      aria-invalid={!!error} aria-describedby={`${fieldId}-said`} />
    {#if error}
      <p class="mp-said invalid" id={`${fieldId}-said`} role="alert">{error}</p>
    {:else}
      <p class="mp-said" id={`${fieldId}-said`}>Keeps it with the proof and dates it.</p>
    {/if}
    <div class="mp-row">
      <button type="submit" class="btn btn-primary btn-sm">{submitLabel}</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => oncancel?.()}>Cancel</button>
    </div>
  </form>
</FloatingMenu>

<style>
  .mp { display: flex; flex-direction: column; gap: 6px; padding: 6px 6px 4px; }
  .mp-label { color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; }
  .mp-field { width: 100%; }
  .mp-field.invalid { border-color: var(--danger); }
  .mp-said { margin: 0; color: var(--text-3); font-size: 11px; line-height: 1.4; }
  .mp-said.invalid { color: var(--danger); }
  .mp-row { display: flex; gap: 6px; margin-top: 4px; }
</style>
