<script>
  import { untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import { ACCEPTS } from '../../lib/map/addedLayers.js';

  let { source = null, busy = false, onclose, oncreate } = $props();
  let title = $state(untrack(() => source ? `${source.title} copy` : 'My layer'));
  let description = $state(untrack(() => source?.description ?? ''));
  let from = $state('blank');
  let file = $state(null);
</script>

<Modal title={source ? 'Create editable copy' : 'New layer'} {onclose} width="420px">
  <label class="field">
    <span>Name</span>
    <input type="text" bind:value={title} maxlength="200" disabled={busy} />
  </label>
  <label class="field">
    <span>Description (optional)</span>
    <textarea bind:value={description} maxlength="4000" rows="2" disabled={busy}></textarea>
  </label>
  {#if source}
    <p class="note">The original layer stays unchanged.</p>
  {:else}
    <div class="choices" role="group" aria-label="Start from">
      <button class="btn" class:chosen={from === 'blank'} aria-pressed={from === 'blank'}
        disabled={busy} onclick={() => (from = 'blank')}>Blank</button>
      <button class="btn" class:chosen={from === 'file'} aria-pressed={from === 'file'}
        disabled={busy} onclick={() => (from = 'file')}>From a file</button>
    </div>
    {#if from === 'file'}
      <label class="field">
        <span>KMZ, KML, GeoJSON or GPX</span>
        <input type="file" accept={ACCEPTS} disabled={busy}
          onchange={(event) => { file = event.currentTarget.files?.[0] ?? null; }} />
      </label>
      <p class="note">Keeps the original file and its bundled icons.</p>
    {/if}
  {/if}
  <div class="actions">
    <button class="btn" disabled={busy} onclick={onclose}>Cancel</button>
    <button class="btn btn-primary" disabled={busy || !title.trim() || (!source && from === 'file' && !file)}
      onclick={() => oncreate(title.trim(), !source && from === 'file' ? file : null, description.trim())}>
      {busy ? 'Creating…' : 'Create layer'}
    </button>
  </div>
</Modal>

<style>
  .field { display: grid; gap: 5px; margin-bottom: 14px; }
  .field span, .note { color: var(--text-3); font-size: var(--fs-sm); }
  textarea { resize: vertical; }
  .choices { display: flex; gap: 6px; margin-bottom: 14px; }
  .chosen { border-color: var(--accent); color: var(--accent); }
  .note { margin: 8px 0 0; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
</style>
