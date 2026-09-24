<script>
  /**
   * The checks of the analyzer being built: places the analyst trusts, each
   * with its passes and pins where a candidate should come out or none should.
   * They are optional. Add a check and it is open where the map is: the passes
   * picked are its passes, and while a pin is armed every click on the map
   * drops one. Whatever the tile cache holds is reread as the rules change;
   * Run all fetches the rest, and says first how many requests that is.
   */
  import { checkState, describeOutcome, markOutcomes } from '../../lib/map/analyzerRules.js';
  import Icon from '../../components/Icon.svelte';

  let {
    checks = [],
    /** The signature of the rules as they stand. */
    current = '',
    /** Per check id: `{ busy, missing, error }` from the last read. */
    readings = {},
    active = null,
    running = '',
    /** A view is on the map, so a check can be added there. */
    canAdd = false,
    /** The pin a click on the map drops: 'found', 'empty' or null. */
    pinning = null,
    most = 12,
    onadd = () => {},
    onpin = () => {},
    ondone = () => {},
    onfindpasses = () => {},
    onrun = () => {},
    onopen = () => {},
    onremove = () => {},
    onrename = () => {},
    onremovemark = () => {},
  } = $props();

  const ICONS = { pass: '✓', fail: '✗', counted: '#', stale: '–', unrun: '–' };
  /** Each check's own count; checks that share a tile read it once. */
  const missing = $derived(checks.reduce((sum, check) => sum + (readings[check.id]?.missing ?? 0), 0));
  const dated = (check) => !!check.b?.date;
  const passes = (check) => (!dated(check) ? 'no passes yet'
    : check.a?.date ? `A ${check.a.date} → B ${check.b.date}` : `B ${check.b.date}`);
  const PINS = [['found', 'Should be found'], ['empty', 'Should stay empty']];

  function status(check) {
    const reading = readings[check.id] ?? {};
    if (!dated(check)) return 'pick its passes';
    if (reading.busy) return 'Reading…';
    if (reading.error) return reading.error;
    const state = checkState(check, current);
    if (reading.missing && (state === 'unrun' || state === 'stale')) {
      const frames = `${reading.missing} frame${reading.missing === 1 ? '' : 's'} to read`;
      return check.marks.length ? frames : `${frames} for its whole view; pins read only their own tiles`;
    }
    return describeOutcome(check, current);
  }
</script>

<section class="checks" aria-label="Checks">
  <div class="row actions">
    <button class="btn btn-sm" disabled={!canAdd || checks.length >= most} onclick={onadd}>
      <Icon name="plus" size={12} /> Add a check
    </button>
    {#if checks.some(dated)}
      <button class="btn btn-sm btn-primary" disabled={!!running} onclick={onrun}>
        {running || (missing ? `Run all · up to ${missing} request${missing === 1 ? '' : 's'}` : 'Run all')}
      </button>
    {/if}
  </div>
  {#if !checks.length}
    <p class="hint">Checks are optional places you trust, pinned on two passes where a candidate should come out or
      none should, and rerun to show which rule broke what.</p>
  {/if}

  {#each checks as check (check.id)}
    {@const state = checkState(check, current)}
    {@const outcomes = markOutcomes(check)}
    <div class="check" class:on={active === check.id}>
      <div class="row head">
        <span class="state {state}" class:busy={readings[check.id]?.busy} aria-hidden="true">{ICONS[state]}</span>
        <button class="open grow" aria-label={`Open the check ${check.name} on the map`} onclick={() => onopen(check)}>
          <strong>{check.name}</strong>
          <small>{passes(check)} · {status(check)}</small>
        </button>
        <button class="cmp-icon" aria-label={`Remove the check ${check.name}`} title="Remove this check"
          onclick={() => onremove(check.id)}><Icon name="trash" size={12} /></button>
      </div>
      {#if active === check.id}
        <div class="editor">
          <label class="field">Name
            <input aria-label="Check name" value={check.name} maxlength="120"
              onchange={(event) => event.currentTarget.value.trim() && onrename(check.id, event.currentTarget.value.trim())} />
          </label>
          <div class="field">
            <span>Passes</span>
            <div class="row">
              <span class="grow" class:missing={!dated(check)}>{dated(check) ? passes(check) : 'None yet: until it has pins, this check is where the map is.'}</span>
              <button class="link" onclick={onfindpasses}>{dated(check) ? 'Change' : 'Find passes'}</button>
            </div>
          </div>
          <div class="field">
            <span>Pins</span>
            <div class="pins" role="group" aria-label="Pin to drop on the map">
              {#each PINS as [mode, label] (mode)}
                <button type="button" class="pin pin-{mode}" class:on={pinning === mode} aria-pressed={pinning === mode}
                  onclick={() => onpin(pinning === mode ? null : mode)}>
                  <span class="dot pin-{mode}" aria-hidden="true"></span>{label}
                </button>
              {/each}
            </div>
            <span class="hint">{pinning ? 'Click the map to drop pins; press the button again to stop.' : 'Pick a pin, then click the map where it goes.'}</span>
          </div>
          {#if check.marks.length}
            <ul class="marks">
              {#each check.marks as mark, i (i)}
                <li>
                  <span class="dot pin-{mark.expect}" aria-hidden="true"></span>
                  <span class="grow">{mark.expect === 'found' ? 'Should be found' : 'Should stay empty'}</span>
                  {#if state === 'pass' || state === 'fail'}
                    <span class="verdict" class:ok={outcomes[i]}>{outcomes[i] ? '✓' : '✗'}</span>
                  {/if}
                  <button class="cmp-icon" aria-label={`Remove pin ${i + 1}`} title="Remove this pin"
                    onclick={() => onremovemark(check.id, i)}><Icon name="x" size={11} /></button>
                </li>
              {/each}
            </ul>
          {/if}
          <button class="btn btn-sm done" onclick={ondone}>Done</button>
        </div>
      {/if}
    </div>
  {/each}
</section>

<style>
  .checks { display: grid; grid-template-columns: minmax(0, 1fr); gap: 7px; }
  .actions { flex-wrap: wrap; gap: 6px; }
  .check {
    display: grid;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .check.on { border-color: var(--accent); }
  .head { gap: 6px; align-items: flex-start; }
  .open { display: grid; gap: 2px; min-width: 0; text-align: left; }
  .open strong { overflow: hidden; color: var(--text-1); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  .open small { color: var(--text-3); font-size: 10.5px; line-height: 1.4; }
  .state { width: 16px; margin-top: 1px; color: var(--text-3); font-weight: 700; text-align: center; }
  .state.pass { color: var(--ok, #46a758); }
  .state.fail { color: var(--danger, #ef4444); }
  .state.busy { color: var(--accent); }
  .editor { display: grid; gap: 8px; }
  .field { display: grid; gap: 4px; color: var(--text-3); font-size: 10.5px; }
  .field > .row { color: var(--text-1); font-size: var(--fs-xs); }
  .missing { color: var(--warn, #e2a03f); }
  .pins { display: flex; flex-wrap: wrap; gap: 5px; }
  .pin {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .pin:hover { border-color: var(--border-strong); }
  .pin.on { border-color: var(--accent); color: var(--text-1); background: var(--accent-soft); }
  .marks { display: grid; gap: 3px; margin: 0; padding: 0; list-style: none; font-size: var(--fs-xs); }
  .marks li { display: flex; align-items: center; gap: 6px; color: var(--text-2); }
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
  .verdict { color: var(--danger, #ef4444); font-weight: 700; }
  .verdict.ok { color: var(--ok, #46a758); }
  .link { color: var(--accent); font-size: var(--fs-xs); }
  .done { justify-self: start; }
</style>
