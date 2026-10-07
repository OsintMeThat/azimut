<script>
  /**
   * What a detection can look for, shared by every case.
   *
   * A built-in is a method calibrated on real scenes; a copy of one keeps the
   * method and tunes how picky it is. One of your own is built from rules
   * instead, each a line a pixel has to cross, tried on the map as it is
   * written (AnalyzerBuilder). The two are offered side by side because they
   * are different promises: calibrated, or exactly what you set. An example
   * is one of your own already made, with the checks that show it working.
   *
   * A new one of your own starts by saying what it reads: Sentinel-2 or radar,
   * and one date or the change between two. That is fixed from then on, so the
   * rules it is given and the checks that prove it always fit it.
   */
  import { onDestroy, untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { toast } from '../../lib/state.svelte.js';
  import { analyzerGroups, analyzerLock, clone } from '../../lib/map/analyzers.js';
  import { downloadAnalyzer, importAnalyzerFile, importNotes } from '../../lib/analyzerFile.js';
  import { describeChecks, describeReads, newRecipe } from '../../lib/map/analyzerRules.js';
  import AnalyzerBuilder from './AnalyzerBuilder.svelte';
  import AnalyzerLabel from './AnalyzerLabel.svelte';
  import AnalyzerSettings from './AnalyzerSettings.svelte';
  import FoldGroup from './FoldGroup.svelte';
  import Icon from '../../components/Icon.svelte';
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';

  let {
    catalogue,
    onchanged = async () => {},
    onsaved = () => {},
    /** What the map draws while an analyzer of your own is being built (the bench). */
    builder = $bindable(null),
    viewBounds = () => null,
    /** The Copernicus layers on offer and a way to frame a place: what the
     *  builder needs of the map. */
    layers = [],
    layerState = null,
    onfly = () => {},
  } = $props();

  /** 'list', 'base' (what a new one reads, and starts from), 'edit' (a copy of a
   *  built-in) or 'build' (rules of your own). */
  let mode = $state('list');
  let recipe = $state(null);
  /** Counts the analyzers opened in the builder, so each one gets a bench of its own. */
  let session = $state(0);
  /** What a new analyzer of your own will read, asked before anything else. */
  let reads = $state({ sensor: 'sentinel2', dates: 'two' });
  /** Where the builder opens: `{ tab, check }`. */
  let start = $state(null);
  let readonly = $state(false);
  /** Built-in categories opened by hand; all start folded. */
  let openKinds = $state({});
  let busy = $state(false);
  // The analyzer whose deletion is being confirmed: its rules, checks and calibration
  // are app-wide and have no Trash to come back from.
  let deleting = $state(null);
  // The analyzer being handed on, and whether its checks go with it. Checks are
  // what lets the other analyst rerun the calibration, and they carry the
  // coordinates it was calibrated on, so the choice is made in the open.
  let sharing = $state(null);
  let withChecks = $state(true);
  let fileInput = $state(null);
  /** What an analyzer that just arrived may not do here. Stays until the next move. */
  let notice = $state([]);
  let error = $state('');

  // The map holds the builder's bench only while a builder is open, and this is what lets it go: on
  // leaving the builder, and on leaving the library. An analyzer opened while another is, takes it over.
  $effect(() => {
    if (mode !== 'build') untrack(() => { builder = null; });
  });
  onDestroy(() => { builder = null; });

  const builtins = $derived(catalogue?.builtins ?? []);
  const custom = $derived(catalogue?.custom ?? []);
  const examples = $derived(catalogue?.examples ?? []);
  /** The examples that read what was asked for. */
  const matching = $derived(examples.filter((example) => example.recipe.sensor === reads.sensor && example.recipe.dates === reads.dates));
  const radarLock = $derived(catalogue?.radar_layer ? '' : analyzerLock({ method: 'rules', sensor: 'sentinel1' }, catalogue));
  const methodOf = (method) => catalogue?.methods?.find((m) => m.id === method) ?? {};
  const capability = $derived(methodOf(recipe?.method));
  const isNew = $derived(recipe?.id === 'custom');

  async function act(fn) {
    if (busy) return;
    busy = true; error = '';
    try { await fn(); } catch (e) { error = e.message; }
    finally { busy = false; }
  }

  /**
   * Hand this analyzer on as a file. Only checks are a decision, so an analyzer
   * without any downloads on the press and the rest ask first.
   */
  function share(entry) {
    if (!entry.checks?.length) { downloadAnalyzer(entry.id); return; }
    withChecks = true;
    sharing = entry;
  }

  async function importFile(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = ''; // so the same file picked twice fires again
    if (!file) return;
    notice = [];
    await act(async () => {
      const result = await importAnalyzerFile(file);
      await onchanged();
      notice = importNotes(result);
      toast(`${result.analyzer.name} is in your analyzers`, 'ok');
    });
  }

  function view(entry, opening = null) {
    notice = [];
    recipe = entry.method === 'rules' ? { checks: [], ...clone(entry) } : clone(entry);
    readonly = builtins.some((r) => r.id === entry.id);
    start = opening;
    session++;
    mode = entry.method === 'rules' ? 'build' : 'edit';
  }

  function build(from = newRecipe(catalogue?.methods ?? [], reads)) {
    notice = [];
    recipe = { checks: [], ...clone(from), id: 'custom' };
    readonly = false;
    start = null;
    session++;
    mode = 'build';
  }

  /** A name no analyzer of the library has yet: "Fresh burn", then "Fresh burn 2". */
  function freeName(name) {
    const taken = new Set(custom.map((entry) => entry.name));
    let next = name;
    for (let n = 2; taken.has(next); n++) next = `${name} ${n}`;
    return next;
  }

  /**
   * An example is copied into the library at once, checks and all, and opens
   * on its checks with the first one on the map: running them is the lesson.
   */
  async function startExample(example) {
    const saved = await api.post('/api/compare/analyzers', { ...clone(example.recipe), id: 'custom',
      name: freeName(example.recipe.name) });
    await onchanged();
    toast(`${saved.name} is in your analyzers, with its checks`, 'ok');
    view(saved, { tab: 'checks', check: saved.checks?.[0]?.id ?? null });
  }

  /** Open one of the analyst's own analyzers, as if picked from the list. */
  export function openEntry(id) {
    const entry = custom.find((row) => row.id === id);
    if (entry) view(entry);
  }

  /** Built-ins can't be written over, so a copy is how an analyst keeps a tuned version. */
  function copy(entry) {
    recipe = { ...clone(entry), id: 'custom', name: `${entry.name} copy` };
    readonly = false;
    mode = 'edit';
  }

  function back() {
    mode = 'list';
    recipe = null;
  }

  async function save(next = recipe) {
    const saved = await api.post('/api/compare/analyzers', clone(next));
    await onchanged();
    onsaved(saved);
    toast('Analyzer saved for all cases', 'ok');
    back();
  }

  async function remove(entry) {
    await api.del(`/api/compare/analyzers/${entry.id}`);
    await onchanged();
    toast('Analyzer removed from the library', 'ok');
  }
</script>

{#if mode === 'list'}
  <div class="cmp-dock-body">
    {#if error}<p class="warn" role="alert">{error}</p>{/if}
    <p class="hint">Start from an example, build your own from rules you prove on the map, or copy a calibrated built-in to tune it.</p>
    <div class="row">
      <button class="btn btn-primary grow" onclick={() => (mode = 'base')}><Icon name="plus" size={14} /> New analyzer</button>
      <button class="btn" title="Open an analyzer file someone shared with you" disabled={busy}
        onclick={() => fileInput?.click()}><Icon name="upload" size={13} /> Import</button>
    </div>
    <input type="file" accept="application/json,.json" bind:this={fileInput} onchange={importFile} hidden />

    <section aria-label="My analyzers">
      <strong>Mine</strong>
      {#if notice.length}
        <ul class="notice" aria-label="About the analyzer you imported">
          {#each notice as line (line)}<li>{line}</li>{/each}
        </ul>
      {/if}
      {#if !custom.length}<p class="hint">None yet.</p>{/if}
      {#each custom as entry (entry.id)}
        <div class="row entry">
          <button class="pick grow" style={`--tint: ${entry.colour}`} disabled={busy} onclick={() => view(entry)}>
            <span class="swatch" aria-hidden="true"></span>
            <span class="name">{entry.name}<small>{entry.method === 'rules' ? entry.description || methodOf(entry.method).label : methodOf(entry.method).label ?? entry.method}</small>{#if describeChecks(entry)}<small class="checked">{describeChecks(entry)}</small>{/if}</span>
          </button>
          <button class="cmp-icon" title="Edit" aria-label={`Edit ${entry.name}`} disabled={busy} onclick={() => view(entry)}>
            <Icon name="edit" size={13} />
          </button>
          <button class="cmp-icon" title="Share" aria-label={`Share ${entry.name}`} disabled={busy}
            onclick={() => share(entry)}><Icon name="download" size={13} /></button>
          <button class="cmp-icon" title="Delete" aria-label={`Delete ${entry.name}`} disabled={busy}
            onclick={() => (deleting = entry)}><Icon name="trash" size={13} /></button>
        </div>
      {/each}
    </section>

    <section aria-label="Built-in analyzers">
      <strong>Built in</strong>
      {#each analyzerGroups({ ...catalogue, custom: [] }) as group (group.label)}
        <FoldGroup label={group.label} count={group.list.length} open={!!openKinds[group.label]}
          ontoggle={() => (openKinds = { ...openKinds, [group.label]: !openKinds[group.label] })}>
          {#each group.list as entry (entry.id)}
            {@const trust = catalogue?.reliability?.[entry.id]}
            {@const locked = analyzerLock(entry, catalogue)}
            <div class="row entry">
              <button class="pick grow" style={`--tint: ${entry.colour}`} onclick={() => view(entry)} title={locked || undefined}>
                <span class="swatch" aria-hidden="true"></span>
                <span class="name">{entry.name}{#if trust} <span class="trust {trust}">({trust})</span>{/if}{#if locked} <span class="lock"><Icon name="key" size={10} /> set up</span>{/if}<small>{entry.description}</small></span>
              </button>
              <button class="cmp-icon" title="Copy to tune" aria-label={`Copy ${entry.name}`} onclick={() => copy(entry)}>
                <Icon name="copy" size={13} />
              </button>
            </div>
          {/each}
        </FoldGroup>
      {/each}
    </section>
  </div>
{:else if mode === 'base'}
  <div class="cmp-dock-body">
    {#if error}<p class="warn" role="alert">{error}</p>{/if}
    <h3>New analyzer</h3>
    <p class="hint">What it reads is fixed from here on, so its rules and checks always fit it.</p>

    <section aria-label="What it reads">
      <span class="ask">Satellite</span>
      <div class="cmp-seg fill" role="group" aria-label="Satellite">
        <button type="button" class:on={reads.sensor === 'sentinel2'} aria-pressed={reads.sensor === 'sentinel2'}
          onclick={() => (reads = { ...reads, sensor: 'sentinel2' })}>Sentinel-2 · optical</button>
        <button type="button" class:on={reads.sensor === 'sentinel1'} aria-pressed={reads.sensor === 'sentinel1'}
          onclick={() => (reads = { ...reads, sensor: 'sentinel1' })}>Sentinel-1 · radar</button>
      </div>
      {#if reads.sensor === 'sentinel1'}
        <p class="hint">Radar sees through cloud and at night.{#if radarLock} <span class="lock"><Icon name="key" size={10} /> {radarLock}</span>{/if}</p>
      {:else}
        <p class="hint">Colour and infrared, where the sky is clear.</p>
      {/if}
      <span class="ask">Dates</span>
      <div class="cmp-seg fill" role="group" aria-label="Dates">
        <button type="button" class:on={reads.dates === 'one'} aria-pressed={reads.dates === 'one'}
          onclick={() => (reads = { ...reads, dates: 'one' })}>One date</button>
        <button type="button" class:on={reads.dates === 'two'} aria-pressed={reads.dates === 'two'}
          onclick={() => (reads = { ...reads, dates: 'two' })}>Two dates</button>
      </div>
      <p class="hint">{reads.dates === 'one' ? 'Spots what is there on a day, like a ship or a fire.'
        : 'Finds what changed between a day before and a day after.'}</p>
    </section>

    <section aria-label="Start from">
      <span class="ask">Start from</span>
      <button class="pick base own" onclick={() => build()}>
        <span class="swatch" aria-hidden="true"></span>
        <span class="name">Blank<small>One rule to begin with.</small></span>
      </button>
      {#each matching as example (example.id)}
        <button class="pick base grow" style={`--tint: ${example.recipe.colour}`} disabled={busy}
          aria-label={`Start from the example ${example.recipe.name}`} onclick={() => act(() => startExample(example))}>
          <span class="swatch" aria-hidden="true"></span>
          <span class="name">{example.recipe.name}<small>{example.place} · {example.when} · {example.recipe.checks.length} checks</small></span>
        </button>
      {/each}
      {#if !matching.length}
        <p class="hint">No ready example for {describeReads(reads)} yet.</p>
      {:else}
        <p class="hint">An example comes with checks that turn red when a rule you change breaks one.</p>
      {/if}
    </section>
  </div>
  <div class="cmp-dock-foot"><button class="btn btn-sm" onclick={back}>Cancel</button></div>
{:else if mode === 'build' && recipe}
  {#key session}
    <AnalyzerBuilder {catalogue} bind:recipe isNew={isNew} {start} bind:builder {viewBounds} {layers} {layerState} {onfly}
      onsave={(next) => save(next)} oncancel={back} />
  {/key}
{:else if recipe}
  <div class="cmp-dock-body">
    {#if error}<p class="warn" role="alert">{error}</p>{/if}
    <h3>{isNew ? 'New analyzer' : readonly ? recipe.name : `Edit ${recipe.name}`}</h3>
    <p class="measures"><span>Measures</span> {capability.label ?? recipe.method}</p>
    {#if readonly}<p class="hint">A built-in can't be changed, so copy it to tune your own.</p>{/if}
    <fieldset class="fields" disabled={readonly}>
      <label title="The name shown in the analyzer library across all cases.">Name
        <input aria-label="Analyzer name" bind:value={recipe.name} maxlength="120" />
      </label>
      <label title="What this analyzer looks for, and what it cannot tell you.">Description
        <textarea bind:value={recipe.description} maxlength="500"></textarea>
      </label>
    </fieldset>
    <AnalyzerSettings bind:recipe {capability} expanded {readonly} />
    <AnalyzerLabel bind:recipe {readonly} />
  </div>
  <div class="cmp-dock-foot">
    <div class="row">
      <button class="btn btn-sm" onclick={back}>{readonly ? 'Back' : 'Cancel'}</button>
      {#if readonly}
        {#if catalogue?.as_rules?.[recipe.id]}
          <button class="btn btn-sm" onclick={() => build(catalogue.as_rules[recipe.id])}>Open as rules</button>
        {/if}
        <button class="btn btn-primary grow" onclick={() => copy(recipe)}>Copy to tune</button>
      {:else}
        <button class="btn btn-primary grow" disabled={busy || !recipe.name.trim()} onclick={() => act(save)}>
          {isNew ? 'Add to my analyzers' : 'Save changes'}
        </button>
      {/if}
    </div>
    {#if !readonly}<span class="reason">Shared by every case, and carried by Settings backup.</span>{/if}
  </div>
{/if}

{#if sharing}
  <ConfirmDialog
    title={`Share ${sharing.name}`}
    message="Downloads a file to hand on. It carries the rules and none of your keys."
    confirmLabel="Download"
    icon="download"
    onconfirm={() => { const entry = sharing; sharing = null; downloadAnalyzer(entry.id, { checks: withChecks }); }}
    oncancel={() => (sharing = null)}>
    <label class="opt">
      <input type="checkbox" bind:checked={withChecks} />
      <span>Include its {sharing.checks.length} check{sharing.checks.length === 1 ? '' : 's'}
        <small>They let the other analyst rerun your calibration, and they carry the places and dates you ran it on.</small>
      </span>
    </label>
  </ConfirmDialog>
{/if}

{#if deleting}
  <ConfirmDialog
    title={`Delete ${deleting.name}`}
    message="It leaves the library for every case, with its rules and checks."
    detail="Nothing brings it back. A copy in a settings backup can."
    confirmLabel="Delete"
    tone="danger"
    onconfirm={() => { const entry = deleting; deleting = null; act(() => remove(entry)); }}
    oncancel={() => (deleting = null)} />
{/if}

<style>
  section { display: grid; gap: 4px; }
  section > strong {
    margin-bottom: 2px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  h3 { margin: 0; font-size: var(--fs-sm); font-weight: 700; }
  .entry { gap: 2px; }
  .pick {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    min-width: 0;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    text-align: left;
  }
  .pick:hover:not(:disabled) { background: var(--bg-2); }
  .base { border: 1px solid var(--border); background: var(--bg-2); }
  .base:hover { border-color: var(--accent); }
  .ask { color: var(--text-2); font-size: var(--fs-xs); font-weight: 700; }
  .notice { margin: 0 0 2px; padding-left: 15px; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.45; }
  .opt { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
  .opt span { display: grid; gap: 3px; color: var(--text-1); font-weight: 600; }
  .opt small { color: var(--text-3); font-weight: 400; line-height: 1.4; }
  .name small.checked { color: var(--text-2); }
  .swatch { flex: 0 0 auto; width: 9px; height: 9px; margin-top: 4px; border-radius: 50%; background: var(--tint); }
  .name { display: grid; gap: 2px; min-width: 0; color: var(--text-1); font-size: var(--fs-xs); font-weight: 600; }
  .name small { color: var(--text-3); font-size: 10.5px; font-weight: 400; line-height: 1.4; }
  .measures { margin: 0; color: var(--text-1); font-size: var(--fs-xs); }
  .measures span { margin-right: 4px; color: var(--text-3); font-weight: 700; }
  .fields { display: grid; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
  .own { border-color: var(--accent); --tint: var(--accent); }
  .trust { color: var(--text-3); font-size: 10.5px; font-weight: 400; }
  .trust.reliable { color: var(--ok, #46a758); }
  .trust.rough { color: var(--warn, #e2a03f); }
  .lock { display: inline-flex; align-items: center; gap: 3px; color: var(--accent); font-size: 10.5px; font-weight: 400; }
</style>
