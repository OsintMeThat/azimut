<script>
  /**
   * One routine's own page: what it is for, what it has found across every run
   * it has made, and the way to run it again.
   *
   * A routine is only worth saving if it remembers, so **Findings** is the
   * first thing on it: every candidate kept as a pin or kept here, newest run
   * first, each one a press away from the evidence it came from. Running it
   * again asks which pass to read rather than deciding silently, because that
   * choice costs a Copernicus request and an analyst usually knows which day
   * they are chasing.
   */
  import { STRENGTHS, readingOf } from '../../lib/map/analyzers.js';
  import { isActive, plural, ruleLabel, runState } from '../../lib/map/detections.js';
  import Icon from '../../components/Icon.svelte';

  let {
    detection,
    /** The routine as saved: its areas, analyzer and rule. Null while loading. */
    detail = null,
    findings = [],
    methods = [],
    busy = false,
    onrun = () => {},
    onexport = () => {},
    oncancel = () => {},
    onedit = () => {},
    ondelete = () => {},
    onopenrun = () => {},
    onopenfinding = () => {},
  } = $props();

  let tab = $state('findings');
  const methodOf = (method) => methods.find((m) => m.id === method) ?? {};
  const single = $derived(detection.single ?? !!methodOf(detection.method).single);
  const state = $derived(runState(detection.active ?? detection.latest));
  const reading = (row) => [
    STRENGTHS[row.strength],
    readingOf(detail?.recipe ?? { method: detection.method }, methods, row.measure),
  ].filter(Boolean).join(' · ');

</script>

<div class="cmp-dock-body">
  <section class="head">
    <h3>{detection.title}</h3>
    {#if detection.note}<p class="note">{detection.note}</p>{/if}
    <p class="meta">{[detection.analyzer, plural(detection.areas ?? 0, 'area'),
      ruleLabel(detection.date_rule, single)].filter(Boolean).join(' · ')}</p>
    <p class={`state ${state.tone}`}>{state.text}</p>
    {#if detection.active?.status === 'running'}
      <progress max={detection.active.total || 1} value={detection.active.progress ?? 0}></progress>
    {/if}
    <div class="row">
      {#if detection.active}
        <button class="btn btn-sm grow" disabled={busy} onclick={() => oncancel(detection.active)}>Stop this run</button>
      {:else}
        <button class="btn btn-primary grow" disabled={busy || !detail}
          onclick={onrun}>
          Run routine
        </button>
      {/if}
      <button class="cmp-icon" title="Snapshot what it kept as a SAT layer" aria-label="Export as layer"
        disabled={busy} onclick={onexport}><Icon name="layers" size={13} /></button>
      <button class="cmp-icon" title="Edit this routine" aria-label={`Edit ${detection.title}`} disabled={busy}
        onclick={onedit}><Icon name="edit" size={13} /></button>
      <button class="cmp-icon" title="Delete this routine" aria-label={`Delete ${detection.title}`} disabled={busy}
        onclick={ondelete}><Icon name="trash" size={13} /></button>
    </div>
  </section>

  <div class="cmp-seg fill" role="group" aria-label="What to show">
    <button class:on={tab === 'findings'} onclick={() => (tab = 'findings')}>
      Findings{findings.length ? ` · ${findings.length}` : ''}
    </button>
    <button class:on={tab === 'runs'} onclick={() => (tab = 'runs')}>
      Runs{detection.history.length ? ` · ${detection.history.length}` : ''}
    </button>
  </div>

  {#if tab === 'findings'}
    {#if !findings.length}
      <p class="hint">Nothing kept yet. Candidates you keep, as a pin or here, gather on this page.</p>
    {/if}
    {#each findings as row (`${row.run_id}-${row.id}`)}
      <button class="finding" disabled={busy} onclick={() => onopenfinding(row)}>
        <span class="line">
          <strong>{row.date || row.run_title}</strong>
          <span class={`chip ${row.review}`}>{row.review === 'kept' ? 'Pinned' : 'Kept here'}</span>
        </span>
        <span class="what">{row.phenomenon}{reading(row) ? ` · ${reading(row)}` : ''}</span>
        <span class="where">{row.coordinates[1].toFixed(4)}, {row.coordinates[0].toFixed(4)}</span>
      </button>
    {/each}
  {:else}
    {#if !detection.history.length}<p class="hint">Not run yet.</p>{/if}
    {#each detection.history as run (run.id)}
      {@const past = runState(run)}
      <div class="row">
        <button class="past grow" disabled={busy} onclick={() => onopenrun(run)}>
          <span class={past.tone}>{past.text}</span>
          <small>{run.dates?.[0] && run.dates[0] !== run.dates[1] ? `against ${run.dates[0]}` : 'one image'}</small>
        </button>
        {#if isActive(run)}
          <button class="cmp-icon" title="Stop this run" aria-label={`Stop ${run.title}`} disabled={busy}
            onclick={() => oncancel(run)}><Icon name="square" size={12} /></button>
        {/if}
      </div>
    {/each}
  {/if}
</div>

<style>
  .head { display: grid; gap: 7px; }
  h3 { margin: 0; font-size: var(--fs-sm); font-weight: 700; }
  .note { margin: 0; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.45; }
  .meta, .state { margin: 0; font-size: var(--fs-xs); }
  .meta { color: var(--text-3); }
  .state { color: var(--text-2); }
  .state.new { color: var(--accent); font-weight: 600; }
  .state.busy { color: var(--info); }
  .state.warn { color: var(--warn); }
  progress { width: 100%; height: 6px; accent-color: var(--accent); }
  .link { color: var(--accent); font-size: var(--fs-xs); text-align: left; justify-self: start; }
  .finding, .past {
    display: grid;
    gap: 2px;
    min-width: 0;
    padding: 6px 8px;
    border-radius: var(--r-sm);
    text-align: left;
  }
  .finding { border: 1px solid var(--border); background: var(--bg-2); }
  .finding:hover:not(:disabled), .past:hover:not(:disabled) { border-color: var(--accent); background: var(--bg-3); }
  .line { display: flex; align-items: center; gap: 7px; }
  .line strong { color: var(--text-1); font-size: var(--fs-xs); }
  .chip {
    padding: 1px 6px;
    border-radius: 99px;
    font-size: 10px;
    font-weight: 600;
    color: var(--text-2);
    background: var(--bg-3);
  }
  .chip.kept { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
  .chip.noted { color: var(--accent); background: var(--accent-soft); }
  .what { color: var(--text-2); font-size: var(--fs-xs); line-height: 1.4; }
  .where { color: var(--text-3); font-family: var(--font-mono); font-size: 10.5px; }
  .past small { color: var(--text-3); font-size: 10.5px; }
  .past .new { color: var(--accent); font-weight: 600; }
  .past .busy { color: var(--info); }
  .past .warn { color: var(--warn); }
</style>
