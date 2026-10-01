<script>
  /**
   * The checks of the analyzer being built, as a list. A check is made and
   * tried on the map, where its passes are the imagery and its pins are
   * dropped by a click; this is where they are kept in view: how each one came
   * out the last time, what trying them all would cost, and the pins of the
   * one on the bench, to turn or take away.
   *
   * Checks are how an analyzer is proved, so one is needed to save it: a place
   * with a pin where something should be found. The others may be traps, where
   * nothing may be.
   */
  import { checkState, describeOutcome } from '../../lib/map/analyzerRules.js';
  import Icon from '../../components/Icon.svelte';

  let { bench } = $props();

  const ICONS = { pass: '✓', fail: '✗', stale: '–', unrun: '–', unpinned: '!' };
  const single = $derived(bench.single);
  const passes = (check) => (!check.b?.date ? 'no passes yet'
    : single ? check.b.date : `Before ${check.a?.date || '…'} → After ${check.b.date}`);
  const requests = (count) => `${count} request${count === 1 ? '' : 's'}`;

  function status(check) {
    const test = bench.tests[check.id];
    if (test?.busy) return 'Testing…';
    if (test?.error) return test.error;
    const state = checkState(check, bench.current);
    const plan = bench.plans[check.id];
    if ((state === 'unrun' || state === 'stale') && plan?.missing) {
      return `${describeOutcome(check, bench.current)} · ${requests(plan.missing)} to read`;
    }
    return describeOutcome(check, bench.current);
  }
</script>

<section class="checks" aria-label="Checks">
  <p class="hint">A check is two passes and the pins that say where something should be found and where nothing may be.</p>
  <div class="row actions">
    <button class="btn btn-sm" disabled={bench.atMostChecks} onclick={() => bench.startDraft()}>
      <Icon name="plus" size={12} /> New check
    </button>
    {#if bench.checks.length}
      <button class="btn btn-sm" disabled={!!bench.running || !!bench.problem} onclick={() => bench.testAll()}>
        {bench.running || (bench.allMissing ? `Test all · up to ${requests(bench.allMissing)}` : 'Test all')}
      </button>
    {/if}
  </div>
  {#if !bench.checks.length}
    <p class="hint need">Saving needs a check with a pin where something should be found.</p>
  {/if}

  {#each bench.checks as check (check.id)}
    {@const state = checkState(check, bench.current)}
    {@const open = bench.selected === check.id}
    <div class="check" class:on={open}>
      <div class="head">
        <span class="state {state}" class:busy={bench.tests[check.id]?.busy} aria-hidden="true">{ICONS[state]}</span>
        <button class="open" aria-label={`Put the check ${check.name} on the map`} aria-pressed={open}
          onclick={() => bench.select(open ? null : check.id)}>
          <strong>{check.name}</strong>
          <small>{passes(check)}</small>
          <small class="outcome {state}">{status(check)}</small>
        </button>
        <button class="cmp-icon" aria-label={`Remove the check ${check.name}`} title="Remove this check"
          onclick={() => bench.remove(check.id)}><Icon name="trash" size={12} /></button>
      </div>
      {#if open}
        <div class="editor">
          <label class="field">Name
            <input aria-label="Check name" value={check.name} maxlength="120"
              onchange={(event) => bench.rename(check.id, event.currentTarget.value)} />
          </label>
          <div class="field">
            <span>Passes</span>
            <div class="row">
              <span class="grow">{passes(check)}</span>
              <button class="link" onclick={() => bench.changePasses()}>Change</button>
            </div>
          </div>
          <div class="field">
            <span>Pins</span>
            {#if check.marks.length}
              <ul class="marks">
                {#each check.marks as mark, i (i)}
                  <li>
                    <span class="dot pin-{mark.expect}" aria-hidden="true"></span>
                    <span class="grow">{mark.expect === 'found' ? 'Should be found' : 'Should stay empty'}</span>
                    {#if bench.outcomes.length}
                      <span class="verdict" class:ok={bench.outcomes[i]} title={bench.outcomes[i] ? 'Came out as it should' : 'Did not'}>
                        {bench.outcomes[i] ? '✓' : '✗'}</span>
                    {/if}
                    <button class="link" aria-label={`Turn pin ${i + 1} into ${mark.expect === 'found' ? 'a pin that should stay empty' : 'a pin that should be found'}`}
                      onclick={() => bench.flipPin(i)}>Turn</button>
                    <button class="cmp-icon" aria-label={`Remove pin ${i + 1}`} title="Remove this pin"
                      onclick={() => bench.removePin(i)}><Icon name="x" size={11} /></button>
                  </li>
                {/each}
              </ul>
            {:else}
              <span class="hint need">No pin yet: pick one on the map and click the ground.</span>
            {/if}
          </div>
        </div>
      {/if}
    </div>
  {/each}
</section>

<style>
  .checks { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
  .actions { flex-wrap: wrap; gap: 6px; }
  .need { color: var(--warn); }
  .check {
    display: grid;
    gap: 7px;
    padding: 7px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .check.on { border-color: var(--accent); }
  .head { display: flex; align-items: flex-start; gap: 7px; }
  .open { display: grid; flex: 1; gap: 2px; min-width: 0; text-align: left; }
  .open strong { overflow: hidden; color: var(--text-1); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  .open small { color: var(--text-3); font-size: 10.5px; line-height: 1.4; }
  .outcome.pass { color: var(--ok); }
  .outcome.fail { color: var(--danger); }
  .state { flex: 0 0 auto; width: 16px; margin-top: 1px; color: var(--text-3); font-weight: 700; text-align: center; }
  .state.pass { color: var(--ok); }
  .state.fail { color: var(--danger); }
  .state.unpinned { color: var(--warn); }
  .state.busy { color: var(--accent); }
  .editor { display: grid; gap: 9px; padding-top: 2px; }
  .field { display: grid; gap: 4px; color: var(--text-3); font-size: 10.5px; }
  .field > .row { color: var(--text-1); font-size: var(--fs-xs); }
  .marks { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; font-size: var(--fs-xs); }
  .marks li { display: flex; align-items: center; gap: 6px; color: var(--text-2); }
  .marks .cmp-icon { width: 22px; height: 22px; }
  /* The shapes the map draws: filled where a candidate should come out, struck
     where none should. Green and red are kept for how a pin came out. */
  .dot { position: relative; flex: 0 0 auto; width: 10px; height: 10px; border: 2px solid var(--text-1); border-radius: 50%; }
  .dot.pin-found::after { position: absolute; inset: 1px; border-radius: 50%; background: var(--text-1); content: ''; }
  .dot.pin-empty { border-style: dashed; }
  .dot.pin-empty::after {
    position: absolute;
    top: 50%;
    left: -2px;
    width: 10px;
    height: 2px;
    background: var(--text-1);
    transform: translateY(-50%) rotate(-45deg);
    content: '';
  }
  .verdict { color: var(--danger); font-weight: 700; }
  .verdict.ok { color: var(--ok); }
  .link { color: var(--accent); font-size: var(--fs-xs); }
</style>
