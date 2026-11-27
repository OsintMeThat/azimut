<script>
  /**
   * `/` › Interactive map: what a map in the note shows. The case's layers, or one of its
   * Map plates (its layers as it draws them, its days and steps), and the proofs of a
   * period over either. The ground is taken once, on Put, from the imagery picked
   * (`lib/notes/mapPut.js`), Sentinel-2 unless another is: the PDF and the HTML file keep
   * that picture, and a web folder's live map streams the same imagery.
   *
   * **Start an empty map** frames a place instead (`NoteMapStart.svelte`, loaded on that
   * press with the map it shows) and puts a map of its own, drawn on in the note.
   */
  import { onMount } from 'svelte';
  import { api } from '../lib/api.js';
  import { ESRI_TERMS } from '../lib/notes/editor/mapText.js';
  import { mapRequest, proofsPeriod } from '../lib/notes/mapPut.js';
  import Modal from './Modal.svelte';
  import MapLayerList from './MapLayerList.svelte';

  let { caseId, onput, onclose, load = (id) => api.get(`/api/cases/${encodeURIComponent(id)}/notes/maps/sources`) } = $props();

  let sources = $state(null);
  let failed = $state('');
  let source = $state('layers');
  let chosen = $state([]);
  let plate = $state('');
  let proofs = $state({ on: false, from: '', to: '' });
  let title = $state('');
  let provider = $state('');
  /** Whether the dialog frames a place for an empty map rather than picking what the case holds. */
  let starting = $state(false);

  onMount(async () => {
    try {
      sources = await load(caseId);
      provider = sources?.provider ?? '';
      proofs = { on: false, from: sources?.proofs?.first ?? '', to: sources?.proofs?.last ?? '' };
      if (!sources?.layers?.length && sources?.plates?.length) source = 'plate';
    } catch (error) {
      failed = error?.message || 'The case’s layers could not be read';
    }
  });

  const layers = $derived(sources?.layers ?? []);
  const plates = $derived(sources?.plates ?? []);
  const proofCount = $derived(sources?.proofs?.count ?? 0);
  const asked = $derived(mapRequest({
    title,
    layers: source === 'layers' ? chosen : [],
    plate: source === 'plate' ? plate : '',
    proofs: proofsPeriod(proofs),
    provider,
  }));
  const ready = $derived(Boolean(asked.layers?.length || asked.plate || asked.proofs));

  /** Where an empty map opens: on the case's layers when it has some, else on the world. */
  const home = $derived.by(() => {
    const boxes = layers.map((one) => one.bbox).filter((box) => Array.isArray(box) && box.length === 4);
    if (!boxes.length) return { lat: 20, lon: 10, zoom: 3 };
    const west = Math.min(...boxes.map((box) => box[0]));
    const south = Math.min(...boxes.map((box) => box[1]));
    const east = Math.max(...boxes.map((box) => box[2]));
    const north = Math.max(...boxes.map((box) => box[3]));
    const span = Math.max(east - west, north - south, 0.01);
    return { lat: (south + north) / 2, lon: (west + east) / 2, zoom: Math.max(3, Math.min(14, Math.round(Math.log2(360 / span)))) };
  });

  function put() {
    if (!ready) return;
    const named = asked.title || (asked.plate ? plates.find((one) => one.name === asked.plate)?.title
      : layers.filter((one) => chosen.includes(one.name)).map((one) => one.title).join(', ')) || 'Map';
    onput({ ...asked, title: named });
  }
</script>

<Modal title="Interactive map" width={starting ? '860px' : '460px'} {onclose}>
  {#if starting}
    {#await import('./NoteMapStart.svelte') then { default: NoteMapStart }}
      <NoteMapStart {home} providers={sources?.providers ?? []} bind:title onback={() => (starting = false)}
        onstart={(request) => onput({ empty: request })} />
    {/await}
  {:else}
  <form class="map-picker" onsubmit={(event) => { event.preventDefault(); put(); }}>
    {#if failed}
      <p class="said error">{failed}</p>
    {:else if !sources}
      <p class="said">Reading the case…</p>
    {:else}
      <label class="field">
        <span>Title</span>
        <input class="input" bind:value={title} maxlength="200" placeholder="The front, 1 September to 15 November" data-guide="notebook.map-title" />
      </label>

      <div class="choice" role="radiogroup" aria-label="What the map shows">
        <button type="button" role="radio" aria-checked={source === 'layers'} class:on={source === 'layers'}
          onclick={() => (source = 'layers')}>Layers</button>
        <button type="button" role="radio" aria-checked={source === 'plate'} class:on={source === 'plate'}
          disabled={!plates.length} title={plates.length ? 'Its layers, days, steps and framing' : 'This case has no Map plate'}
          onclick={() => (source = 'plate')}>A Map plate</button>
      </div>

      {#if source === 'layers'}
        <MapLayerList {layers} bind:chosen />
      {:else}
        <div class="list" role="radiogroup" aria-label="Map plates">
          {#each plates as one (one.name)}
            <label class="row">
              <input type="radio" name="map-plate" value={one.name} bind:group={plate} />
              <span class="name">{one.title}</span>
              <small>{one.steps ? `${one.steps} step${one.steps === 1 ? '' : 's'}` : `${one.layers} layer${one.layers === 1 ? '' : 's'}`}</small>
            </label>
          {/each}
        </div>
      {/if}

      <div class="proofs">
        <label class="row">
          <input type="checkbox" bind:checked={proofs.on} disabled={!proofCount} />
          <span class="name">Proofs{proofCount ? '' : ': none dated yet'}</span>
          {#if proofCount}<small>{proofCount}</small>{/if}
        </label>
        {#if proofs.on}
          <div class="period">
            <label><span>From</span><input class="input" type="date" bind:value={proofs.from} /></label>
            <label><span>To</span><input class="input" type="date" bind:value={proofs.to} /></label>
          </div>
        {/if}
      </div>

      {#if sources.providers?.length > 1}
        <label class="field">
          <span>Ground</span>
          <select class="input" bind:value={provider} data-guide="notebook.map-ground">
            {#each sources.providers as one (one.id)}<option value={one.id}>{one.label}</option>{/each}
          </select>
        </label>
      {/if}
      <p class="said">{provider === 'esri-world-imagery' ? ESRI_TERMS : 'The ground is fetched once, now, and kept in the case.'}</p>
    {/if}
    <div class="actions">
      <button type="button" class="btn btn-ghost start" disabled={!sources} title="Frame a place, then put points, lines and areas on it"
        onclick={() => (starting = true)}>Start an empty map</button>
      <button type="button" class="btn btn-ghost" onclick={() => onclose?.()}>Cancel</button>
      <button type="submit" class="btn btn-primary" disabled={!ready} data-guide="notebook.map-put">Put the map</button>
    </div>
  </form>
  {/if}
</Modal>

<style>
  .map-picker { display: flex; flex-direction: column; gap: 12px; }
  .field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-2); }
  .choice { display: flex; gap: 4px; padding: 3px; border-radius: 8px; background: var(--surface-2); }
  .choice button { flex: 1; padding: 6px 8px; border: 0; border-radius: 6px; background: none; color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer; }
  .choice button.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 1px 2px rgba(0, 0, 0, .18); }
  .choice button:disabled { opacity: .45; cursor: default; }
  .list { display: flex; flex-direction: column; max-height: 220px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; }
  .row { display: flex; align-items: center; gap: 8px; padding: 7px 10px; font-size: 13px; cursor: pointer; }
  .list .row + .row { border-top: 1px solid var(--border); }
  .row .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row small { color: var(--text-3); font-variant-numeric: tabular-nums; }
  .proofs { border: 1px solid var(--border); border-radius: 8px; }
  .period { display: flex; gap: 8px; padding: 0 10px 10px; }
  .period label { flex: 1; display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--text-2); }
  .said { margin: 0; font-size: 12px; color: var(--text-3); }
  .said.error { color: var(--danger); }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
  .actions .start { margin-right: auto; }
</style>
