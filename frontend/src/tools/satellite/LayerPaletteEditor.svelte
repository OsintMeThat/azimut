<script>
  /**
   * The case's named colours, edited in place: what blue and orange mean in
   * this investigation. Every layer of the case offers them, and the legends
   * name their counts by them.
   */
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import HexField from '../../components/HexField.svelte';
  import { layerPalette } from '../../lib/map/layerPalette.svelte.js';
  import { toast } from '../../lib/state.svelte.js';

  let { caseId, defaults = [], onclose } = $props();
  /** Starts from the case's names, else from the plain palette with no names yet. */
  let rows = $state(untrack(() => layerPalette.colours.length
    ? layerPalette.colours.map((entry) => ({ ...entry }))
    : defaults.slice(0, 3).map(([colour]) => ({ colour, name: '' }))));
  let busy = $state(false);
  const named = $derived(rows.filter((row) => row.name.trim()));

  async function save() {
    busy = true;
    try {
      await layerPalette.save(caseId, named.map((row) => ({ name: row.name.trim(), colour: row.colour })));
      onclose?.();
    } catch (error) { toast(error.message, 'danger'); }
    finally { busy = false; }
  }
</script>

<div class="palette-editor" role="group" aria-label="Named colours">
  <p class="note">Name what each colour means in this case. Every layer offers them, and legends count by name.</p>
  {#each rows as row, index (index)}
    <div class="row">
      <input type="color" aria-label={`Colour ${index + 1}`} bind:value={row.colour} />
      <HexField value={row.colour} label={`Code of colour ${index + 1}`} onpick={(hex) => (row.colour = hex)} />
      <input aria-label={`Name of colour ${index + 1}`} placeholder="Side A, Unknown…" maxlength="40" bind:value={row.name} />
      <button type="button" class="icon-act" aria-label={`Remove colour ${index + 1}`} title="Remove"
        onclick={() => (rows = rows.filter((_, at) => at !== index))}><Icon name="x" size={11} /></button>
    </div>
  {/each}
  {#if rows.length < 12}
    <button type="button" class="text-act" onclick={() => (rows = [...rows, { colour: '#cc79a7', name: '' }])}><Icon name="plus" size={11} /> Add a colour</button>
  {/if}
  <div class="actions">
    <button type="button" class="btn btn-sm" onclick={() => onclose?.()}>Cancel</button>
    <button type="button" class="btn btn-sm btn-primary" disabled={busy} onclick={save}>Save colours</button>
  </div>
</div>

<style>
  .palette-editor { margin-top: 7px; padding: 7px; border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2); }
  .note { margin: 0 0 6px; color: var(--text-3); font-size: 10px; line-height: 1.4; }
  .row { display: flex; align-items: center; gap: 5px; margin-top: 4px; }
  .row input:not([type='color']) { flex: 1; min-width: 0; height: 25px; padding: 3px 6px; font-size: var(--fs-xs); }
  input[type='color'] { width: 26px; height: 24px; padding: 1px; border: 1px solid var(--border); background: var(--bg-1); cursor: pointer; }
  .icon-act { display: grid; place-items: center; width: 22px; height: 22px; color: var(--text-3); cursor: pointer; }
  .text-act { display: inline-flex; align-items: center; gap: 4px; margin-top: 6px; color: var(--text-3); font-size: 10px; cursor: pointer; }
  .text-act:hover { color: var(--text-1); }
  .actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 8px; }
</style>
