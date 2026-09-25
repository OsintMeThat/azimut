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
   */
  import { api } from '../../lib/api.js';
  import { toast } from '../../lib/state.svelte.js';
  import { analyzerGroups, analyzerLock, clone } from '../../lib/map/analyzers.js';
  import { describeChecks, newRecipe } from '../../lib/map/analyzerRules.js';
  import AnalyzerBuilder from './AnalyzerBuilder.svelte';
  import AnalyzerLabel from './AnalyzerLabel.svelte';
  import AnalyzerSettings from './AnalyzerSettings.svelte';
  import Icon from '../../components/Icon.svelte';

  let {
    catalogue,
    onchanged = async () => {},
    onsaved = () => {},
    /** What the map draws while an analyzer of your own is being built. */
    builder = $bindable(null),
    viewBounds = () => null,
    /** The settled camera, the Copernicus layers on offer and a way to frame a
     *  place: what the builder needs of the map. */
    mapView = null,
    layers = [],
    onfly = () => {},
    onshow = () => {},
    onleavepass = () => {},
    onblink = () => {},
  } = $props();

  /** 'list', 'base' (what a new one starts from), 'edit' (a copy of a
   *  built-in) or 'build' (rules of your own). */
  let mode = $state('list');
  let bench = $state(null);
  let recipe = $state(null);
  /** Where the builder opens: `{ tab, check }`. */
  let start = $state(null);
  let readonly = $state(false);
  let busy = $state(false);
  let error = $state('');

  const builtins = $derived(catalogue?.builtins ?? []);
  const custom = $derived(catalogue?.custom ?? []);
  const examples = $derived(catalogue?.examples ?? []);
  const methodOf = (method) => catalogue?.methods?.find((m) => m.id === method) ?? {};
  const capability = $derived(methodOf(recipe?.method));
  const isNew = $derived(recipe?.id === 'custom');

  async function act(fn) {
    if (busy) return;
    busy = true; error = '';
    try { await fn(); } catch (e) { error = e.message; }
    finally { busy = false; }
  }

  function view(entry, opening = null) {
    recipe = entry.method === 'rules' ? { checks: [], ...clone(entry) } : clone(entry);
    readonly = builtins.some((r) => r.id === entry.id);
    start = opening;
    mode = entry.method === 'rules' ? 'build' : 'edit';
  }

  function build(from = newRecipe(catalogue?.methods ?? [])) {
    recipe = { checks: [], ...clone(from), id: 'custom' };
    readonly = false;
    start = null;
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

  /** Read every rule at a point of the map, while one is being built, and
   *  mark that point in a check. */
  export function probeAt(point) { return bench?.probeAt(point); }
  export function closeProbe() { bench?.closeProbe(); }
  export function markProbe(expect) { bench?.markProbe(expect); }
  export function pinAt(point) { bench?.pinAt(point); }
  export function pinMode(mode) { bench?.pinMode(mode); }
  export function showPass(which) { bench?.showPass(which); }

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
    <p class="hint">Start from an example, build your own from rules you try on the map, or copy a calibrated built-in to tune it.</p>
    <button class="btn btn-primary" onclick={() => (mode = 'base')}><Icon name="plus" size={14} /> New analyzer</button>

    <section aria-label="My analyzers">
      <strong>Mine</strong>
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
          <button class="cmp-icon" title="Delete" aria-label={`Delete ${entry.name}`} disabled={busy}
            onclick={() => act(() => remove(entry))}><Icon name="trash" size={13} /></button>
        </div>
      {/each}
    </section>

    <section aria-label="Built-in analyzers">
      <strong>Built in</strong>
      {#each analyzerGroups({ ...catalogue, custom: [] }) as group (group.label)}
        <p class="group">{group.label}</p>
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
      {/each}
    </section>
  </div>
{:else if mode === 'base'}
  <div class="cmp-dock-body">
    {#if error}<p class="warn" role="alert">{error}</p>{/if}
    {#if examples.length}
      <h3>Start from an example</h3>
      <p class="hint">A ready analyzer whose checks turn red when a rule you change breaks one.</p>
      <div class="examples">
        {#each examples as example (example.id)}
          <button class="pick base grow" style={`--tint: ${example.recipe.colour}`} disabled={busy}
            aria-label={`Start from the example ${example.recipe.name}`} onclick={() => act(() => startExample(example))}>
            <span class="swatch" aria-hidden="true"></span>
            <span class="name">{example.recipe.name}<small>{example.place} · {example.when} · {example.recipe.checks.length} checks</small></span>
          </button>
        {/each}
      </div>
    {/if}
    <button class="pick base own" onclick={() => build()}>
      <span class="swatch" aria-hidden="true"></span>
      <span class="name">Build your own rules<small>Say what a pixel has to show, on A, on B or between them, and watch each rule on the map as you set it.</small></span>
    </button>
    <h3>Or start from a built-in</h3>
    <p class="hint">A built-in brings its calibrated method for you to tune, and one marked rules opens as the rules it applies.</p>
    <div class="bases">
      {#each [...builtins, ...custom] as entry (entry.id)}
        {@const rules = catalogue?.as_rules?.[entry.id]}
        <div class="row entry">
          <button class="pick base grow" style={`--tint: ${entry.colour}`} onclick={() => (entry.method === 'rules' ? build({ ...entry, name: `${entry.name} copy` }) : copy(entry))}>
            <span class="swatch" aria-hidden="true"></span>
            <span class="name">{entry.name}<small>{entry.description || methodOf(entry.method).label}</small></span>
          </button>
          {#if rules}
            <button class="btn btn-sm" title="Open it as the rules it applies" aria-label={`Open ${entry.name} as rules`}
              onclick={() => build(rules)}>rules</button>
          {/if}
        </div>
      {/each}
    </div>
  </div>
  <div class="cmp-dock-foot"><button class="btn btn-sm" onclick={back}>Cancel</button></div>
{:else if mode === 'build' && recipe}
  <AnalyzerBuilder bind:this={bench} {catalogue} bind:recipe isNew={isNew} {start} bind:builder {viewBounds} {mapView} {layers} {onfly} {onshow} {onleavepass} {onblink}
    onsave={(next) => save(next)} oncancel={back} />
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
  .bases, .examples { display: grid; gap: 6px; }
  .examples { margin-bottom: 4px; }
  .name small.checked { color: var(--text-2); }
  .swatch { flex: 0 0 auto; width: 9px; height: 9px; margin-top: 4px; border-radius: 50%; background: var(--tint); }
  .name { display: grid; gap: 2px; min-width: 0; color: var(--text-1); font-size: var(--fs-xs); font-weight: 600; }
  .name small { color: var(--text-3); font-size: 10.5px; font-weight: 400; line-height: 1.4; }
  .measures { margin: 0; color: var(--text-1); font-size: var(--fs-xs); }
  .measures span { margin-right: 4px; color: var(--text-3); font-weight: 700; }
  .fields { display: grid; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
  .own { border-color: var(--accent); --tint: var(--accent); }
  .group {
    margin: 8px 0 2px;
    color: var(--text-3);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .trust { color: var(--text-3); font-size: 10.5px; font-weight: 400; }
  .trust.reliable { color: var(--ok, #46a758); }
  .trust.rough { color: var(--warn, #e2a03f); }
  .lock { display: inline-flex; align-items: center; gap: 3px; color: var(--accent); font-size: 10.5px; font-weight: 400; }
</style>
