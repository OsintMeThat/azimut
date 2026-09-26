<script>
  /**
   * An analyzer of your own, built rule by rule over the map.
   *
   * A rule is a line a pixel has to cross: a quantity, on pass A, on pass B or
   * across the two. The map beside the dock is the bench. Once two passes are
   * picked, every change to a rule redraws what each one keeps there in its
   * own colour, with the candidates a run would return outlined, because the
   * preview runs the engine's own evaluation on the frames a run would read.
   * The preview follows the map: wherever frames are held, the detections are
   * live, and the rest of the view is one Read away.
   *
   * Checks are the analyst's own proof, and optional: a place, its passes, and
   * points where a candidate should come out or none should. They are reread
   * from the cache whenever the rules change, so a tuned line that loses the
   * burn or catches the reef says so at once. Nothing is fetched without a
   * press, and a press that costs requests says how many.
   */
  import { onDestroy, onMount, untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { acquisitionQuery, olderSpan, withOlder } from '../../lib/map/acquisitions.js';
  import { clone, viewZone } from '../../lib/map/analyzers.js';
  import {
    RULE_COLOURS, checksSummary, describeRecipe, formatShare, markOutcomes, newCheck, newRule, readsOneDate,
    readsRadar, recipeCapability, recipeProblem, signalOf, signature, suggestedLayer, withMark, withoutMark,
  } from '../../lib/map/analyzerRules.js';
  import AcquisitionPicker from './AcquisitionPicker.svelte';
  import AnalyzerChecks from './AnalyzerChecks.svelte';
  import AnalyzerLabel from './AnalyzerLabel.svelte';
  import AnalyzerSettings from './AnalyzerSettings.svelte';
  import RuleRow from './RuleRow.svelte';
  import DateField from '../../components/DateField.svelte';
  import Icon from '../../components/Icon.svelte';

  /** What a configuration that has not answered yet still offers. */
  const STANDARD_LAYERS = [
    { id: 'TRUE_COLOR', label: 'True colour' }, { id: 'FALSE_COLOR', label: 'False colour (infrared)' },
    { id: 'SWIR', label: 'SWIR (short-wave infrared)' }, { id: 'NDVI', label: 'NDVI (vegetation index)' },
  ];

  let {
    catalogue,
    recipe = $bindable(),
    isNew = false,
    /** Where to open: `{ tab, check }`, a tab and a check to put on the bench. */
    start = null,
    /** What the map draws while the builder is open: the preview, the shown
     *  rules, the hovered one, the last point read and the marks on the bench. */
    builder = $bindable(null),
    /** The map's view as `{ west, south, east, north }`, or null. */
    viewBounds = () => null,
    /** The settled camera; each new one moves the preview with the map. */
    mapView = null,
    /** The Copernicus layers this configuration offers, `[{ id, label, hint }]`. */
    layers = [],
    onshow = () => {},
    onleavepass = () => {},
    /** Blink A and B on the map: `onblink({ a, b })`, or `onblink(null)` to stop. */
    onblink = () => {},
    /** Frame a place: `{ lon, lat, zoom }` or `{ bounds }`. */
    onfly = () => {},
    onsave = async () => {},
    oncancel = () => {},
  } = $props();

  const limits = $derived(catalogue?.rules ?? {});
  const capability = $derived(recipeCapability(recipe, catalogue?.methods ?? []));
  const single = $derived(readsOneDate(recipe));
  const radar = $derived(readsRadar(recipe));
  const problem = $derived(recipeProblem(recipe, limits));
  const signal = $derived(signalOf(recipe));
  const phrase = $derived(describeRecipe(recipe));
  const most = $derived(limits.max_rules ?? 6);
  const offered = $derived(layers.length ? layers : STANDARD_LAYERS);
  const suggested = $derived(suggestedLayer(recipe.rules[Math.max(0, signal)], offered));
  const labelOf = (id) => offered.find((entry) => entry.id === id)?.label ?? id.replace(/_/g, ' ').toLowerCase();

  let tab = $state(untrack(() => start?.tab ?? 'rules'));
  let a = $state({ date: '', time: '' });
  let b = $state({ date: '', time: '' });
  let region = $state(null);
  let preview = $state(null);
  let missing = $state(0);
  let working = $state(false);
  let reading = $state(false);
  let error = $state('');
  let saving = $state(false);
  let shown = $state([]);
  /** What the map paints: each rule's pixels, or only what a run would return. */
  let view = $state('rules');
  let hover = $state(null);
  let probe = $state(null);
  let showing = $state('basemap');
  let layer = $state('TRUE_COLOR');
  let passes = $state({ list: [], lookback: 90, busy: false, error: '', searched: false, truncated: false, open: false });
  /** The check on the bench, and what each check's last read left. */
  let active = $state(null);
  let readings = $state({});
  let running = $state('');
  let generation = 0;
  let checkGeneration = 0;

  const current = $derived(signature(recipe));
  const summary = $derived(checksSummary(recipe));
  const bench = $derived(recipe.checks.find((check) => check.id === active) ?? null);
  /** The open check's own count, while its last read matches the rules and passes on the map:
   *  the map then shows its frame only, so the view's count would not be what is seen. */
  const framed = $derived(bench?.result && bench.result.signature === current && bench.b.date === b.date
    && (single || (bench.a?.date ?? '') === a.date) ? bench.result : null);

  /** The view, held inside the ranges the engine accepts. */
  function bounded(bounds) {
    if (!bounds) return null;
    const lon = (value) => Math.max(-180, Math.min(180, value));
    const lat = (value) => Math.max(-85, Math.min(85, value));
    return { west: lon(bounds.west), south: lat(bounds.south), east: lon(bounds.east), north: lat(bounds.north) };
  }

  /** The ground the passes on the bench were picked for. */
  let passesFor = null;
  const overlaps = (one, other) => one.west < other.east && other.west < one.east
    && one.south < other.north && other.south < one.north;

  // The preview is wherever the map is: each settled view moves it there. A
  // view off the ground the passes were picked for drops them, since a pass
  // there says nothing of here: somewhere else starts from its own passes.
  $effect(() => {
    mapView;
    untrack(() => {
      const next = bounded(viewBounds());
      if (!next) return;
      region = next;
      if (passesFor && !overlaps(passesFor, next)) forgetPasses();
      // A check with no pin yet is wherever the map is.
      if (bench && !bench.marks.length) patchCheck(bench.id, (check) => ({ ...check, bounds: { ...next } }));
    });
  });

  function forgetPasses() {
    passesFor = null;
    a = { date: '', time: '' };
    b = { date: '', time: '' };
    // A check still being placed moves with the map and starts over on its
    // passes; one with pins stays where it was and leaves the bench.
    if (bench && !bench.marks.length) {
      patchCheck(bench.id, (check) => ({ ...check, a: {}, b: { date: '' }, result: null }));
    } else {
      active = null;
    }
    passes = { ...passes, list: [], searched: false, truncated: false, open: false, error: '' };
    if (showing !== 'basemap') show('basemap');
  }

  /** A rule's eye; one added since the last toggle starts open. */
  const isShown = (i) => shown[i] ?? true;
  function toggle(i) {
    // With the detections alone on the map every eye reads closed, so one
    // pressed there opens its rule and brings the others back as they were.
    const opening = view === 'detections';
    view = 'rules';
    shown = recipe.rules.map((_, k) => (k === i ? opening || !isShown(k) : isShown(k)));
  }
  const painted = (i) => view === 'rules' && isShown(i);

  /** What a reading depends on; the name, label, colour and checks do not. */
  const readingRecipe = $derived({ name: 'Preview', method: 'rules', rules: recipe.rules, match: recipe.match,
    parameters: recipe.parameters });
  const request = $derived(
    problem || !region || !b.date || (!single && !a.date) ? '' : JSON.stringify({
      recipe: readingRecipe,
      a: single ? { date: '' } : { date: a.date, time: a.time },
      b: { date: b.date, time: b.time },
      bounds: region,
    })
  );
  const needs = $derived(
    !region ? 'Open the map on the ground to try the rules on.'
    : !b.date ? (single ? 'Pick the pass to try the rules on.' : 'Pick pass A and pass B to try the rules on.')
    : !single && !a.date ? 'These rules read A as well; pick it too.'
    : problem
  );

  $effect(() => {
    const body = request;
    if (!body) { untrack(() => { preview = null; missing = 0; }); return; }
    const mine = ++generation;
    const timer = setTimeout(() => void run(body, false, mine), 250);
    return () => clearTimeout(timer);
  });

  async function run(body, read, mine) {
    working = true;
    error = '';
    try {
      const answer = await api.post('/api/compare/analyzers/preview', { ...JSON.parse(body), read });
      if (mine !== generation) return;
      missing = answer.missing;
      preview = answer.ready ? answer : null;
      if (probe && answer.ready) void probeAt(probe.point);
    } catch (e) {
      if (mine === generation) error = e.message;
    } finally {
      if (mine === generation) working = false;
    }
  }

  async function readFrames() {
    if (!request || reading) return;
    reading = true;
    try { await run(request, true, ++generation); } finally { reading = false; }
  }

  /**
   * Read every rule at a point of the map: the builder's way of asking why.
   * Where nothing is read yet the card still opens, to say what is missing
   * and to let the point become a mark all the same.
   */
  export async function probeAt(point) {
    if (!request || !preview) {
      probe = { point, result: null, error: '', unread: request ? 'frames' : 'passes' };
      return;
    }
    const body = request;
    probe = { point, result: null, error: '' };
    try {
      const result = await api.post('/api/compare/analyzers/probe', { ...JSON.parse(body), point: [point.lon, point.lat] });
      if (body === request) probe = { point, result, error: '' };
    } catch (e) {
      probe = { point, result: null, error: e.message };
    }
  }

  export function closeProbe() { probe = null; }

  // -- checks ------------------------------------------------------------------

  function sourceFor(letter) {
    const side = letter === 'a' ? a : b;
    return radar
      ? { provider: 'sentinel1', date: side.date, time: side.time }
      : { provider: 'sentinel2', date: side.date, layer, maxcc: 100 };
  }
  /** A check is complete once it has the passes the rules read. */
  const complete = (check) => !!check.b?.date && (single || !!check.a?.date);
  const incomplete = $derived(recipe.checks.find((check) => !complete(check)) ?? null);
  const saveProblem = $derived(problem || (incomplete ? `“${incomplete.name}” needs its passes.` : ''));

  /** Whether a point is on a check's ground, or within one of its widths of it. */
  function near(bounds, { lon, lat }) {
    const across = bounds.east - bounds.west;
    const up = bounds.north - bounds.south;
    return lon >= bounds.west - across && lon <= bounds.east + across && lat >= bounds.south - up && lat <= bounds.north + up;
  }
  /** The check a point read now would be marked in: the one on the bench, when
   *  the point is on its ground. Anywhere else a mark starts a check of its own. */
  const markingInto = $derived(bench && probe && near(bench.bounds, probe.point) ? bench : null);

  let benchSection = $state(null);
  /** The pass list lives on the bench, above the tabs: open it and go there. */
  function findPasses() {
    benchSection?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    if (passes.searched && !passes.open) passes = { ...passes, open: true };
    else if (!passes.open) void lookUp();
  }

  /**
   * A new check where the map is, open on the bench: it takes the passes
   * picked from now on, and pins wherever the map is clicked while one is armed.
   */
  function addCheck() {
    if (!region || recipe.checks.length >= (limits.max_checks ?? 12)) return null;
    const check = newCheck({ name: `Check ${recipe.checks.length + 1}`,
      a: single || !a.date ? {} : sourceFor('a'), b: b.date ? sourceFor('b') : { date: '' }, bounds: region });
    recipe.checks = [...recipe.checks, check];
    active = check.id;
    pinning = null;
    tab = 'checks';
    return check;
  }

  /** Which pin a click on the map drops in the open check, or null. */
  let pinning = $state(null);
  $effect(() => {
    if (!bench) untrack(() => { pinning = null; });
  });
  export function pinMode(mode) { pinning = mode && bench ? mode : null; }
  export function pinAt(point) {
    if (!pinning || !bench) return;
    patchCheck(bench.id, (check) => withMark(check, [point.lon, point.lat], pinning));
  }
  function closeCheck() {
    pinning = null;
    active = null;
  }

  /** Mark the point read on the map in the check on the bench, or in a new one. */
  export function markProbe(expect) {
    if (!probe) return;
    const target = markingInto ?? addCheck();
    if (!target) return;
    recipe.checks = recipe.checks.map((check) => (check.id === target.id
      ? withMark(check, [probe.point.lon, probe.point.lat], expect) : check));
    probe = null;
    tab = 'checks';
  }

  /** Put a check on the bench: its view, its passes and the layer it shows. */
  function openCheck(check) {
    active = check.id;
    passesFor = { ...check.bounds };
    a = { date: check.a?.date ?? '', time: check.a?.time ?? '' };
    b = { date: check.b.date, time: check.b.time ?? '' };
    if (check.b.layer && offered.some((entry) => entry.id === check.b.layer)) layer = check.b.layer;
    probe = null;
    onfly({ bounds: check.bounds });
    show('b');
  }

  function patchCheck(id, change) {
    recipe.checks = recipe.checks.map((check) => (check.id === id ? change(check) : check));
  }

  const body = (check) => ({ ...clone(check), result: null });
  /** What changes a check's answer: the rules, and its own passes and marks.
   *  Its result is not in it, so writing one never asks for another read. */
  const checksKey = $derived(JSON.stringify([current, recipe.checks.map((check) => [check.id, check.a, check.b, check.bounds, check.marks])]));
  const hasChecks = $derived(recipe.checks.length > 0);

  /** Reread every check; `read` fetches what the cache lacks. */
  async function readChecks(read) {
    const mine = ++checkGeneration;
    const rules = clone(readingRecipe);
    const signed = current;
    const list = clone(recipe.checks);
    for (const [i, check] of list.entries()) {
      if (mine !== checkGeneration) return;
      if (!complete(check)) {
        readings = { ...readings, [check.id]: { busy: false, missing: 0, error: '' } };
        continue;
      }
      // A read from the cache is over in a moment; only a fetch says it is reading.
      if (read) {
        running = `Reading ${i + 1} of ${list.length}…`;
        readings = { ...readings, [check.id]: { ...readings[check.id], busy: true, error: '' } };
      }
      try {
        const answer = await api.post('/api/compare/analyzers/check', { recipe: rules, check: body(check), read });
        if (mine !== checkGeneration) return;
        readings = { ...readings, [check.id]: { busy: false, missing: answer.missing ?? 0, error: '' } };
        if (answer.ready) {
          patchCheck(check.id, (entry) => ({ ...entry, result: { signature: signed, count: answer.count, covered: answer.covered } }));
        }
      } catch (e) {
        if (mine !== checkGeneration) return;
        readings = { ...readings, [check.id]: { busy: false, missing: 0, error: e.message } };
      }
    }
    if (mine === checkGeneration) running = '';
  }

  // The checks follow the rules from the cache: never a request, only a read.
  $effect(() => {
    checksKey;
    if (problem || !hasChecks) return;
    const timer = setTimeout(() => untrack(() => void readChecks(false)), 700);
    return () => clearTimeout(timer);
  });

  async function runAll() {
    if (running || problem) return;
    try { await readChecks(true); } finally { running = ''; }
  }

  function removeCheck(id) {
    recipe.checks = recipe.checks.filter((check) => check.id !== id);
    if (active === id) active = null;
  }

  // -- the map -----------------------------------------------------------------

  $effect(() => {
    const outcomes = bench && bench.result?.signature === current ? markOutcomes(bench) : [];
    builder = {
      preview, probe,
      // A hidden rule stays hidden while the pointer is on its row.
      hover: hover !== null && painted(hover) ? hover : null,
      shown: recipe.rules.map((_, i) => painted(i)),
      rules: clone(recipe.rules),
      colour: recipe.colour, style: recipe.style, phenomenon: recipe.phenomenon,
      colours: RULE_COLOURS,
      marks: (bench?.marks ?? []).map((mark, i) => ({ ...mark, ok: outcomes[i] ?? null })),
      ground: bench ? { bounds: bench.bounds, name: bench.name } : null,
      checking: markingInto?.name ?? '',
      canMark: !!region,
      pinning,
      pass: { showing, a: single ? '' : a.date, b: b.date, blink: blinkable },
    };
  });
  onMount(() => {
    const first = start?.check && recipe.checks.find((check) => check.id === start.check);
    if (first) openCheck(first);
  });
  onDestroy(() => {
    builder = null;
    checkGeneration++;
    if (showing === 'blink') onblink(null);
    if (showing !== 'basemap') onleavepass();
  });

  function add() {
    if (recipe.rules.length >= most) return;
    recipe.rules = [...recipe.rules, newRule(radar ? 'radar' : 'index', 'b')];
  }
  function remove(i) {
    shown = recipe.rules.map((_, k) => isShown(k)).filter((_, k) => k !== i);
    recipe.rules = recipe.rules.filter((_, k) => k !== i);
    hover = null;
  }
  /** The ranking rule goes first, which is where the engine looks for it. */
  function rank(i) {
    const order = [i, ...recipe.rules.map((_, k) => k).filter((k) => k !== i)];
    shown = order.map((k) => isShown(k));
    recipe.rules = order.map((k) => recipe.rules[k]);
  }

  const blinkable = $derived(!single && !!a.date && !!b.date);

  /** Lay the basemap, A, B, or A and B blinking, under the preview. */
  function show(which) {
    if (showing === 'blink' && which !== 'blink') onblink(null);
    showing = which;
    if (which === 'basemap') { onleavepass(); return; }
    if (which === 'blink') {
      if (blinkable) onblink({ a: sourceFor('a'), b: sourceFor('b') });
      else show('b');
      return;
    }
    if ((which === 'a' ? a : b).date) onshow(sourceFor(which));
  }
  /** The map's own A / B / Blink bar asks through here. */
  export function showPass(which) { show(which); }
  function setLayer(id) {
    layer = id;
    if (bench) {
      patchCheck(bench.id, (check) => ({ ...check, a: check.a?.date ? { ...check.a, layer: id } : check.a,
        b: check.b?.date ? { ...check.b, layer: id } : check.b }));
    }
    // Seeing a layer means seeing a pass in it: B, unless A is already up.
    show(showing === 'basemap' ? (b.date ? 'b' : a.date ? 'a' : 'basemap') : showing);
  }
  function setDate(letter, date, time = '') {
    const source = { date: date ?? '', time: radar ? time : '' };
    if (letter === 'a') a = source;
    else b = source;
    if (region) passesFor = { ...region };
    // The check open on the bench takes the passes picked for it.
    if (bench) {
      patchCheck(bench.id, (check) => ({ ...check, a: single || !a.date ? {} : sourceFor('a'),
        b: b.date ? sourceFor('b') : { date: '' }, result: null }));
    }
    if (source.date) show(letter);
  }

  const lookUp = () => search(passes.lookback, false);
  const lookOlder = () => search(olderSpan(passes.lookback, passes.list), true);

  async function search(span, more) {
    if (!region || !span) return;
    passes = { ...passes, busy: true, error: '', open: true };
    try {
      const found = await api.post('/api/satellite/sentinel/acquisitions',
        acquisitionQuery([viewZone(region, 'Preview')], span, new Date(), radar ? 'sentinel1' : 'sentinel2'));
      const list = more ? withOlder(passes.list, found.dates) : found.dates ?? [];
      passes = { ...passes, list, searched: true, truncated: !!found.truncated };
    } catch (e) {
      passes = { ...passes, error: e.message };
    } finally {
      passes = { ...passes, busy: false };
    }
  }

  async function save() {
    if (saving || saveProblem || !recipe.name.trim()) return;
    saving = true;
    error = '';
    try {
      await onsave({ ...clone(recipe), name: recipe.name.trim(), description: recipe.description.trim() || phrase });
    } catch (e) {
      error = e.message;
    } finally {
      saving = false;
    }
  }

  const checksBadge = $derived(!summary.total ? '' : summary.pass + summary.fail ? `${summary.pass}/${summary.total}` : `${summary.total}`);
</script>

<div class="cmp-dock-body builder">
  {#if error}<p class="warn" role="alert">{error}</p>{/if}
  <h3>{isNew ? 'Build an analyzer' : `Edit ${recipe.name}`}</h3>
  <label class="name" title="The name shown in the analyzer library across all cases.">Name
    <input aria-label="Analyzer name" bind:value={recipe.name} maxlength="120" placeholder="What it finds" />
  </label>
  <p class="phrase">{phrase || 'Add a rule.'}</p>

  <section class="try" aria-label="On the map" bind:this={benchSection}>
    <strong>On the map</strong>
    <div class="dates">
      {#if !single}
        <div class="date">
          <span class="cmp-letter a">A</span>
          <DateField day reading={false} label="Preview pass A" value={a.date} onchange={(value) => setDate('a', value)} />
          {#if radar && a.time}<small class="mono">{a.time.slice(0, 5)} UTC</small>{/if}
        </div>
      {/if}
      <div class="date">
        <span class="cmp-letter b">B</span>
        <DateField day reading={false} label="Preview pass B" value={b.date} onchange={(value) => setDate('b', value)} />
        {#if radar && b.time}<small class="mono">{b.time.slice(0, 5)} UTC</small>{/if}
      </div>
      <button class="btn btn-sm" aria-expanded={passes.open} disabled={!region}
        onclick={() => (passes.open ? (passes = { ...passes, open: false }) : passes.searched ? (passes = { ...passes, open: true }) : lookUp())}>
        {passes.open ? 'Hide passes' : 'Find passes'}
      </button>
    </div>
    {#if passes.open}
      <AcquisitionPicker list={passes.list} lookback={passes.lookback} busy={passes.busy} error={passes.error}
        searched={passes.searched} truncated={passes.truncated} areas={region ? 1 : 0} {single} {radar}
        wantsReference={!single} wantsCompare={true} {a} {b}
        onlookback={(lookback) => (passes = { ...passes, lookback })} onlook={lookUp} onolder={lookOlder}
        onpick={(letter, entry) => setDate(letter, entry.date, entry.time ?? '')} />
    {/if}
    <div class="row under">
      <span class="hint">Imagery</span>
      <div class="cmp-seg" role="group" aria-label="Imagery under the preview">
        {#each [['basemap', 'Basemap'], ...(single ? [] : [['a', 'A']]), ['b', 'B'], ...(single ? [] : [['blink', 'Blink']])] as [id, label] (id)}
          <button type="button" class:on={showing === id} aria-pressed={showing === id}
            disabled={id === 'blink' ? !blinkable : id !== 'basemap' && !(id === 'a' ? a : b).date} onclick={() => show(id)}>{label}</button>
        {/each}
      </div>
      {#if !radar}
        <select class="grow" aria-label="Copernicus layer" title={offered.find((entry) => entry.id === layer)?.hint ?? ''}
          value={layer} onchange={(event) => setLayer(event.currentTarget.value)}>
          {#each offered as entry (entry.id)}<option value={entry.id}>{entry.label}</option>{/each}
        </select>
      {/if}
    </div>
    {#if !radar && suggested !== layer}
      <button class="link suggest" onclick={() => setLayer(suggested)}>Show it in {labelOf(suggested)}, which reads rule ★ best</button>
    {/if}

    <div class="status" aria-live="polite">
      {#if needs}
        <p class="hint">{needs}</p>
      {:else}
        {#if preview}
          <div class="row">
            {#if framed}
              <p class="result grow"><strong>{framed.count} candidate{framed.count === 1 ? '' : 's'}</strong>
                in “{bench.name}”{#if working} · updating…{/if}</p>
            {:else}
              <p class="result grow"><strong>{preview.count} candidate{preview.count === 1 ? '' : 's'}</strong> on the map
                · {formatShare(preview.kept)} of the measured ground kept{#if working} · updating…{/if}</p>
            {/if}
            <div class="cmp-seg" role="group" aria-label="What the map shows">
              <button type="button" class:on={view === 'rules'} aria-pressed={view === 'rules'}
                title="Each rule's pixels in its colour" onclick={() => (view = 'rules')}>Rules</button>
              <button type="button" class:on={view === 'detections'} aria-pressed={view === 'detections'}
                title="Only what a detection would return" onclick={() => (view = 'detections')}>Detections</button>
            </div>
          </div>
          {#if preview.candidates.length && preview.count > preview.candidates.length}<p class="hint">The {preview.candidates.length} strongest are drawn.</p>{/if}
          {#if preview.note}<p class="warn">{preview.note}</p>{/if}
        {:else if working && !missing}
          <p class="hint">Reading the rules…</p>
        {/if}
        {#if missing}
          <button class="btn btn-primary btn-sm read" disabled={reading} onclick={readFrames}>
            {reading ? 'Reading from Copernicus…' : preview ? 'Read the rest of the view' : 'Show the detections here'}
          </button>
          <p class="hint">{missing} frame{missing === 1 ? '' : 's'} from Copernicus, one request each, and the frames already read stay live as you move.</p>
        {/if}
        {#if preview}
          {#if preview.clipped}<p class="hint">The preview covers only the middle {limits.preview_span ?? 3} tiles a side of this view.</p>{/if}
          <p class="hint">Click the map to read every rule at a point and mark it in a check.</p>
        {/if}
      {/if}
    </div>
  </section>

  <div class="tabs" role="tablist" aria-label="Analyzer parts">
    <button role="tab" aria-selected={tab === 'rules'} class:on={tab === 'rules'} onclick={() => (tab = 'rules')}>
      Rules <span class="count">{recipe.rules.length}</span>
    </button>
    <button role="tab" aria-selected={tab === 'checks'} class:on={tab === 'checks'} onclick={() => (tab = 'checks')}>
      Checks{#if checksBadge} <span class="count" class:fail={summary.fail} class:pass={!summary.fail && summary.pass === summary.total}>{checksBadge}</span>{/if}
    </button>
    <button role="tab" aria-selected={tab === 'settings'} class:on={tab === 'settings'} onclick={() => (tab = 'settings')}>Settings</button>
  </div>

  {#if tab === 'rules'}
    <section class="rules" aria-label="Rules">
      <div class="row match">
        <span class="hint grow">Keep what passes</span>
        <div class="cmp-seg" role="group" aria-label="How the rules combine">
          <button type="button" class:on={recipe.match === 'all'} aria-pressed={recipe.match === 'all'}
            title="A pixel is kept when it passes every rule" onclick={() => (recipe.match = 'all')}>all</button>
          <button type="button" class:on={recipe.match === 'any'} aria-pressed={recipe.match === 'any'}
            title="A pixel is kept when it passes one rule or more" onclick={() => (recipe.match = 'any')}>any</button>
        </div>
      </div>
      {#each recipe.rules as _, i (i)}
        <RuleRow bind:rule={recipe.rules[i]} index={i} colour={RULE_COLOURS[i % RULE_COLOURS.length]}
          signal={i === signal} reading={preview?.rules?.[i] ?? null} match={recipe.match} shown={painted(i)} ontoggle={() => toggle(i)}
          bands={limits.bands} classes={limits.classes} maxAround={limits.max_around}
          canRemove={recipe.rules.length > 1} onremove={() => remove(i)} onsignal={() => rank(i)}
          onhover={(index) => (hover = index)} />
      {/each}
      <button class="btn btn-sm" disabled={recipe.rules.length >= most} onclick={add}>
        <Icon name="plus" size={13} /> Add a rule
      </button>
    </section>
  {:else if tab === 'checks'}
    <AnalyzerChecks checks={recipe.checks} {current} {readings} {active} {running} canAdd={!!region} {pinning}
      onadd={addCheck} onpin={pinMode} ondone={closeCheck} onfindpasses={findPasses}
      most={limits.max_checks ?? 12} onrun={runAll} onopen={openCheck}
      onremove={removeCheck} onrename={(id, name) => patchCheck(id, (check) => ({ ...check, name }))}
      onremovemark={(id, i) => patchCheck(id, (check) => withoutMark(check, i))} />
  {:else}
    <section class="settings" aria-label="Size and grouping">
      <strong>Size and grouping</strong>
      <AnalyzerSettings bind:recipe {capability} expanded />
    </section>
    <section aria-label="Description">
      <label title="What this analyzer looks for and cannot tell you.">Description
        <textarea bind:value={recipe.description} maxlength="500" placeholder={phrase}></textarea>
      </label>
    </section>
    <AnalyzerLabel bind:recipe />
  {/if}
</div>
<div class="cmp-dock-foot">
  <div class="row">
    <button class="btn btn-sm" onclick={oncancel}>Cancel</button>
    <button class="btn btn-primary grow" disabled={saving || !!saveProblem || !recipe.name.trim()} onclick={save}>
      {isNew ? 'Add to my analyzers' : 'Save changes'}
    </button>
  </div>
  <span class="reason" class:warn={!recipe.name.trim() || !!incomplete}>{!recipe.name.trim() ? 'Name it to save it.'
    : incomplete ? saveProblem : 'Shared by every case, and carried by Settings backup.'}</span>
</div>

<style>
  .builder { grid-template-columns: minmax(0, 1fr); }
  h3 { margin: 0; font-size: var(--fs-sm); font-weight: 700; }
  section { display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; }
  section > strong {
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .name { display: grid; gap: 3px; }
  .dates { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
  .date { display: flex; align-items: center; gap: 5px; }
  .date :global(.date-field) { width: 118px; }
  .under { flex-wrap: wrap; }
  .mono { color: var(--text-3); font-family: var(--font-mono); font-size: 10.5px; }
  .status { display: grid; gap: 5px; }
  .read { justify-self: start; }
  .result { margin: 0; font-size: var(--fs-xs); color: var(--text-1); }
  .phrase { margin: 0; color: var(--text-1); font-size: var(--fs-xs); line-height: 1.5; }
  .link { color: var(--accent); font-size: var(--fs-xs); text-align: left; }
  .suggest { justify-self: start; }
  .tabs { display: flex; gap: 3px; border-bottom: 1px solid var(--border); }
  .tabs button { flex: 1; padding: 7px 4px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; }
  .tabs button.on { color: var(--accent); border-bottom: 2px solid var(--accent); }
  .count { margin-left: 3px; padding: 0 5px; border-radius: 999px; background: var(--bg-3); color: var(--text-3); font-size: 10px; }
  .count.pass { background: color-mix(in srgb, var(--ok, #46a758) 18%, transparent); color: var(--ok, #46a758); }
  .count.fail { background: color-mix(in srgb, var(--danger, #ef4444) 18%, transparent); color: var(--danger, #ef4444); }
  .match { gap: 6px; }
  textarea { min-height: 48px; resize: vertical; }
</style>
