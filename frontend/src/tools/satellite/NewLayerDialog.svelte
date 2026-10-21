<script>
  import { untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import { ACCEPTS, isMyMapsLink } from '../../lib/map/addedLayers.js';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { axisZone } from '../../lib/caseAxis.svelte.js';
  import { caseState } from '../../lib/state.svelte.js';
  import { LAYER_HELP } from '../../lib/map/layerHelp.js';

  let { source = null, busy = false, onclose, oncreate } = $props();
  /** A name no layer of the case has yet, so two new layers never read alike in the lists. */
  function free(base) {
    const taken = new Set((addedLayers.rows ?? []).map((row) => row.title));
    let count = 1;
    while (taken.has(count === 1 ? base : `${base} ${count}`)) count += 1;
    return count === 1 ? base : `${base} ${count}`;
  }
  let title = $state(untrack(() => free(source ? `${source.title} copy` : 'My layer')));
  /** Follow it over time from the start: its states dated on the case's clock until another is set. */
  let track = $state(false);
  let description = $state(untrack(() => source?.description ?? ''));
  let from = $state('blank');
  let file = $state(null);
  let link = $state('');
  /** What the layer starts from: a file, a My Maps link read once, or nothing. */
  const start = $derived(source ? null : from === 'file' ? file : from === 'link' ? link.trim() : null);
  const ready = $derived(!!title.trim() && (source || from === 'blank' || (from === 'file' ? !!file : isMyMapsLink(link))));
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
  <label class="switch" title={LAYER_HELP.track}>
    <input type="checkbox" bind:checked={track} disabled={busy} /> Track over time
  </label>
  {#if source}
    <p class="note">The original layer stays unchanged.</p>
  {:else}
    <div class="choices" role="group" aria-label="Start from">
      <button class="btn" class:chosen={from === 'blank'} aria-pressed={from === 'blank'}
        disabled={busy} onclick={() => (from = 'blank')}>Blank</button>
      <button class="btn" class:chosen={from === 'file'} aria-pressed={from === 'file'}
        disabled={busy} onclick={() => (from = 'file')}>From a file</button>
      <button class="btn" class:chosen={from === 'link'} aria-pressed={from === 'link'}
        disabled={busy} onclick={() => (from = 'link')}>From a My Maps link</button>
    </div>
    {#if from === 'file'}
      <label class="field">
        <span>KMZ, KML, GeoJSON or GPX</span>
        <input type="file" accept={ACCEPTS} disabled={busy}
          onchange={(event) => { file = event.currentTarget.files?.[0] ?? null; }} />
      </label>
      <p class="note">Keeps the original file and its bundled icons.</p>
    {:else if from === 'link'}
      <label class="field">
        <span>Google My Maps link</span>
        <input type="url" bind:value={link} maxlength="4000" disabled={busy}
          placeholder="https://www.google.com/maps/d/viewer?mid=…" />
      </label>
      <p class="note">The map is read once, now. Later changes to it don't reach this layer.</p>
    {/if}
  {/if}
  <div class="actions">
    <button class="btn" disabled={busy} onclick={onclose}>Cancel</button>
    <button class="btn btn-primary" disabled={busy || !ready}
      onclick={() => oncreate(title.trim(), start, description.trim(),
        track ? { on: true, zone: axisZone(caseState.current?.id) || 'UTC' } : null)}>
      {busy ? (start ? 'Importing…' : 'Creating…') : 'Create layer'}
    </button>
  </div>
</Modal>

<style>
  .field { display: grid; gap: 5px; margin-bottom: 14px; }
  .field span, .note { color: var(--text-3); font-size: var(--fs-sm); }
  textarea { resize: vertical; }
  .choices { display: flex; gap: 6px; margin-bottom: 14px; }
  .switch { display: flex; align-items: center; gap: 7px; width: fit-content; margin-bottom: 14px; color: var(--text-2); font-size: var(--fs-sm); cursor: pointer; }
  .chosen { border-color: var(--accent); color: var(--accent); }
  .note { margin: 8px 0 0; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
</style>
