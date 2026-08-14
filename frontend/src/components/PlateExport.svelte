<script>
  /** Exporting the reading on screen as a plate — one dialog for Graph and Timeline.
   *
   *  The surface hands over a callback that serialises what it is drawing; nothing here
   *  knows how a graph or an axis is drawn. See `lib/plate.js` for what a plate is. */
  import { copyPlateImage, plateScale, revealPlates, writePlate } from '../lib/plateExport.js';
  import { CASE_FOLDER_LABEL, destinationLabel, readDestinations } from '../lib/exportDest.js';
  import { caseState, toast } from '../lib/state.svelte.js';
  import ExportFolderPicker from './ExportFolderPicker.svelte';
  import Icon from './Icon.svelte';
  import Modal from './Modal.svelte';

  let {
    /** Serialise what is on screen: `{ svg, width, height, filename }`, or null. */
    plate = () => null,
    /** What the reading is called in the toast: "graph" or "timeline". */
    surface = 'graph',
    disabled = false,
  } = $props();

  let open = $state(false);
  let format = $state('svg');
  /** The saved destination: `null` until the settings answer, `''` for the case folder. */
  let destination = $state(null);
  let destRead = $state(true);
  let chosen = $state(false);
  let picker = $state(false);
  let busy = $state(false);
  /** The reading, serialised when the dialog opened: the surface behind a modal cannot
   *  change, and the size of the page decides what the PNG can honestly promise. */
  let page = $state(null);

  const scale = $derived(page ? plateScale(page) : null);
  const pngNote = $derived(
    scale === null || scale > 1.95
      ? 'An image, at twice the page size.'
      : scale >= 1
        ? `An image, at ${scale.toFixed(1)}× the page size.`
        : 'An image, smaller than the page this reading needs.'
  );
  /** Never the default's wording while the saved folder is unknown: a plate would land
   *  somewhere else and the dialog would have said the case folder. */
  const destLabel = $derived(
    destination !== null
      ? destination || CASE_FOLDER_LABEL
      : destRead ? 'Reading the saved folder…' : 'the folder saved for views'
  );

  function start() {
    open = true;
    chosen = false;
    destRead = true;
    page = plate();
    readDestinations()
      // Not over a folder the analyst has since picked: they are faster than a fetch.
      .then((dirs) => { if (!chosen) destination = dirs.views; })
      .catch(() => { destRead = false; });
  }

  /** Say plainly when there was nothing to serialise. */
  function drawn() {
    if (!page?.svg) {
      toast(`There is nothing on the ${surface} to export yet.`, 'warn');
      return null;
    }
    return page;
  }

  async function run() {
    const caseId = caseState.current?.id;
    const page = drawn();
    if (!caseId || !page || busy) return;
    busy = true;
    try {
      const result = await writePlate(caseId, page, { format });
      open = false;
      toast(`${result.file} written to ${destinationLabel(result.path)}`, 'ok', 5200, {
        label: 'Show',
        onClick: () => revealPlates(caseId).catch((error) => toast(error.message, 'warn')),
      });
    } catch (error) {
      toast(`Export failed: ${error.message}`, 'danger');
    } finally {
      busy = false;
    }
  }

  async function copy() {
    const page = drawn();
    if (!page || busy) return;
    busy = true;
    try {
      await copyPlateImage(page);
      open = false;
      toast('Copied as an image', 'ok');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = false;
    }
  }
</script>

<button class="btn btn-sm" {disabled} onclick={start} title="Export this reading">
  <Icon name="download" size={13} /> Export
</button>

{#if open}
  <Modal title="Export this reading" onclose={() => (open = false)} width="480px">
    <div class="plate-form">
      <label class="choice">
        <input type="radio" bind:group={format} value="svg" />
        <span><strong>SVG</strong><small>Vector: zooms without softening, and the text stays text.</small></span>
      </label>
      <label class="choice">
        <input type="radio" bind:group={format} value="png" />
        <span><strong>PNG</strong><small>{pngNote}</small></span>
      </label>
      <div class="dest">
        <span>Destination</span>
        <span class="path mono" title={destLabel}>{destLabel}</span>
        <button class="btn btn-ghost btn-sm" onclick={() => (picker = true)}>Change</button>
      </div>
      <p class="note">The plate carries the lens, the question, the window and the legend.</p>
      <div class="actions">
        <button class="btn" onclick={() => (open = false)}>Cancel</button>
        <button class="btn" disabled={busy} onclick={copy}>
          <Icon name="copy" size={12} /> Copy image
        </button>
        <button class="btn btn-primary" disabled={busy} onclick={run}>
          {busy ? 'Exporting…' : 'Export'}
        </button>
      </div>
    </div>
  </Modal>
{/if}

{#if picker}
  <ExportFolderPicker
    kind="views"
    current={destination ?? ''}
    onclose={() => (picker = false)}
    onchosen={(path) => { chosen = true; destination = path; }}
  />
{/if}

<style>
  .plate-form { display: grid; gap: 12px; }
  .choice { display: flex; align-items: flex-start; gap: 9px; padding: 9px; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .choice span, .choice small { display: block; }
  .choice small { margin-top: 3px; color: var(--text-3); }
  .dest { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: var(--fs-sm); }
  .path { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-3); }
  .note { margin: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
