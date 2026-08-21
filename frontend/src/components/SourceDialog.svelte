<script>
  /**
   * Where a batch of imported files came from.
   *
   * One dialog for the two moments it can be said: on the way in, and after the
   * files have landed and the analyst remembers. Same field, same words, same
   * rule — a second dialog for the second moment would be a second vocabulary.
   *
   * Stating nothing is a real answer on the way in: most imports are the
   * analyst's own working files, and a dialog that refused to close without an
   * address would be a tax on every drop.
   */
  import { sourceProblem } from '../lib/statedSource.js';
  import Modal from './Modal.svelte';

  let {
    /** How many files the answer covers. */
    count = 1,
    /** `import` on the way in, `state` for files already in the case. */
    mode = 'import',
    /** Prefill: the last source stated this session, or what the file carries. */
    value = '',
    busy = false,
    onconfirm = () => {},
    onclose = () => {},
  } = $props();

  // svelte-ignore state_referenced_locally
  let url = $state(value);
  const problem = $derived(sourceProblem(url));
  const files = $derived(`${count} file${count > 1 ? 's' : ''}`);
</script>

<Modal
  title={mode === 'import' ? `Import ${files}` : `Source of ${files}`}
  {onclose}
  width="520px"
>
  <label class="modal-label" for="import-source">Source URL</label>
  <!-- svelte-ignore a11y_autofocus -->
  <input
    id="import-source"
    class="input"
    placeholder="https://…"
    autofocus
    bind:value={url}
    onkeydown={(e) => e.key === 'Enter' && !problem && !busy && onconfirm(url.trim())}
  />
  <p class="field-help">
    Optional. Where the {count > 1 ? 'files' : 'file'} came from, when you fetched
    {count > 1 ? 'them' : 'it'} yourself. Recorded as stated, not as fetched.
  </p>

  <div class="modal-row">
    <div style="flex:1"></div>
    {#if problem}<span class="problem">{problem}</span>{/if}
    <button class="btn" onclick={onclose}>Cancel</button>
    <button
      class="btn btn-primary"
      onclick={() => onconfirm(url.trim())}
      disabled={busy || Boolean(problem) || (mode === 'state' && !url.trim())}
    >
      {#if busy}
        {mode === 'import' ? 'Importing…' : 'Saving…'}
      {:else if mode === 'import'}
        {url.trim() ? 'Import' : 'Import without a source'}
      {:else}
        Save
      {/if}
    </button>
  </div>
</Modal>

<style>
  .field-help {
    margin: 5px 0 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .problem {
    align-self: center;
    color: var(--warn);
    font-size: var(--fs-xs);
  }
</style>
