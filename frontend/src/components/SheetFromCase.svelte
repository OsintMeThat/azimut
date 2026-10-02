<script>
  /**
   * A worklist made out of what the case already believes.
   *
   * The missing half of the promotion road. Rows have always been able to become entities;
   * an analyst holding forty places in the graph and wanting to work through them had to
   * retype the forty, because the Board has nowhere to write a verdict and the sheet had no
   * way to hear about the graph.
   *
   * Two shapes, and the choice is the first thing asked because it decides everything
   * after it.
   *
   * **One row per entity** takes a type and the fields that deserve a column. Nothing else
   * travels — a sheet holding every attribute of every entity would be a second copy of the
   * graph, and the second copy is the one that goes stale. The rows come back pointing at
   * what they came from, so editing them and promoting them again updates those entities
   * rather than minting twins.
   *
   * **My geolocations** takes neither: its shape is fixed, one row per point a proof
   * concludes on, with the media it rests on and what Geo Proof says about it. That fixed shape is what lets it
   * be kept level with the case afterwards, which the other one cannot be.
   *
   * **Files to geolocate** is the same kind of fixed shape turned the other way: one row
   * per picture or video the analyst imported, done once a proof answers for it.
   */
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import { entityFields, entityLabel, loadEntityTypes } from '../lib/entityTypes.svelte.js';

  let { caseId, busy = false, onmake, onclose } = $props();

  /** What the route takes at most. Mirrors `engine/sheetfromcase.MAX_FROM_CASE`: past two
   *  thousand rows nobody works through it, and the honest answer is a filtered Board. */
  const MAX_ROWS = 2000;

  let shape = $state('generic');
  let counts = $state([]);
  let files = $state(null);
  let type = $state('');
  let fields = $state([]);
  let title = $state('');
  let touched = $state(false);

  loadEntityTypes();

  $effect(() => {
    if (!caseId) return;
    let live = true;
    api
      .get(`/api/cases/${caseId}/catalog/summary`)
      .then((answer) => {
        if (!live) return;
        counts = Object.entries(answer.by_type ?? {})
          .map(([id, count]) => ({ id, count }))
          .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
        if (!type && counts.length) type = counts[0].id;
      })
      .catch(() => {});
    api
      .get(`/api/cases/${caseId}/sheets/from-case/files`)
      .then((answer) => live && (files = answer))
      .catch(() => {});
    return () => (live = false);
  });

  // The fields belong to the type, so a choice made for a person means nothing for a place.
  $effect(() => {
    void type;
    fields = [];
  });

  // Named after what it holds until the analyst says otherwise, which is what they would
  // have typed anyway.
  $effect(() => {
    if (touched) return;
    if (proofs) title = 'My geolocations';
    else if (filesShape) title = 'Files to geolocate';
    else if (type) title = `${entityLabel(type)} to check`;
  });

  const proofs = $derived(shape === 'proofs');
  const filesShape = $derived(shape === 'files');
  const fixed = $derived(proofs || filesShape);
  const available = $derived(entityFields(type).filter((field) => field.kind !== 'geojson'));
  // The fixed shapes count what they are made of, whatever type the other branch is on.
  const held = $derived(
    filesShape
      ? (files?.total ?? 0)
      : (counts.find((entry) => entry.id === (proofs ? 'proof' : type))?.count ?? 0),
  );
  const taken = $derived(Math.min(held, MAX_ROWS));
  const ready = $derived(Boolean((fixed || type) && title.trim() && held));

  function toggle(key) {
    fields = fields.includes(key) ? fields.filter((entry) => entry !== key) : [...fields, key];
  }
</script>

<div class="from-case">
  <p class="label">What the sheet is</p>
  <div class="shapes">
    <button class="shape" class:on={!fixed} onclick={() => (shape = 'generic')}>
      <strong>One row per entity</strong>
      <small>a worklist over a type you choose</small>
    </button>
    <button class="shape" class:on={filesShape} onclick={() => (shape = 'files')}>
      <strong>Files to geolocate</strong>
      <small>one row per imported picture or video</small>
    </button>
    <button class="shape" class:on={proofs} onclick={() => (shape = 'proofs')}>
      <strong>My geolocations</strong>
      <small>one row per point of every proof, POV included</small>
    </button>
  </div>

  {#if !fixed}
  <p class="label">What is in it</p>
  {#if counts.length}
    <div class="types">
      {#each counts as entry (entry.id)}
        <button class="chip" class:on={type === entry.id} onclick={() => (type = entry.id)}>
          <Icon name={entityIcon({ type: entry.id })} size={11} />
          {entityLabel(entry.id)} <small>{entry.count}</small>
        </button>
      {/each}
    </div>
  {:else}
    <p class="note">This case holds no entities yet.</p>
  {/if}
  {/if}

  <label class="row">
    <span>Name</span>
    <input class="input" bind:value={title} placeholder="Places to check"
           oninput={() => (touched = true)} />
  </label>

  {#if !fixed && available.length}
    <p class="label">
      And which fields get a column. None is fine if the sheet only carries your own.
    </p>
    <div class="fields">
      {#each available as field (field.key)}
        <label class="check">
          <input type="checkbox" checked={fields.includes(field.key)}
                 onchange={() => toggle(field.key)} />
          <span title={field.hint ?? ''}>{field.label}</span>
        </label>
      {/each}
    </div>
  {/if}

  <p class="says" class:none={!ready}>
    {#if !held}
      {proofs
        ? 'This case holds no proofs yet.'
        : filesShape
          ? 'No picture or video was imported into this case yet.'
          : 'This case holds nothing of that type.'}
    {:else if filesShape}
      <strong>{taken}</strong> {taken === 1 ? 'row' : 'rows'}, one per imported picture or
      video, {files?.answered ?? 0} already with a proof.
      {#if held > MAX_ROWS}<span>Only the first {MAX_ROWS} by name.</span>{/if}
    {:else if proofs}
      One row per point of {taken} {taken === 1 ? 'proof' : 'proofs'}, POV or not, with the
      date, the place, its coordinates, the source and the description.
      {#if held > MAX_ROWS}<span>Only the first {MAX_ROWS} by name.</span>{/if}
    {:else}
      <strong>{taken}</strong> {taken === 1 ? 'row' : 'rows'}, one per
      {entityLabel(type).toLowerCase()}, plus a status and a note to work in.
      {#if held > MAX_ROWS}<span>Only the first {MAX_ROWS} by name.</span>{/if}
    {/if}
  </p>
  <p class="note">
    {#if filesShape && files?.sheet}
      This case already has this worklist, so building here makes a second one.
    {:else if fixed}
      The case writes those columns and Refresh keeps them level, while Status, Notes and any
      column you add are yours.
    {:else}
      Each row points back at what it came from, so promoting it later updates that entity
      instead of making a second one.
    {/if}
  </p>

  <div class="modal-row">
    <div class="spacer"></div>
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn btn-primary" disabled={busy || !ready}
            onclick={() => onmake({ title: title.trim(), shape, type, fields, limit: MAX_ROWS })}>
      {busy ? 'Building' : 'Build the sheet'}
    </button>
  </div>
</div>

<style>
  .from-case { display: flex; flex-direction: column; min-height: 0; }
  .label { color: var(--text-3); font-size: var(--fs-xs); margin: 12px 0 5px; line-height: 1.5; }
  .label:first-child { margin-top: 0; }
  .shapes { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .shape {
    display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; text-align: left;
    border: 1px solid var(--border); border-radius: var(--r-sm); background: var(--bg-2);
  }
  .shape:hover { border-color: var(--border-strong); }
  .shape.on { border-color: var(--accent); background: var(--accent-soft); }
  .shape strong { color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .shape.on strong { color: var(--accent); }
  .shape small { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; }
  .types { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px; padding: 3px 8px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs);
  }
  .chip:hover { border-color: var(--border-strong); color: var(--text-1); }
  .chip.on { border-color: var(--accent); color: var(--accent); }
  .chip small { color: var(--text-3); }
  .row {
    display: grid; grid-template-columns: 90px minmax(0, 1fr); align-items: center;
    gap: 8px; margin-top: 12px;
  }
  .row span { color: var(--text-2); font-size: var(--fs-sm); }
  .fields {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 10px;
    max-height: 180px; overflow: auto;
  }
  .check { display: flex; align-items: center; gap: 7px; color: var(--text-2); font-size: var(--fs-xs); }
  .check span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .says {
    margin-top: 12px; padding: 6px 8px; border-radius: var(--r-sm);
    background: var(--accent-soft); color: var(--accent); font-size: var(--fs-xs);
    line-height: 1.5;
  }
  .says.none { background: var(--bg-2); color: var(--text-3); }
  .says strong { font-weight: 600; }
  .says span { color: var(--text-3); }
  .note { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; padding: 4px 0; }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .spacer { flex: 1; }
</style>
