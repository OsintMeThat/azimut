<script>
  /**
   * The console over the map where an analyzer of your own is proved.
   *
   * One check is on the map at a time. The selector picks it, or none to see the
   * basemap alone, or starts a new one: a drawer takes its passes, then the pins
   * are dropped with a click, and Finish keeps it. The map is split between the
   * two passes of a check that has two, and the same row switches between the
   * sides. Test runs the rules on the ground under the pins, says its cost
   * first, and the row under it says how every pin came out and keeps a chip for
   * each rule, to show it or hide it and see which ones help.
   *
   * It only asks the bench (`lib/map/bench.svelte.js`); the map itself, the
   * pins and the painted rules are drawn by Detect from the same bench.
   */
  import { checkState, describeOutcome, shortRule } from '../../lib/map/analyzerRules.js';
  import AcquisitionPicker from './AcquisitionPicker.svelte';
  import PassDates from './PassDates.svelte';
  import Icon from '../../components/Icon.svelte';

  let { bench } = $props();

  let width = $state(0);
  let deckHeight = $state(0);
  // What the console covers of the map's bottom edge, which the reading card keeps clear of.
  $effect(() => { bench.reach = deckHeight ? deckHeight + 42 : 0; });
  /** The menu that is open: 'check' (which check), 'look' (how the passes are shown) or ''. */
  let open = $state('');
  let root = $state(null);
  const narrow = $derived(width > 0 && width < 620);

  const GLYPHS = { pass: '✓', fail: '✗', stale: '–', unrun: '–', unpinned: '!' };
  const check = $derived(bench.check);
  const state = $derived(check ? checkState(check, bench.current) : 'unrun');
  const before = $derived(check?.a?.date ?? '');
  const after = $derived(check?.b?.date ?? '');
  const side = $derived(bench.divider >= 99 ? 'before' : bench.divider <= 1 ? 'after' : 'split');
  const pinCount = $derived(bench.marks.length);
  /** The layer's name without its explanation: "NDVI (vegetation index)" is NDVI on a button. */
  const layerLabel = $derived((bench.offered.find((entry) => entry.id === bench.layer)?.label ?? bench.layer).replace(/\s*\(.*$/, ''));
  const suggestion = $derived(bench.suggestion);

  /** How every pin came out, from the last test, with the count of what it found. */
  const outcome = $derived.by(() => {
    if (!check) return '';
    const text = describeOutcome(check, bench.current);
    const count = check.result?.signature === bench.current ? check.result.count : null;
    return count === null ? text : `${text} · ${count} candidate${count === 1 ? '' : 's'}`;
  });

  function choose(id) {
    open = '';
    bench.select(id);
  }
  function startNew() {
    open = '';
    bench.startDraft();
  }
  function closeDrawer() {
    if (bench.draft && !bench.dated) bench.cancelDraft();
    else bench.closePasses();
  }
  /** The row that switches sides: the whole map on the before pass, the split, or the whole map on the after one. */
  function show(which) {
    bench.setDivider(which === 'before' ? 100 : which === 'after' ? 0 : 50);
  }
  function onOutside(event) {
    if (open && !event.target.closest?.('.pick')) open = '';
  }
  function onKey(event) {
    if (event.key !== 'Escape') return;
    if (open) {
      open = '';
    } else if (bench.choosingPasses) {
      closeDrawer();
    } else {
      return;
    }
    event.stopPropagation();
  }
</script>

<svelte:window onpointerdown={onOutside} />
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="bench-root" bind:clientWidth={width} bind:this={root} onkeydown={onKey}>
  <div class="console cmp-glass" class:narrow role="region" aria-label="Checks on the map" bind:clientHeight={deckHeight}>
    {#if bench.choosingPasses}
      <section class="drawer cmp-glass" aria-label={bench.draft ? 'Passes of the new check' : 'Change the passes of the check'}>
        <header>
          <strong>{bench.draft ? 'New check' : 'Change the passes'}</strong>
          <button class="cmp-icon" aria-label="Close" title="Close" onclick={closeDrawer}><Icon name="x" size={13} /></button>
        </header>
        <div class="body">
          <p class="hint">{bench.single ? 'Pick the pass this check is read on' : 'Pick the pass before and the pass after'},
            looked up for the ground at the middle of the map.</p>
          <div class="slots">
            {#if !bench.single}
              <span class="slot"><i class="cmp-letter a" aria-hidden="true">A</i> Before <strong class="cmp-mono">{before || 'not picked'}</strong></span>
            {/if}
            <span class="slot"><i class="cmp-letter b" aria-hidden="true">B</i> {bench.single ? 'Pass' : 'After'} <strong class="cmp-mono">{after || 'not picked'}</strong></span>
          </div>
          <AcquisitionPicker list={bench.passes.list} lookback={bench.passes.lookback} busy={bench.passes.busy}
            error={bench.passes.error} searched={bench.passes.searched} truncated={bench.passes.truncated} areas={1}
            single={bench.single} radar={bench.radar} wantsReference={!bench.single} wantsCompare={true}
            a={check?.a?.date ? check.a : null} b={check?.b?.date ? check.b : null} nameA="Before" nameB="After"
            onlookback={(lookback) => bench.setLookback(lookback)} onlook={() => bench.lookUpPasses()}
            onolder={() => bench.lookOlder()} onpick={(letter, entry) => bench.setPass(letter, entry)}>
            {#snippet dates()}<PassDates {bench} />{/snippet}
          </AcquisitionPicker>
        </div>
        <footer>
          {#if bench.draft}<button class="btn btn-sm" onclick={() => bench.cancelDraft()}>Cancel</button>{/if}
          <button class="btn btn-sm btn-primary" disabled={!bench.dated} onclick={() => bench.closePasses()}>
            {bench.draft ? 'Place the pins' : 'Done'}</button>
        </footer>
      </section>
    {/if}

    <div class="head">
      {#if bench.draft}
        <input class="name" aria-label="Name of the new check" title="Name of the new check" value={bench.draft.check.name}
          oninput={(event) => bench.nameDraft(event.currentTarget.value)} maxlength="120" />
      {:else}
        <div class="pick">
          <button class="select" aria-haspopup="menu" aria-expanded={open === 'check'} aria-label="Check on the map"
            onclick={() => (open = open === 'check' ? '' : 'check')}>
            {#if check}<span class="state {state}" aria-hidden="true">{GLYPHS[state]}</span>{/if}
            <strong>{check?.name ?? 'Basemap only'}</strong>
            <Icon name="chevronDown" size={13} />
          </button>
          {#if open === 'check'}
            <div class="menu cmp-glass" role="menu" aria-label="Checks">
              <button role="menuitemradio" aria-checked={!check} onclick={() => choose(null)}>
                <span class="state" aria-hidden="true"></span><span class="grow">Basemap only</span>
              </button>
              {#if bench.checks.length}<hr />{/if}
              {#each bench.checks as entry (entry.id)}
                {@const entryState = checkState(entry, bench.current)}
                <button role="menuitemradio" aria-checked={bench.selected === entry.id} onclick={() => choose(entry.id)}>
                  <span class="state {entryState}" aria-hidden="true">{GLYPHS[entryState]}</span>
                  <span class="grow">{entry.name}</span>
                  <small>{describeOutcome(entry, bench.current)}</small>
                </button>
              {/each}
              <hr />
              <button role="menuitem" disabled={bench.atMostChecks} onclick={startNew}><Icon name="plus" size={12} /><span class="grow">New check</span></button>
            </div>
          {/if}
        </div>
      {/if}

      {#if check && bench.dated && !bench.choosingPasses}
        {#if !bench.single}
          <div class="cmp-seg" role="group" aria-label="Which pass to look at">
            <button type="button" class:on={side === 'before'} aria-pressed={side === 'before'} disabled={bench.basemap}
              title="Show the before pass alone" onclick={() => show('before')}>Before <span class="cmp-mono">{before}</span></button>
            <button type="button" class:on={side === 'split'} aria-pressed={side === 'split'} disabled={bench.basemap}
              title="Split the map between the two passes" onclick={() => show('split')}>Split</button>
            <button type="button" class:on={side === 'after'} aria-pressed={side === 'after'} disabled={bench.basemap}
              title="Show the after pass alone" onclick={() => show('after')}>After <span class="cmp-mono">{after}</span></button>
          </div>
        {:else}
          <span class="date cmp-mono">{after}</span>
        {/if}
        <button class="cmp-icon" aria-label="Change the passes" title="Change the passes" onclick={() => bench.changePasses()}>
          <Icon name="calendar" size={14} /></button>
        <button class="cmp-icon eye" class:on={!bench.basemap} aria-pressed={!bench.basemap} aria-label="Passes on the map"
          title={bench.basemap ? 'Show the passes' : 'Show the basemap'} onclick={() => bench.setBasemap(!bench.basemap)}>
          <Icon name={bench.basemap ? 'eyeOff' : 'eye'} size={15} /></button>
        {#if !bench.radar}
          <div class="pick">
            <button class="select look" class:off={bench.basemap} aria-haspopup="menu" aria-expanded={open === 'look'}
              aria-label="Copernicus layer" title="How the passes are shown" onclick={() => (open = open === 'look' ? '' : 'look')}>
              <Icon name="layers" size={14} /><span>{layerLabel}</span><Icon name="chevronDown" size={13} />
            </button>
            {#if open === 'look'}
              <div class="menu look-menu cmp-glass" role="menu" aria-label="Copernicus layer">
                {#each bench.offered as entry (entry.id)}
                  <button role="menuitemradio" aria-checked={bench.layer === entry.id} title={entry.hint ?? ''}
                    onclick={() => { bench.setLayer(entry.id); open = ''; }}>
                    <span class="grow">{entry.label}</span>
                    {#if entry.id === suggestion}<small>best for rule ★</small>{/if}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {:else if !check}
        <span class="hint grow">Pick a check to try the rules on it.</span>
        <button class="btn btn-sm" disabled={bench.atMostChecks} onclick={startNew}><Icon name="plus" size={12} /> New check</button>
      {/if}

      {#if bench.draft && !bench.choosingPasses}
        <span class="grow"></span>
        <button class="btn btn-sm" onclick={() => bench.cancelDraft()}>Cancel</button>
        <button class="btn btn-sm btn-primary" disabled={!bench.canFinish} onclick={() => bench.finishDraft()}>Finish</button>
      {/if}
    </div>

    {#if check && !bench.choosingPasses}
      <div class="tools">
        <div class="pins" role="group" aria-label="Pin to drop on the map">
          <button type="button" class="pin" class:on={bench.pinning === 'found'} aria-pressed={bench.pinning === 'found'}
            onclick={() => bench.arm('found')}><i class="shape shape-found" aria-hidden="true"></i>Should be found</button>
          <button type="button" class="pin" class:on={bench.pinning === 'empty'} aria-pressed={bench.pinning === 'empty'}
            onclick={() => bench.arm('empty')}><i class="shape shape-empty" aria-hidden="true"></i>Should stay empty</button>
          <span class="count cmp-mono">{pinCount} pin{pinCount === 1 ? '' : 's'}</span>
        </div>
        <button class="btn test" class:btn-primary={!bench.tested} class:done={bench.tested} disabled={!bench.canTest}
          title={bench.blocked || undefined} onclick={() => bench.test()}>{bench.testLabel}</button>
      </div>
      {#if bench.pinning}
        <p class="note" role="status">Click the ground where {bench.pinning === 'found' ? 'a candidate should be found' : 'none should be'} (Esc stops).</p>
      {:else if bench.blocked && bench.dated}
        <p class="note" class:warn={!!bench.plan?.error} role="status">{bench.blocked}</p>
      {/if}
    {/if}

    {#if check && !bench.choosingPasses && (bench.detail || bench.last?.error)}
      <div class="result" class:stale={bench.stale} aria-live="polite">
        {#if bench.last?.error}
          <span class="outcome fail">{bench.last.error}</span>
        {:else}
          <span class="outcome {bench.stale ? 'stale' : state}">{bench.stale ? 'The rules or pins changed since this test.' : outcome}</span>
          <div class="legend" role="group" aria-label="Rules on the map">
            {#each bench.recipe.rules as rule, i (i)}
              <button type="button" class="chip" class:off={!bench.painted(i)} style={`--tint: ${bench.colours[i % bench.colours.length]}`}
                aria-pressed={bench.painted(i)} title={`${bench.painted(i) ? 'Hide' : 'Show'} rule ${i + 1} on the map`}
                onpointerenter={() => bench.hoverRule(i)} onpointerleave={() => bench.hoverRule(null)}
                onfocus={() => bench.hoverRule(i)} onblur={() => bench.hoverRule(null)} onclick={() => bench.toggleRule(i)}>
                <i class="dot">{i + 1}</i>{shortRule(rule, { single: bench.single })}</button>
            {/each}
          </div>
          <div class="cmp-seg" role="group" aria-label="What the map shows">
            <button type="button" class:on={bench.view === 'rules'} aria-pressed={bench.view === 'rules'}
              title="Each rule's pixels in its colour" onclick={() => (bench.view = 'rules')}>Rules</button>
            <button type="button" class:on={bench.view === 'detections'} aria-pressed={bench.view === 'detections'}
              title="Only what a run would return" onclick={() => (bench.view = 'detections')}>Detections</button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .bench-root { position: absolute; inset: 0; z-index: 650; pointer-events: none; }
  .console {
    position: absolute;
    bottom: 34px;
    left: 50%;
    display: grid;
    width: min(760px, calc(100% - 24px));
    transform: translateX(-50%);
    box-shadow: var(--shadow-2);
    pointer-events: auto;
  }
  .console > .head, .console > .tools, .console > .result, .console > .note { padding: 7px 10px; }
  .console > * + * { border-top: 1px solid var(--glass-line); }
  .head, .tools, .result { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; min-width: 0; }
  .grow { flex: 1; }

  /* Which check is on the map, which pass of it, and how the passes are shown. */
  .pick { position: relative; min-width: 0; }
  .select {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: 230px;
    min-height: 28px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    color: var(--glass-ink);
  }
  .select:hover, .select[aria-expanded='true'] { background: var(--glass-hover); }
  .select strong { overflow: hidden; font-size: var(--fs-sm); text-overflow: ellipsis; white-space: nowrap; }
  .select.look { max-width: 170px; border: 1px solid var(--glass-line); color: var(--glass-muted); font-size: var(--fs-xs); }
  .select.look span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .select.look.off { opacity: 0.55; }
  .state { flex: 0 0 auto; width: 14px; color: var(--glass-dim); font-weight: 700; text-align: center; }
  .state.pass { color: var(--ok); }
  .state.fail { color: var(--danger); }
  .state.unpinned { color: var(--warn); }
  .name {
    flex: 0 1 150px;
    min-width: 100px;
    border-color: transparent;
    background: transparent;
    font-weight: 650;
  }
  .name:hover { border-color: var(--glass-line); }
  .name:focus { border-color: var(--accent); background: var(--bg-0); }
  .date { color: var(--glass-muted); font-size: var(--fs-xs); }
  .head .cmp-seg > button { min-height: 24px; padding: 0 8px; }
  .head .cmp-seg .cmp-mono { color: var(--glass-dim); font-size: 10px; }
  .head .cmp-seg .on .cmp-mono { color: inherit; }
  .head .cmp-icon { width: 28px; height: 28px; }
  .menu {
    position: absolute;
    bottom: calc(100% + 10px);
    left: 0;
    z-index: 3;
    display: grid;
    width: 320px;
    max-width: calc(100vw - 48px);
    max-height: 300px;
    overflow: auto;
    padding: 4px;
    box-shadow: var(--shadow-2);
  }
  .look-menu { width: 280px; gap: 0; }
  .menu button {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 0 8px;
    border-radius: var(--r-sm);
    color: var(--glass-ink);
    font-size: var(--fs-xs);
    text-align: left;
  }
  .menu button:hover:not(:disabled) { background: var(--glass-hover); }
  .menu button[aria-checked='true'] { color: var(--accent); background: var(--accent-soft); }
  .menu button:disabled { opacity: 0.4; cursor: not-allowed; }
  .menu small { overflow: hidden; max-width: 130px; color: var(--glass-dim); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
  .menu hr { width: 100%; margin: 4px 0; border: 0; border-top: 1px solid var(--glass-line); }

  /* The passes of a check, in a drawer that opens above the console. */
  /* The title and the buttons stay where they are; only the passes scroll, so
     Place the pins is always in reach however short the window is. */
  .drawer {
    position: absolute;
    right: -1px;
    bottom: calc(100% + 8px);
    left: -1px;
    display: flex;
    flex-direction: column;
    max-height: min(480px, calc(100vh - 230px));
    overflow: hidden;
    box-shadow: var(--shadow-2);
  }
  .drawer header { display: flex; flex: 0 0 auto; align-items: center; gap: 8px; padding: 10px 12px 6px; }
  .drawer header strong { flex: 1; font-size: var(--fs-sm); }
  .drawer .body { display: grid; flex: 1 1 auto; gap: 8px; min-height: 0; overflow: auto; padding: 2px 12px 10px; }
  .drawer .hint { margin: 0; color: var(--glass-dim); font-size: var(--fs-xs); line-height: 1.45; }
  .slots { display: flex; flex-wrap: wrap; gap: 6px 16px; }
  .slot { display: inline-flex; align-items: center; gap: 6px; color: var(--glass-muted); font-size: var(--fs-xs); }
  .slot strong { color: var(--glass-ink); font-weight: 600; }
  .drawer footer {
    display: flex;
    flex: 0 0 auto;
    justify-content: flex-end;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid var(--glass-line);
  }

  /* The pins to drop, and the test. */
  .pins { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
  .pin {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 28px;
    padding: 0 10px;
    border: 1px solid var(--glass-line);
    border-radius: 999px;
    color: var(--glass-muted);
    font-size: var(--fs-xs);
    transition: background 0.12s var(--ease), border-color 0.12s var(--ease), color 0.12s var(--ease);
  }
  .pin:hover { border-color: var(--glass-line-strong); color: var(--glass-ink); }
  .pin.on { border-color: var(--accent); color: var(--glass-ink); background: var(--accent-soft); }
  /* The shapes the map draws: filled where a candidate should come out, struck where none should. The
     names keep clear of the app's own empty-state class. */
  .shape { position: relative; flex: 0 0 auto; width: 11px; height: 11px; border: 2px solid currentColor; border-radius: 50%; box-sizing: border-box; }
  .shape-found::after { position: absolute; inset: 1px; border-radius: 50%; background: currentColor; content: ''; }
  .shape-empty { border-style: dashed; }
  .shape-empty::after {
    position: absolute;
    top: 50%;
    left: -2px;
    width: 11px;
    height: 2px;
    background: currentColor;
    transform: translateY(-50%) rotate(-45deg);
    content: '';
  }
  .count { color: var(--glass-dim); font-size: 10.5px; }
  .test { min-width: 116px; min-height: 30px; margin-left: auto; }
  /* Nothing left to do: a quiet check mark, not a button asking to be pressed. */
  .test.done { border-color: var(--glass-line); background: transparent; color: var(--ok); opacity: 1; }
  .test.done::before { margin-right: 5px; content: '✓'; }
  .note { margin: 0; color: var(--glass-muted); font-size: var(--fs-xs); line-height: 1.45; }
  .note.warn { color: var(--warn); }

  /* How it came out, and a chip for each rule. */
  .result { gap: 8px 12px; }
  .result.stale { background: color-mix(in srgb, var(--warn) 8%, transparent); }
  .outcome { flex: 1 1 200px; color: var(--glass-muted); font-size: var(--fs-xs); font-weight: 600; line-height: 1.4; }
  .outcome.pass { color: var(--ok); }
  .outcome.fail { color: var(--danger); }
  .outcome.stale { color: var(--warn); }
  .legend { display: flex; flex-wrap: wrap; gap: 5px; }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    padding: 0 9px 0 4px;
    border: 1px solid color-mix(in srgb, var(--tint) 55%, transparent);
    border-radius: 999px;
    color: var(--glass-ink);
    font-size: 10.5px;
    font-weight: 600;
    transition: background 0.12s var(--ease), opacity 0.12s var(--ease);
  }
  .chip:hover { background: color-mix(in srgb, var(--tint) 16%, transparent); }
  .chip.off { border-style: dashed; color: var(--glass-dim); opacity: 0.75; }
  .chip .dot {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--tint);
    color: #111;
    font-size: 9.5px;
    font-style: normal;
    font-weight: 800;
    line-height: 1;
  }
  .chip.off .dot { background: transparent; color: var(--glass-dim); box-shadow: inset 0 0 0 1.5px var(--tint); }
  .narrow .pin { padding: 0 8px; }
  .narrow .test { flex: 1; margin-left: 0; }
</style>
