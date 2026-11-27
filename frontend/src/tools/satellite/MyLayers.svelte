<script>
  import AddedLayers from './AddedLayers.svelte';
  import LayerEditor from './LayerEditor.svelte';
  import { addedLayers } from '../../lib/map/addedLayersState.svelte.js';
  import { caseState } from '../../lib/state.svelte.js';
  import { layerMapOffer } from '../../lib/notes/mapPut.js';
  import { putInNote } from '../../lib/notes/putInNote.svelte.js';
  import { makeWebMap } from '../../lib/notes/webMap.js';
  import { openNotebook } from '../../lib/navigate.js';
  import { toast } from '../../lib/state.svelte.js';

  let { rows = [], controller, onnew, onedit, ontoggle,
    ondone, onfly, onremove, onreorder, oncategory, ondeleteplace } = $props();
  const personal = $derived(rows.filter((row) => row.editable));

  /** The layer a web map is being made of, while its ground is filed. */
  let making = $state('');
  /** My layers › Publish as a web map…: the note made, its map put, and the Notebook opened on it. */
  async function webMap(row) {
    const caseId = caseState.current?.id;
    if (!caseId || making) return;
    making = row.name;
    toast('Framing the map and filing its ground…', 'info', 4000);
    try {
      const note = await makeWebMap(caseId, { title: row.title, layers: [row.name] });
      openNotebook(note.id);
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      making = '';
    }
  }
</script>

<section class="my-layers" aria-label="My layers" data-guide="sat.mylayers">
  {#if controller.editor}
    <LayerEditor {controller} {ondone} {onfly} {ondeleteplace} />
  {:else}
    <AddedLayers rows={personal} heading="My layers" headingIcon="stack" addLabel="New layer" addGuide="layer.new"
      ondownload={(row) => controller.download(row)}
      onmap={(row) => void putInNote(layerMapOffer(caseState.current?.id, row))}
      onwebmap={webMap} busy={making}
      {ontoggle} {onedit} {onremove} {onreorder} {oncategory} onadd={onnew}
      opened={addedLayers.justAdded}
      dates={addedLayers.dates}
      onperiod={(row, period, commit) => addedLayers.setPeriod(caseState.current?.id, row, period, commit)}
      moments={(row) => addedLayers.moments(row.name)}
      ontime={(row, patch) => addedLayers.setTime(row.name, patch)}
      onsheet={(row, options) => addedLayers.updateFromSheet(caseState.current?.id, row, options)} />
  {/if}
</section>

<style>
  .my-layers { margin: 8px 0; border-top: 1px solid var(--border); }
</style>
