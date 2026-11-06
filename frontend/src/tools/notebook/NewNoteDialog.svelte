<script>
  /**
   * New note: what it starts from, a title if one is wanted, and a folder.
   *
   * The starts are tiles, each drawn by its first page as it prints: a blank page,
   * *From the case*, the ready notes, then the analyst's own templates. *From the
   * case* asks its questions under the tiles and writes the note from the count on
   * screen (`FromCaseFields.svelte`). With no title typed the note takes the name the
   * field shows, made free against the notes already in the case.
   */
  import Modal from '../../components/Modal.svelte';
  import FolderSelect from '../../components/FolderSelect.svelte';
  import PageThumb from './PageThumb.svelte';
  import FromCaseFields from './FromCaseFields.svelte';
  import { freeTitle } from '../../lib/notes/ready.js';
  import { fromCaseAsk } from '../../lib/notes/fromCaseAsk.svelte.js';
  import { FROM_CASE_LOOK, FROM_CASE_SAMPLE } from '../../lib/notes/fromCase.js';

  let {
    caseId,
    /** What a note can start from: `{ id, name, start, note, body, folder, look }`, the blank page first. */
    starts = [],
    /** The id of the start picked when the dialog opens. */
    start = 'blank',
    folders = [],
    /** The names of the notes already in the case, so the new one gets a free one. */
    taken = [],
    /** Called with `{ title, folder, body, look }`; the dialog stays until it settles, and the caller says what failed. */
    oncreate,
    onclose,
  } = $props();

  const FROM_CASE = 'from-case';
  const CASE_TILE = {
    id: FROM_CASE, name: 'From the case', start: 'Geolocations, 1–14 March 2026', note: 'A period’s geolocations',
    body: FROM_CASE_SAMPLE, folder: '', look: FROM_CASE_LOOK,
  };

  /** The blank page first, then From the case, then the rest as they come. */
  const tiles = $derived(starts.flatMap((item) => (item.id === 'blank' ? [item, CASE_TILE] : [item])));

  let chosen = $state('');
  let title = $state('');
  let folder = $state('');
  let creating = $state(false);

  // the start picked, else the one the dialog was opened on, else the first
  const pickedId = $derived(tiles.some((item) => item.id === chosen) ? chosen
    : tiles.some((item) => item.id === start) ? start : (tiles[0]?.id ?? ''));
  const pickedTile = $derived(tiles.find((item) => item.id === pickedId) ?? null);
  const fromCase = $derived(pickedId === FROM_CASE);

  const ask = fromCaseAsk({ caseId: () => caseId, active: () => fromCase });

  const named = $derived(fromCase ? ask.title : (pickedTile?.start ?? pickedTile?.name ?? ''));
  const placeholder = $derived(freeTitle(named, taken));
  const canCreate = $derived(!creating && Boolean(pickedTile) && (!fromCase || ask.ready));

  async function create() {
    if (!canCreate) return;
    // read before anything changes: the picked start and the name it gets
    const item = pickedTile;
    const name = title.trim() || placeholder;
    const into = folder;
    const writing = fromCase ? ask.note(name) : null;
    creating = true;
    try {
      await oncreate?.(writing
        ? { title: writing.title, folder: into, body: writing.body, look: FROM_CASE_LOOK }
        : { title: name, folder: into || item.folder || '', body: item.body ?? '', look: item.look ?? null });
    } catch {
      // the caller says what failed; the dialog stays, ready for another press
    } finally {
      creating = false;
    }
  }

  /** Arrows walk the starts, as they do a group of radio buttons: the one reached is the one picked.
   *  Tab stops on the picked one only, so the fields under the tiles are one press away. */
  function walk(event) {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    const radios = [...event.currentTarget.parentElement.querySelectorAll('[role="radio"]')];
    const at = radios.indexOf(event.currentTarget);
    event.preventDefault();
    const next = radios[(at + step + radios.length) % radios.length];
    next.focus();
    chosen = next.dataset.start;
  }
</script>

<Modal title="New note" {onclose} width="720px">
  <div class="dialog">
    <div class="top">
      <div class="field name">
        <label for="notebook-note-title">Title</label>
        <!-- svelte-ignore a11y_autofocus -->
        <input id="notebook-note-title" class="input" {placeholder} bind:value={title} autofocus
          onkeydown={(event) => { if (event.key === 'Enter') create(); }} />
      </div>
      <div class="field where">
        <span id="notebook-note-folder">Folder</span>
        <FolderSelect bind:value={folder} {folders} emptyLabel="Unfiled" fresh />
      </div>
    </div>

    <div class="starts">
      <span id="notebook-note-start">Start from</span>
      <div class="tiles" role="radiogroup" aria-labelledby="notebook-note-start">
        {#each tiles as tile (tile.id)}
          <button type="button" role="radio" class="tile" class:on={pickedId === tile.id} aria-checked={pickedId === tile.id}
            tabindex={pickedId === tile.id ? 0 : -1} data-start={tile.id} title={tile.note}
            onclick={() => (chosen = tile.id)} onkeydown={walk}>
            <span class="stage"><PageThumb name={tile.start ?? tile.name} body={tile.body} look={tile.look} width={88} /></span>
            <span class="tile-name">{tile.name}</span>
            <span class="tile-said">{tile.note}</span>
          </button>
        {/each}
      </div>
    </div>

    {#if fromCase}
      <FromCaseFields {ask} />
    {/if}

    <div class="actions">
      <button type="button" class="btn" onclick={onclose}>Cancel</button>
      <button type="button" class="btn btn-primary" disabled={!canCreate} onclick={create}>{creating ? 'Creating…' : 'Create'}</button>
    </div>
  </div>
</Modal>

<style>
  /* the tiles take the room the rest leaves, so a laptop screen scrolls them and never the dialog */
  .dialog { display: flex; flex-direction: column; gap: 14px; max-height: calc(100vh - 160px); overflow-y: auto; padding: 3px; margin: -3px; }
  .top { display: flex; gap: 12px; }
  .field { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
  .name { flex: 1.4; }
  .where { flex: 1; }
  .field > label, .field > span, .starts > span { color: var(--text-2); font-size: var(--fs-sm); }
  .starts { display: flex; flex: 1 1 auto; min-height: 150px; flex-direction: column; gap: 6px; }
  .tiles {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); grid-auto-rows: max-content; gap: 10px;
    flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 2px;
  }
  .tile {
    display: flex; flex-direction: column; gap: 3px; padding: 0 0 9px; border: 1px solid var(--border); border-radius: var(--r-md);
    background: var(--bg-1); color: inherit; text-align: left; font: inherit; overflow: hidden;
  }
  .tile:hover { border-color: var(--text-3); }
  .tile.on { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); background: var(--accent-soft); }
  .tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .stage {
    display: flex; justify-content: center; height: 100px; padding-top: 10px; margin-bottom: 6px; overflow: hidden;
    background: var(--bg-0); border-bottom: 1px solid var(--border);
  }
  .tile-name {
    padding: 0 9px; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; line-height: 1.25;
    display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  }
  .tile-said { padding: 0 9px; color: var(--text-3); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
