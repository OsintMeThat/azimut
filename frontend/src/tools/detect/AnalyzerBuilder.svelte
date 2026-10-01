<script>
  /**
   * An analyzer of your own, built rule by rule and proved on the map.
   *
   * A rule is a line a pixel has to cross: a quantity, the date it is read on
   * and the value. What it reads was chosen when the analyzer was made: a
   * satellite, and one date or the change between two. The map is where the
   * rules are tried. A check is a pair of passes and the pins laid on them;
   * picking one puts its passes on the map, and Test paints what each rule
   * keeps on the ground under its pins and says whether every pin came out as
   * it should. The column holds the rules, the list of checks and the
   * settings, and waits while a check is being made on the map.
   *
   * Checks are how an analyzer is proved, so one is needed to save it. Nothing
   * is fetched without a press, and a press that costs requests says how many.
   */
  import { onDestroy, onMount, untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { toast } from '../../lib/state.svelte.js';
  import { Bench } from '../../lib/map/bench.svelte.js';
  import { clone } from '../../lib/map/analyzers.js';
  import {
    RULE_COLOURS, checksSummary, describeOutcome, describeReads, describeRecipe, describeWithout, newRule, pinTicks,
    readsOneDate, readsRadar, recipeCapability, savingProblem, signalOf,
  } from '../../lib/map/analyzerRules.js';
  import AnalyzerChecks from './AnalyzerChecks.svelte';
  import AnalyzerLabel from './AnalyzerLabel.svelte';
  import AnalyzerSettings from './AnalyzerSettings.svelte';
  import RuleRow from './RuleRow.svelte';
  import Icon from '../../components/Icon.svelte';

  let {
    catalogue,
    recipe = $bindable(),
    isNew = false,
    /** Where to open: `{ tab, check }`, a tab and a check to put on the map. */
    start = null,
    /** What the map draws while the builder is open: the bench (`lib/map/bench.svelte.js`). */
    builder = $bindable(null),
    /** The map's view as `{ west, south, east, north }`, or null. */
    viewBounds = () => null,
    /** The Copernicus layers this configuration offers, `[{ id, label, hint }]`. */
    layers = [],
    /** Frame a place: `{ lon, lat, zoom }` or `{ bounds }`. */
    onfly = () => {},
    onsave = async () => {},
    oncancel = () => {},
  } = $props();

  const limits = $derived(catalogue?.rules ?? {});
  const bench = untrack(() => new Bench({
    api, recipe, limits: catalogue?.rules ?? {}, layers: () => layers, viewBounds: () => viewBounds(),
    fly: (target) => onfly(target), say: toast,
  }));
  builder = bench;

  const capability = $derived(recipeCapability(recipe, catalogue?.methods ?? []));
  const radar = $derived(readsRadar(recipe));
  const single = $derived(readsOneDate(recipe));
  const signal = $derived(signalOf(recipe));
  const phrase = $derived(describeRecipe(recipe));
  const most = $derived(limits.max_rules ?? 6);
  const summary = $derived(checksSummary(recipe));
  const saveProblem = $derived(recipe.name.trim() ? savingProblem(recipe, limits) : 'Name it to save it.');

  let tab = $state(untrack(() => start?.tab ?? 'rules'));
  let saving = $state(false);
  let error = $state('');

  onMount(() => {
    if (start?.check) bench.select(start.check);
  });
  // The map is let go of by whoever opened the builder (AnalyzerLibrary), not here: a builder
  // made in this one's place may already have taken it, and clearing it now would take it back.
  onDestroy(() => bench.destroy());

  const badge = $derived(!summary.total ? '!' : summary.pass + summary.fail ? `${summary.pass}/${summary.total}` : `${summary.total}`);

  function add() {
    if (recipe.rules.length >= most) return;
    recipe.rules = [...recipe.rules, newRule(radar ? 'radar' : 'index', single ? 'b' : 'a')];
  }
  function remove(i) {
    recipe.rules = recipe.rules.filter((_, k) => k !== i);
    bench.ruleRemoved(i);
  }
  /** The ranking rule goes first, which is where the engine looks for it. */
  function rank(i) {
    const order = [i, ...recipe.rules.map((_, k) => k).filter((k) => k !== i)];
    recipe.rules = order.map((k) => recipe.rules[k]);
    bench.rulesReordered(order);
  }

  async function save() {
    if (saving || saveProblem) return;
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

  /** What the check on the map last said, for the strip above the rules. */
  const verdict = $derived.by(() => {
    const check = bench.check;
    if (!check) return 'Pick a check on the map to try the rules on it.';
    if (bench.last?.error) return bench.last.error;
    if (bench.stale) return 'The rules changed since the last test.';
    return describeOutcome(check, bench.current);
  });
</script>

<div class="cmp-dock-body builder">
  {#if bench.locked}
    <div class="waiting" role="status">
      <span><strong>Making a check on the map</strong><br />Pick its passes, drop its pins, then finish it there.</span>
      <button class="btn btn-sm" onclick={() => bench.cancelDraft()}>Cancel the check</button>
    </div>
  {/if}
  <div class="panel" class:locked={bench.locked} inert={bench.locked}>
    {#if error}<p class="warn" role="alert">{error}</p>{/if}
    <h3>{isNew ? 'Build an analyzer' : `Edit ${recipe.name}`}</h3>
    <label class="name" title="The name shown in the analyzer library across all cases.">Name
      <input aria-label="Analyzer name" bind:value={recipe.name} maxlength="120" placeholder="What it finds" />
    </label>
    <p class="reads" title="Chosen when the analyzer was made">
      <Icon name="lock" size={11} /> <span>{describeReads(recipe)}</span>
    </p>
    <p class="phrase">{phrase || 'Add a rule.'}</p>

    <div class="tabs" role="tablist" aria-label="Analyzer parts">
      <button role="tab" aria-selected={tab === 'rules'} class:on={tab === 'rules'} onclick={() => (tab = 'rules')}>
        Rules <span class="count">{recipe.rules.length}</span>
      </button>
      <button role="tab" aria-selected={tab === 'checks'} class:on={tab === 'checks'} onclick={() => (tab = 'checks')}>
        Checks <span class="count" class:need={!summary.total} class:fail={summary.fail}
          class:pass={summary.total > 0 && !summary.fail && summary.pass === summary.total}>{badge}</span>
      </button>
      <button role="tab" aria-selected={tab === 'settings'} class:on={tab === 'settings'} onclick={() => (tab = 'settings')}>Settings</button>
    </div>

    {#if tab === 'rules'}
      <div class="strip" class:stale={bench.stale} class:hidden={bench.locked} aria-label="The check on the map">
        <div class="said">
          <strong>{bench.check?.name ?? 'No check on the map'}</strong>
          <span aria-live="polite">{verdict}</span>
        </div>
        <button class="btn btn-sm" class:btn-primary={!bench.tested} class:done={bench.tested} disabled={!bench.canTest}
          title={bench.blocked || undefined} onclick={() => bench.test()}>{bench.testLabel}</button>
      </div>
      <section class="rules" aria-label="Rules">
        <div class="row match">
          <span class="hint grow">Keep what passes</span>
          <div class="cmp-seg" role="group" aria-label="How the rules combine">
            <button type="button" class:on={recipe.match === 'all'} aria-pressed={recipe.match === 'all'}
              title="A pixel is kept when it passes every rule" onclick={() => (recipe.match = 'all')}>all the rules</button>
            <button type="button" class:on={recipe.match === 'any'} aria-pressed={recipe.match === 'any'}
              title="A pixel is kept when it passes one rule or more" onclick={() => (recipe.match = 'any')}>any rule</button>
          </div>
        </div>
        {#each recipe.rules as _, i (i)}
          <RuleRow bind:rule={recipe.rules[i]} {recipe} index={i} colour={RULE_COLOURS[i % RULE_COLOURS.length]}
            signal={i === signal} reading={bench.detail?.rules?.[i] ?? null} stale={bench.stale}
            ticks={pinTicks(recipe.rules[i], bench.marks, bench.detail?.readings, i)}
            effect={bench.stale ? '' : describeWithout(bench.marks, bench.detail?.covered, bench.detail?.without?.[i]?.covered)}
            match={recipe.match} shown={bench.painted(i)} ontoggle={() => bench.toggleRule(i)}
            bands={limits.bands} classes={limits.classes} maxAround={limits.max_around}
            canRemove={recipe.rules.length > 1} onremove={() => remove(i)} onsignal={() => rank(i)}
            onhover={(index) => bench.hoverRule(index)} />
        {/each}
        <button class="btn btn-sm" disabled={recipe.rules.length >= most} onclick={add}>
          <Icon name="plus" size={13} /> Add a rule
        </button>
      </section>
    {:else if tab === 'checks'}
      <AnalyzerChecks {bench} />
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
</div>
<div class="cmp-dock-foot" inert={bench.locked}>
  <div class="row">
    <button class="btn btn-sm" onclick={oncancel}>Cancel</button>
    <button class="btn btn-primary grow" disabled={saving || !!saveProblem} onclick={save}>
      {isNew ? 'Add to my analyzers' : 'Save changes'}
    </button>
  </div>
  <span class="reason" class:warn={!!saveProblem}>{saveProblem || 'Shared by every case, and carried by Settings backup.'}</span>
</div>

<style>
  .builder { grid-template-columns: minmax(0, 1fr); align-content: start; gap: 10px; }
  .panel { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; transition: opacity 0.15s var(--ease); }
  .panel.locked { opacity: 0.4; pointer-events: none; user-select: none; }
  /* Kept in sight however far the column is scrolled. */
  .waiting {
    position: sticky;
    top: -12px;
    z-index: 6;
    display: grid;
    gap: 8px;
    padding: 9px 10px;
    border: 1px solid var(--accent);
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--accent) 14%, var(--bg-1));
    color: var(--text-1);
    font-size: var(--fs-xs);
    line-height: 1.45;
  }
  .waiting .btn { justify-self: start; }
  h3 { margin: 0; font-size: var(--fs-sm); font-weight: 700; }
  section { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
  section > strong {
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .name { display: grid; gap: 3px; }
  .reads {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    justify-self: start;
    margin: 0;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-2);
    font-size: 10.5px;
    font-weight: 600;
  }
  .phrase { margin: 0; color: var(--text-1); font-size: var(--fs-xs); line-height: 1.5; }
  .tabs { display: flex; gap: 3px; border-bottom: 1px solid var(--border); }
  .tabs button { flex: 1; padding: 7px 4px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; }
  .tabs button.on { color: var(--accent); border-bottom: 2px solid var(--accent); }
  .count { margin-left: 3px; padding: 0 5px; border-radius: 999px; background: var(--bg-3); color: var(--text-3); font-size: 10px; }
  .count.pass { background: var(--ok-soft); color: var(--ok); }
  .count.fail { background: var(--danger-soft); color: var(--danger); }
  .count.need { background: color-mix(in srgb, var(--warn) 20%, transparent); color: var(--warn); }
  /* The check on the map and what it last said, with the Test button, kept in
     sight while the rules scroll under it. */
  .strip {
    position: sticky;
    top: -12px;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 -12px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-1);
  }
  .said { display: grid; flex: 1; gap: 1px; min-width: 0; }
  .said strong { overflow: hidden; color: var(--text-1); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  .said span { color: var(--text-2); font-size: 10.5px; line-height: 1.4; }
  .strip.stale .said span { color: var(--warn); }
  .strip.hidden { visibility: hidden; }
  .strip .btn { flex: 0 0 auto; }
  .strip .btn.done { border-color: var(--border); background: transparent; color: var(--ok); opacity: 1; }
  .strip .btn.done::before { margin-right: 5px; content: '✓'; }
  .match { gap: 6px; }
  textarea { min-height: 48px; resize: vertical; }
</style>
