<script>
  /**
   * What a detection can look for, shared by every case.
   *
   * A built-in is a method calibrated on real scenes. One of your own starts as
   * a copy of the closest built-in, which is the only way to make one: the
   * method comes with it, and what is yours is how picky it is, what it is
   * called and how it looks on the map. Saying that up front is the point of
   * this page; a method picked from a list of six told nobody what they were
   * choosing between.
   */
  import { api } from '../../lib/api.js';
  import { toast } from '../../lib/state.svelte.js';
  import { analyzerGroups, analyzerLock, clone } from '../../lib/map/analyzers.js';
  import AnalyzerSettings from './AnalyzerSettings.svelte';
  import Icon from '../../components/Icon.svelte';

  let { catalogue, onchanged = async () => {}, onsaved = () => {} } = $props();

  /** 'list', 'base' (what a new one starts from) or 'edit'. */
  let mode = $state('list');
  let recipe = $state(null);
  let readonly = $state(false);
  let busy = $state(false);
  let error = $state('');

  const builtins = $derived(catalogue?.builtins ?? []);
  const custom = $derived(catalogue?.custom ?? []);
  const methodOf = (method) => catalogue?.methods?.find((m) => m.id === method) ?? {};
  const capability = $derived(methodOf(recipe?.method));
  const isNew = $derived(recipe?.id === 'custom');

  async function act(fn) {
    if (busy) return;
    busy = true; error = '';
    try { await fn(); } catch (e) { error = e.message; }
    finally { busy = false; }
  }

  function view(entry) {
    recipe = clone(entry);
    readonly = builtins.some((r) => r.id === entry.id);
    mode = 'edit';
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

  async function save() {
    const saved = await api.post('/api/compare/analyzers', clone(recipe));
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
    <p class="hint">An analyzer is what a detection looks for: one calibrated method and how picky it is. Yours start as a copy of the closest built-in.</p>
    <button class="btn btn-primary" onclick={() => (mode = 'base')}><Icon name="plus" size={14} /> New analyzer</button>

    <section aria-label="My analyzers">
      <strong>Mine</strong>
      {#if !custom.length}<p class="hint">None yet.</p>{/if}
      {#each custom as entry (entry.id)}
        <div class="row entry">
          <button class="pick grow" style={`--tint: ${entry.colour}`} disabled={busy} onclick={() => view(entry)}>
            <span class="swatch" aria-hidden="true"></span>
            <span class="name">{entry.name}<small>{methodOf(entry.method).label ?? entry.method}</small></span>
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
    <h3>Start from</h3>
    <p class="hint">Pick the analyzer closest to what you want to find. Its method comes with it; you tune the rest.</p>
    <div class="bases">
      {#each [...builtins, ...custom] as entry (entry.id)}
        <button class="pick base" style={`--tint: ${entry.colour}`} onclick={() => copy(entry)}>
          <span class="swatch" aria-hidden="true"></span>
          <span class="name">{entry.name}<small>{entry.description || methodOf(entry.method).label}</small></span>
        </button>
      {/each}
    </div>
  </div>
  <div class="cmp-dock-foot"><button class="btn btn-sm" onclick={back}>Cancel</button></div>
{:else if recipe}
  <div class="cmp-dock-body">
    {#if error}<p class="warn" role="alert">{error}</p>{/if}
    <h3>{isNew ? 'New analyzer' : readonly ? recipe.name : `Edit ${recipe.name}`}</h3>
    <p class="measures"><span>Measures</span> {capability.label ?? recipe.method}</p>
    {#if readonly}<p class="hint">A built-in can't be changed. Copy it to tune your own.</p>{/if}
    <fieldset class="fields" disabled={readonly}>
      <label title="The name shown in the analyzer library across all cases.">Name
        <input aria-label="Analyzer name" bind:value={recipe.name} maxlength="120" />
      </label>
      <label title="What this analyzer looks for, and what it cannot tell you.">Description
        <textarea bind:value={recipe.description} maxlength="500"></textarea>
      </label>
    </fieldset>
    <AnalyzerSettings bind:recipe {capability} expanded {readonly} />
    <details>
      <summary>Label and colour</summary>
      <fieldset class="fields" disabled={readonly}>
        <label title="The label each candidate carries. It does not change what is detected.">Candidate label
          <input bind:value={recipe.phenomenon} maxlength="120" />
        </label>
        <div class="row">
          <label class="grow">Colour<input type="color" bind:value={recipe.colour} /></label>
          <label class="grow">Layer style
            <select bind:value={recipe.style}>
              <option value="both">Pins and outlines</option><option value="pins">Pins</option><option value="outlines">Outlines with pins</option>
            </select>
          </label>
        </div>
      </fieldset>
    </details>
  </div>
  <div class="cmp-dock-foot">
    <div class="row">
      <button class="btn btn-sm" onclick={back}>{readonly ? 'Back' : 'Cancel'}</button>
      {#if readonly}
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
  .bases { display: grid; gap: 6px; }
  .swatch { flex: 0 0 auto; width: 9px; height: 9px; margin-top: 4px; border-radius: 50%; background: var(--tint); }
  .name { display: grid; gap: 2px; min-width: 0; color: var(--text-1); font-size: var(--fs-xs); font-weight: 600; }
  .name small { color: var(--text-3); font-size: 10.5px; font-weight: 400; line-height: 1.4; }
  .measures { margin: 0; color: var(--text-1); font-size: var(--fs-xs); }
  .measures span { margin-right: 4px; color: var(--text-3); font-weight: 700; }
  .fields { display: grid; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
  details { display: grid; gap: 8px; }
  details[open] { padding-top: 4px; }
  summary { color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
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
