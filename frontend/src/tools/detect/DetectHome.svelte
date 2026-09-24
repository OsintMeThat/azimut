<script>
  /**
   * Where Detect opens: the routines of this case, and the single passes that
   * were swept once. The kind is chosen at the **+**, before any question is
   * asked, because it is what makes the difference between the two: a pass is
   * reviewed and done with, a routine is a place you keep coming back to.
   */
  import Icon from '../../components/Icon.svelte';
  import { isActive, plural, ruleLabel, runDays, runState, savedGroups } from '../../lib/map/detections.js';

  let {
    tab = 'routines',
    routines = [],
    passes = [],
    /** The saved runs drawn on the map, so a row can turn its own off. */
    layers = $bindable([]),
    methods = [],
    busy = false,
    onnew = () => {},
    onrun = () => {},
    onrunall = () => {},
    oncancel = () => {},
    onopen = () => {},
    onopenrun = () => {},
    ondelete = () => {},
    onhover = () => {},
    /** Put the map on some ground, so a layer turned on is a layer seen. */
    onframe = () => {},
    /** Snapshot what was kept into a SAT layer: `('runs' | 'followups', id)`. */
    onexport = () => {},
  } = $props();

  const single = (method) => !!methods.find((entry) => entry.id === method)?.single;
  const idle = $derived(routines.filter((item) => !item.active));
  const groups = $derived(savedGroups(routines, passes));
  /** Groups folded shut; every group opens unfolded. */
  let folded = $state({});

  const layerOf = (run) => layers.find((row) => row.id === run.id);
  /** A SAT layer holds what was kept or pinned, so a run with none has nothing to give it. */
  const kept = (runs) => runs.reduce((total, run) => total + (run.status === 'ready' ? run.marked ?? 0 : 0), 0);
  /** A routine's runs share its title, so under it a run is named by its days too. */
  const rowName = (group, run) => (group.kind === 'routine' && runDays(run) ? `${run.title} · ${runDays(run)}` : run.title);
  const layerTitle = (count) => (count ? 'Add to the SAT layers: what was kept or pinned'
    : 'Keep or pin a candidate first: the SAT layer holds only those');
  const groupLayers = (group) => group.runs.map(layerOf).filter(Boolean);

  /** Turn runs on or off together; turning them on frames the ground they cover. */
  function showRuns(shown, visible) {
    for (const layer of shown) layer.visible = visible;
    if (visible) onframe(shown.flatMap((layer) => layer.input?.zones ?? []));
  }

</script>

<div class="home">
  {#if tab === 'routines'}
  <section aria-label="Routines">
    {#if routines.length > 1}
      <div class="row head">
        <span class="grow"></span>
        <button class="btn btn-sm" disabled={busy || !idle.length} onclick={onrunall}
          title="Queue every routine that is not already working">
          <Icon name="play" size={11} /> Run all
        </button>
      </div>
    {/if}
    {#if !routines.length}
      <div class="empty">
        <p>No routine in this case yet.</p>
        <p class="hint">A routine is an area, what to look for there and what each pass compares against.</p>
        <button class="btn btn-sm" onclick={() => onnew('routine')}>Create a routine</button>
      </div>
    {/if}
    {#each routines as item (item.id)}
      {@const state = runState(item.active ?? item.latest)}
      <article class="card" style={`--tint: ${item.colour || 'var(--accent)'}`}>
        <div class="row">
          <button class="title grow" disabled={busy} title="Open this routine" onclick={() => onopen(item)}
            onmouseenter={() => onhover(item.id)} onmouseleave={() => onhover(null)}
            onfocus={() => onhover(item.id)} onblur={() => onhover(null)}>{item.title}</button>
          {#if item.active}
            <button class="cmp-icon" title="Stop this run" aria-label={`Stop ${item.title}`} disabled={busy}
              onclick={() => oncancel(item.active)}><Icon name="square" size={12} /></button>
          {:else}
            <button class="cmp-icon go" title="Run the newest pass" aria-label={`Run ${item.title}`} disabled={busy}
              onclick={() => onrun(item)}><Icon name="play" size={13} /></button>
          {/if}
          <button class="cmp-icon" title="Delete" aria-label={`Delete ${item.title}`} disabled={busy}
            onclick={() => ondelete('followups', item)}><Icon name="trash" size={13} /></button>
        </div>
        {#if item.note}<p class="note">{item.note}</p>{/if}
        <p class="meta">{[item.analyzer, plural(item.areas ?? 0, 'area'),
          ruleLabel(item.date_rule, item.single ?? single(item.method))].filter(Boolean).join(' · ')}</p>
        <p class={`state ${state.tone}`}>{state.text}</p>
        {#if item.active?.status === 'running'}
          <progress max={item.active.total || 1} value={item.active.progress ?? 0}></progress>
        {/if}
      </article>
    {/each}
  </section>
  {/if}

  {#if tab === 'saved'}
    <section aria-label="Saved runs">
      {#if !passes.length}
        <div class="empty">
          <p>Nothing has been swept in this case yet.</p>
          <p class="hint">A run lands here when it finishes, whichever tool you are in.</p>
          <button class="btn btn-sm" onclick={() => onnew('once')}>Sweep an area once</button>
        </div>
      {/if}
      {#each groups as group (group.id)}
        {@const shown = groupLayers(group)}
        {@const allOn = shown.length > 0 && shown.every((layer) => layer.visible)}
        <div class="group" style={`--tint: ${group.colour || 'var(--text-3)'}`}>
          <div class="row group-head">
            <button class="fold grow" aria-expanded={!folded[group.id]}
              onclick={() => (folded = { ...folded, [group.id]: !folded[group.id] })}>
              <Icon name={folded[group.id] ? 'chevronRight' : 'chevronDown'} size={12} />
              {#if group.kind === 'routine'}<span class="swatch" aria-hidden="true"></span>{/if}
              <span class="name">{group.title}</span>
              <small>{plural(group.runs.length, 'run')}</small>
            </button>
            {#if group.kind === 'routine'}
              <button class="cmp-icon" disabled={busy || !kept(group.runs)} title={layerTitle(kept(group.runs))}
                aria-label={`Add ${group.title} to the SAT layers`} onclick={() => onexport('followups', group.id)}>
                <Icon name="layers" size={13} />
              </button>
            {/if}
            {#if shown.length}
              <button class="cmp-icon" aria-pressed={allOn} onclick={() => showRuns(shown, !allOn)}
                aria-label={`${allOn ? 'Hide' : 'Show'} every run of ${group.title} on the map`}
                title={allOn ? 'Hide them all on the map' : 'Show them all on the map'}>
                <Icon name={allOn ? 'eye' : 'eyeOff'} size={14} />
              </button>
            {/if}
          </div>
          {#if !folded[group.id]}
            {#each group.runs as run (run.id)}
              {@const state = runState(run)}
              {@const layer = layerOf(run)}
              {@const name = rowName(group, run)}
              <div class="row single">
                <button class="past grow" disabled={busy} onclick={() => onopenrun(run)}>
                  {#if group.kind === 'routine'}
                    <span class={state.tone}>{state.text}</span>
                    {#if runDays(run)}<small class="what">{runDays(run)}</small>{/if}
                  {:else}
                    <span>{run.title}</span>
                    <small class={state.tone}>{state.text}</small>
                    <small class="what">{[run.analyzer, run.areas ? plural(run.areas, 'area') : ''].filter(Boolean).join(' · ')}</small>
                  {/if}
                </button>
                {#if run.status === 'ready'}
                  <button class="cmp-icon" disabled={busy || !kept([run])} title={layerTitle(kept([run]))}
                    aria-label={`Add ${name} to the SAT layers`} onclick={() => onexport('runs', run.id)}>
                    <Icon name="layers" size={13} />
                  </button>
                {/if}
                {#if layer}
                  <button class="cmp-icon" aria-label={`${layer.visible ? 'Hide' : 'Show'} ${name} on the map`}
                    aria-pressed={layer.visible} title={layer.visible ? 'Hide on the map' : 'Show on the map'}
                    onclick={() => showRuns([layer], !layer.visible)}>
                    <Icon name={layer.visible ? 'eye' : 'eyeOff'} size={14} />
                  </button>
                {/if}
                {#if isActive(run)}
                  <button class="cmp-icon" title="Stop this run" aria-label={`Stop ${name}`} disabled={busy}
                    onclick={() => oncancel(run)}><Icon name="square" size={12} /></button>
                {:else}
                  <button class="cmp-icon" title="Delete" aria-label={`Delete ${name}`} disabled={busy}
                    onclick={() => ondelete('runs', run)}><Icon name="trash" size={13} /></button>
                {/if}
              </div>
            {/each}
          {/if}
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .home { display: grid; gap: 16px; }
  section { display: grid; gap: 8px; }
  .empty {
    display: grid;
    gap: 4px;
    padding: 14px 12px;
    border: 1px dashed var(--border);
    border-radius: var(--r-sm);
    text-align: center;
  }
  .empty p { margin: 0; font-size: var(--fs-xs); color: var(--text-2); }
  .empty button { justify-self: center; margin-top: 4px; }
  .card {
    display: grid;
    gap: 3px;
    padding: 8px 6px 8px 10px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--tint);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .card .row { gap: 2px; }
  .title {
    min-width: 0;
    overflow: hidden;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-align: left;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .title:hover:not(:disabled) { color: var(--accent); }
  .go { color: var(--accent); }
  .note, .meta, .state { margin: 0; font-size: var(--fs-xs); line-height: 1.4; }
  .note { color: var(--text-2); }
  .meta { color: var(--text-3); }
  .state { color: var(--text-2); }
  .state.new { color: var(--accent); font-weight: 600; }
  .state.busy { color: var(--info); }
  .state.warn { color: var(--warn); }
  progress { width: 100%; height: 6px; accent-color: var(--accent); }
  .past {
    display: grid;
    gap: 1px;
    min-width: 0;
    padding: 4px 6px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-align: left;
  }
  .past:hover:not(:disabled) { background: var(--bg-3); }
  .past span { color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .past small { color: var(--text-2); font-size: 10.5px; }
  .past small.new { color: var(--accent); font-weight: 600; }
  .past small.busy { color: var(--info); }
  .past small.warn { color: var(--warn); }
  .past small.what { color: var(--text-3); }
  .past span.new { color: var(--accent); font-weight: 600; }
  .past span.busy { color: var(--info); }
  .past span.warn { color: var(--warn); }
  .single { gap: 2px; padding-left: 14px; }
  .group { display: grid; gap: 2px; }
  .group-head { gap: 2px; }
  .fold {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 3px 4px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-align: left;
    text-transform: uppercase;
  }
  .fold:hover { background: var(--bg-2); color: var(--text-1); }
  .fold .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fold small { flex: 0 0 auto; color: var(--text-3); font-weight: 400; letter-spacing: 0; text-transform: none; white-space: nowrap; }
  .swatch { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 2px; background: var(--tint); }
</style>
