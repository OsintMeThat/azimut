<script>
  /**
   * What one run found, reviewed one candidate at a time. Pinning is the only
   * act that creates case evidence; dismissing deletes the candidate. A
   * run still working shows how far it got and can be stopped from here.
   */
  import { onDestroy, untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { prefs, reloadCase, toast, uiState } from '../../lib/state.svelte.js';
  import { refreshRuns } from '../../lib/detectRuns.svelte.js';
  import { STRENGTHS, readingOf, sourceLabel } from '../../lib/map/analyzers.js';
  import { recipeCapability } from '../../lib/map/analyzerRules.js';
  import { sweptNote } from '../../lib/map/acquisitions.js';
  import { isActive, plural } from '../../lib/map/detections.js';
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import {
    blinkable, candidatePair, candidateSize, comparePairFor, orderCandidates, pinDefaults,
  } from '../../lib/map/detectReview.js';
  import { formatArea, formatDistance } from '../../lib/measure.js';

  let {
    caseId,
    run,
    /** Whether the review is on screen: the dock keeps it mounted while
     *  collapsed, and a key must not change a verdict nobody can see. */
    active = true,
    methods = [],
    candidateId = $bindable(null),
    /** The detection's drawing taken off the map, so the imagery shows bare. */
    bare = $bindable(false),
    /** Pass A flipped against pass B on the map, while the pair has two dates. */
    blinking = $bindable(false),
    onaccept = () => {},
    onfocus = () => {},
    onedit = () => {},
    onshow = () => {},
    onexport = () => {},
    onadd = () => {},
    /** The two passes the candidate was read between, `{ a, b }`, or null once gone. */
    onpair = () => {},
  } = $props();

  let busy = $state(false);
  let error = $state('');
  let filter = $state('all');
  let order = $state('strength');
  let enlarged = $state(false);
  let pin = $state(null);
  let adding = $state(false);
  let manualArea = $state('');

  const base = $derived(`/api/cases/${caseId}/analysis/runs/${run.id}`);
  const pending = $derived(isActive(run));
  const all = $derived(run.results ?? []);
  /** The queue in the order asked: strongest first, or the largest hulls first. */
  const ordered = $derived(orderCandidates(all, order));
  /** Which candidates the arrows walk. A sweep of a hundred is worked in
   *  passes — the ones nobody has judged, then what was kept — so the queue
   *  narrows rather than being scrolled. */
  const candidates = $derived(filter === 'all' ? ordered : ordered.filter((row) => matches(row, filter)));
  const candidate = $derived(all.find((r) => r.id === candidateId));
  const size = $derived(candidateSize(candidate));
  const pair = $derived(candidatePair(candidate, run));
  const canBlink = $derived(run.status === 'ready' && blinkable(pair));
  $effect(() => { if (!canBlink && blinking) blinking = false; });
  const matches = (row, name) => (name === 'new' ? row.review === 'new'
    : name === 'kept' ? row.review === 'noted' : row.review === 'kept');
  const position = $derived(candidates.findIndex((r) => r.id === candidateId));
  const counts = $derived.by(() => {
    const tally = { kept: 0, noted: 0, dismissed: 0, new: 0 };
    for (const row of candidates) tally[row.review] = (tally[row.review] ?? 0) + 1;
    return tally;
  });
  const verdicts = $derived([
    counts.kept ? `${counts.kept} pinned` : '',
    counts.noted ? `${counts.noted} kept here` : '',
    counts.dismissed ? `${counts.dismissed} dismissed` : '',
  ].filter(Boolean).join(', ') || 'no verdict yet');
  const tally = $derived(
    counts.new === 0 ? `All ${candidates.length} reviewed · ${verdicts}`
    : `${counts.new} still to review · ${verdicts}`
  );
  const previewAlt = $derived(recipeCapability(run.input.recipe, methods).single
    ? 'Candidate evidence' : 'Candidate evidence: A on the left, B on the right');
  const statusLabel = (status) => ({ queued: 'Queued', running: 'Running', ready: 'Completed',
    failed: 'Failed', cancelled: 'Cancelled', no_new_imagery: 'No new imagery' }[status] ?? status);
  const dates = (input) => recipeCapability(input.recipe, methods).single || !(input.a?.date || input.a?.release)
    ? sourceLabel(input.b) : `${sourceLabel(input.a)} → ${sourceLabel(input.b)}`;
  /** A candidate's reading, in the words its method's catalogue entry gives. */
  const reading = (row, input) => [
    STRENGTHS[row.strength],
    readingOf(input.recipe, methods, row.measure),
  ].filter(Boolean).join(' · ');
  /** Sentinel-2 reads 10 m to the pixel, so a candidate metres across is only
   *  worth judging from close in: the review asks for that zoom, not the
   *  wide frame the area list leaves behind. */
  const focus = (coordinates) => onfocus(coordinates, 16);
  // The map shows the pass a candidate was read on, and only a different pass
  // changes it. Showing it writes the map's own state, which this must not
  // read back: a radar pass is an object, so every write looked new, and the
  // effect fed itself until Svelte stopped the whole page.
  const passKey = (source) => (source?.date ? [source.provider, source.date, source.time ?? '', source.layer ?? ''].join('|') : '');
  let shownPass = '';
  $effect(() => {
    const source = pair.b;
    const key = passKey(source);
    if (!key || key === shownPass) return;
    shownPass = key;
    untrack(() => onshow(source));
  });
  // The map blinks the pair it is told about, for the same reason by key.
  let toldPair = '';
  $effect(() => {
    const told = pair;
    const key = `${passKey(told.a)}/${passKey(told.b)}`;
    if (key === toldPair) return;
    toldPair = key;
    untrack(() => onpair(told));
  });
  onDestroy(() => onpair(null));
  // The map goes where the panel is: judging a candidate you cannot see is
  // guesswork, and that held whenever a run was opened rather than stepped
  // through. Only a change of candidate moves the camera, so panning is free.
  let shownCandidate = '';
  $effect(() => {
    const row = candidate;
    if (!row || row.id === shownCandidate) return;
    shownCandidate = row.id;
    focus(row.coordinates);
  });

  /**
   * A sweep leaves a queue of candidates, and a queue is worked with the hands
   * on the keys: the arrows walk it, K, D and P are the three verdicts.
   */
  function shortcut(event) {
    if (!active || !run || run.status !== 'ready' || busy || pin || enlarged || event.ctrlKey || event.metaKey || event.altKey
      || event.target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
    const key = event.key.toLowerCase();
    // Shift and an arrow turn the map, so the queue takes the bare arrows only
    if (event.shiftKey && event.key.startsWith('Arrow')) return;
    if (event.key === 'ArrowLeft') step(-1);
    else if (event.key === 'ArrowRight') step(1);
    else if (key === 'h') bare = !bare;
    else if (key === 'b' && canBlink) blinking = !blinking;
    else if (!candidate) return;
    else if (key === 'k' && !['kept', 'noted'].includes(candidate.review)) void act(() => review('noted'));
    else if (key === 'd' && candidate.review !== 'kept') void act(() => review('dismissed'));
    else if (key === 'p' && candidate.review !== 'kept') openPin();
    else return;
    event.preventDefault();
  }

  async function act(fn) {
    if (busy) return;
    busy = true; error = '';
    try { await fn(); } catch (e) { error = e.message; }
    finally { busy = false; }
  }

  async function applyResult(row) {
    const results = row.review === 'dismissed' ? run.results.filter((r) => r.id !== row.id)
      : run.results.map((r) => (r.id === row.id ? row : r));
    await onaccept({ ...run, results, count: results.length });
    if (row.review === 'dismissed') candidateId = results.find((r) => r.review === 'new')?.id ?? results[0]?.id ?? null;
    await refreshRuns(caseId);
  }

  /** Reviewing is a queue: a verdict moves on to the next one still waiting. */
  function advance() {
    const index = ordered.findIndex((r) => r.id === candidateId);
    for (let i = 1; i <= ordered.length; i++) {
      const row = ordered[(index + i) % ordered.length];
      if (row?.review === 'new') { candidateId = row.id; focus(row.coordinates); return; }
    }
  }

  async function review(value) {
    await applyResult(await api.patch(`${base}/results/${candidateId}`, { review: value }));
    if (value === 'noted') advance();
  }

  /**
   * A second look before the verdict: Compare on the passes that found it, or
   * on today's high-resolution picture for something present on one pass.
   */
  function openInCompare() {
    const pair = comparePairFor(candidate, {
      single: !!recipeCapability(run.input.recipe, methods).single, method: run.input.recipe.method,
    });
    if (!pair) return;
    uiState.compareAt = pair;
    uiState.tool = 'compare';
  }

  /** The pin's name has to mean something in the case, long after this run. */
  function openPin() { pin = pinDefaults(candidate, !!recipeCapability(run.input.recipe, methods).single); }

  async function keep() {
    const answer = await api.post(`${base}/results/${candidateId}/promote`, pin);
    pin = null;
    await applyResult(answer.result);
    await reloadCase();
    toast('Pin and evidence saved in this case', 'ok');
    advance();
  }

  async function undoKeep() {
    const answer = await api.del(`${base}/results/${candidateId}/promote`);
    await applyResult(answer.result);
    await reloadCase();
    toast('The pin went to Trash', 'ok');
  }

  async function cancel() {
    onaccept(await api.post(`${base}/cancel`, {}));
    await refreshRuns(caseId);
  }

  function step(direction) {
    if (!candidates.length) return;
    const index = position >= 0 ? position : direction > 0 ? -1 : 0;
    const row = candidates[(index + direction + candidates.length) % candidates.length];
    if (row) { candidateId = row.id; focus(row.coordinates); }
  }
</script>

<svelte:window onkeydown={shortcut} />
<div class="cmp-dock-body review-body">
{#if error}<p class="warn" role="alert">{error}</p>{/if}

<section class="run">
  <div class="row run-head">
    <strong class="grow">{run.title}</strong>
    {#if !pending}
      <button class="link" onclick={onedit}>{run.input?.followup_id ? 'Edit this detection' : 'Edit and rerun'}</button>
    {/if}
  </div>
  <p class="hint">{[
    statusLabel(run.status),
    run.status === 'ready' ? plural(run.total, 'tile') : `${run.progress}/${run.total} tiles`,
    run.input?.b ? dates(run.input) : '',
  ].filter(Boolean).join(' · ')}</p>
  {#if pending}
    <progress max={run.total || 1} value={run.progress}></progress>
    <p class="hint">It keeps going if you leave Detect; the top bar shows how far it got.</p>
    <button class="btn btn-sm" disabled={busy} onclick={() => act(cancel)}>Cancel</button>
  {/if}
  {#if run.message}<p class="hint" role="status">{run.message}</p>{/if}
  <!-- "Nothing found" and "never looked" are not the same answer. -->
  {#if sweptNote(run.swept)}<p class="warn">{sweptNote(run.swept)}</p>{/if}
  {#if run.status === 'ready' && !candidates.length}<p class="hint">Nothing passed these thresholds.</p>{/if}
  {#if run.status === 'ready'}
    <div class="row"><button class="btn btn-sm" onclick={() => {
      adding = !adding;
      manualArea = candidate?.area_id ?? run.area_runs?.find((p) => p.status === 'ready')?.area_id ?? run.input.zones[0]?.id ?? '';
    }}>Add candidate</button>
      <button class="btn btn-sm" onclick={onexport}>Export as layer</button>
      <span class="map-acts">
        <button class="cmp-icon" class:on={bare} aria-pressed={bare} aria-label="Hide the candidates and areas"
          title="Hide the candidates and areas (H)" onclick={() => (bare = !bare)}><Icon name={bare ? 'eyeOff' : 'eye'} size={14} /></button>
        {#if canBlink}
          <button class="cmp-icon" class:on={blinking} aria-pressed={blinking} aria-label="Blink A and B"
            title="Blink A and B on the map (B)" onclick={() => (blinking = !blinking)}><Icon name="blink" size={14} /></button>
        {/if}
      </span></div>
    {#if adding}
      <label>Area<select aria-label="Manual candidate area" bind:value={manualArea}>
        <option value="">Choose an area</option>
        {#each run.input.zones as area (area.id)}
          {#if !run.area_runs || run.area_runs.some((p) => p.area_id === area.id && p.status === 'ready')}
            <option value={area.id}>{area.name}</option>
          {/if}
        {/each}
      </select></label>
      <div class="row"><button class="btn btn-sm" disabled={!manualArea} onclick={() => onadd(manualArea, 'point')}>Add point</button>
        <button class="btn btn-sm" disabled={!manualArea} onclick={() => onadd(manualArea, 'polygon')}>Draw candidate</button></div>
    {/if}
  {/if}
</section>

{#if candidate}
  <section class="candidate">
    <div class="row filters" role="group" aria-label="Which candidates to walk">
      {#each [['all', 'All', all.length], ['new', 'To review', counts.new], ['kept', 'Kept', counts.noted], ['pinned', 'Pinned', counts.kept]] as [id, label, n]}
        {#if id === 'all' || n}
          <button class="chip" class:on={filter === id} aria-pressed={filter === id}
            onclick={() => (filter = id)}>{label} <span class="n">{n}</span></button>
        {/if}
      {/each}
      <!-- A new order starts from its own top: the largest is what was asked for. -->
      <button class="chip order" class:on={order === 'size'} aria-pressed={order === 'size'}
        title="Walk the longest first, rather than the strongest"
        onclick={() => {
          order = order === 'size' ? 'strength' : 'size';
          if (candidates[0]) candidateId = candidates[0].id;
        }}>Largest first</button>
    </div>
    <div class="row nav">
      <button class="cmp-icon" aria-label="Previous candidate" title="Previous candidate (←)" onclick={() => step(-1)}><Icon name="chevronLeft" size={14} /></button>
      <span class="grow centre position">{position >= 0 ? `${position + 1} of ${candidates.length}` : 'outside this filter'}</span>
      <button class="cmp-icon" aria-label="Next candidate" title="Next candidate (→)" onclick={() => step(1)}><Icon name="chevronRight" size={14} /></button>
    </div>
    <strong class:manual={candidate.origin === 'manual'}>{candidate.phenomenon}{candidate.origin === 'manual' ? ' · Manual' : ''}</strong>
    {#if candidate.area_name}<p class="hint">{candidate.area_name} · {candidate.sources?.a.date !== candidate.sources?.b.date ? `${candidate.sources?.a.date} → ` : ''}{candidate.sources?.b.date}</p>{/if}
    <!-- The column is narrow, and a pair of 20-metre crops in it is small. One
         press opens the same picture at the size of the window. -->
    <button class="preview-open" title="See it bigger" aria-label="Enlarge the evidence"
      onclick={() => (enlarged = true)}>
      <img class="preview" src={`${base}/results/${candidate.id}/preview`} alt={previewAlt} />
    </button>
    {#if reading(candidate, run.input)}
      <p class={`strength ${candidate.strength ?? ''}`}>{reading(candidate, run.input)}</p>
    {/if}
    <p class="facts">
      {formatArea(candidate.area, prefs.units)} ·
      {#if size}<span title="Measured on the footprint’s 10 m pixels">≈ {formatDistance(size.length, prefs.units)} long, {formatDistance(size.width, prefs.units)} wide</span> ·{/if}
      <button class="link inline" onclick={() => focus(candidate.coordinates)}>
        {candidate.coordinates[1].toFixed(5)}, {candidate.coordinates[0].toFixed(5)}
      </button>
    </p>
    <button class="btn btn-sm compare" onclick={openInCompare}
      title={recipeCapability(run.input.recipe, methods).single
        ? 'Hold it against today’s high-resolution picture in Compare'
        : 'Read the two passes that found it in Compare'}>
      <Icon name="compare" size={13} /> Compare
    </button>

  </section>
{/if}
</div>

{#if run.status === 'ready'}
  <footer class="cmp-dock-foot review-actions" aria-label="Candidate review">
    <div class="review-status">
      {#if candidate?.review === 'kept'}
        <p class="verdict kept"><Icon name="check" size={13} /> Kept as a pin in this case</p>
        <button class="link" disabled={busy} onclick={() => act(undoKeep)}>Undo and send the pin to Trash</button>
      {:else if candidate?.review === 'noted'}
        <p class="verdict noted"><Icon name="bookmark" size={13} /> Kept in this detection</p>
      {:else if candidate?.review === 'dismissed'}
        <button class="link" disabled={busy} onclick={() => act(() => review('new'))}>Put it back among the candidates</button>
      {:else}
        <p class="hint">Keep stays in this run. Pin creates a place and evidence in Files.</p>
        <p class="keys">K keep · D dismiss · P pin · ← → walk the queue</p>
      {/if}
    </div>
    <div class="verdict-row">
      <button class="btn btn-sm" disabled={busy || !candidate || ['kept', 'noted'].includes(candidate.review)} onclick={() => act(() => review('noted'))}>Keep</button>
      <button class="btn btn-sm" disabled={busy || !candidate || candidate.review === 'kept'} onclick={() => act(() => review('dismissed'))}>Dismiss</button>
      <button class="btn btn-primary" disabled={busy || !candidate || candidate.review === 'kept'} onclick={openPin}>Pin</button>
    </div>
    <p class="hint tally" title={tally}>{tally}</p>
  </footer>
{/if}

{#if enlarged && candidate}
  <Modal title={candidate.phenomenon} width="min(1100px, 92vw)" onclose={() => (enlarged = false)}>
    <img class="big" src={`${base}/results/${candidate.id}/preview`} alt={previewAlt} />
  </Modal>
{/if}

{#if pin}
  <Modal title="Pin candidate" onclose={() => (pin = null)}>
    <div class="pin-form">
      <label>Name<input class="input" aria-label="Pin name" bind:value={pin.title} maxlength="120" /></label>
      <label>Description<textarea class="textarea" aria-label="Pin description" bind:value={pin.description} maxlength="4000"></textarea></label>
      <label class="check"><input type="checkbox" bind:checked={pin.after_only} /> After image only</label>
      <fieldset><legend>Geometry</legend>
        <label class="check"><input type="radio" bind:group={pin.shape} value="point" /> Point</label>
        <label class="check"><input type="radio" bind:group={pin.shape} value="area" disabled={candidate.geometry?.type === 'Point'} /> Area</label>
      </fieldset>
      {#if error}<p class="warn" role="alert">{error}</p>{/if}
      <button class="btn btn-primary" disabled={busy || !pin.title.trim()} onclick={() => act(keep)}>Save pin</button>
    </div>
  </Modal>
{/if}

<style>
  .pin-form { display: grid; gap: 10px; }
  .pin-form label { display: grid; gap: 4px; }
  .pin-form .check { display: flex; align-items: center; gap: 8px; }
  .pin-form fieldset { display: flex; gap: 20px; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--r-sm); }
  .manual { border-bottom: 1px dashed var(--accent); }
  section { display: grid; gap: 7px; }
  section.candidate, section:not(.run) { border-top: 1px solid var(--border); padding-top: 10px; }
  section > strong, .run-head strong { font-size: var(--fs-xs); }
  .link { color: var(--accent); font-size: var(--fs-xs); text-align: left; }
  .link:disabled { opacity: 0.5; }
  .link.inline { display: inline; font-family: var(--font-mono); font-size: 11px; }
  .centre { text-align: center; }
  .nav { justify-content: space-between; }
  .position { color: var(--text-2); font-size: var(--fs-xs); }
  .filters { flex-wrap: wrap; gap: 4px; }
  .chip { padding: 2px 8px; border: 1px solid var(--border); border-radius: 999px; color: var(--text-2); font-size: 10.5px; }
  .chip:hover { color: var(--text-1); }
  .chip.on { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
  .chip .n { color: var(--text-3); }
  .chip.on .n { color: inherit; }
  .order { margin-left: auto; }
  .map-acts { display: flex; gap: 2px; margin-left: auto; }
  .compare { justify-self: start; }
  .facts { margin: 0; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  .strength { margin: 0; font-size: var(--fs-xs); font-weight: 600; color: var(--text-1); }
  .strength.strong { color: var(--ok); }
  .strength.weak { color: var(--text-3); }
  .verdict { display: flex; align-items: center; gap: 5px; margin: 0; font-size: var(--fs-xs); font-weight: 600; }
  .verdict.kept { color: var(--ok); }
  .verdict.noted { color: var(--accent); }
  .review-actions { flex: 0 0 auto; grid-template-rows: 52px 32px 17px; }
  .keys { margin: 2px 0 0; color: var(--text-3); font-size: 10.5px; }
  .review-status { display: grid; align-content: center; overflow: auto; }
  .verdict-row { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
  .tally { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .preview-open { display: block; width: 100%; padding: 0; border-radius: var(--r-sm); cursor: zoom-in; }
  .preview-open:hover { outline: 1px solid var(--accent); }
  .preview { display: block; width: 100%; height: 210px; object-fit: contain; border-radius: var(--r-sm); background: var(--bg-0); }
  .big { width: 100%; max-height: 78vh; object-fit: contain; background: var(--bg-0); }
  progress { width: 100%; accent-color: var(--accent); }
</style>
