<script>
  /**
   * Every rule read at a point the analyst clicked: the value, the line and
   * whether it passed. It is how a builder answers "why was this not kept?".
   * Pinned to the ground point, so it follows the map. From here the point can
   * become a pin of the check: somewhere a candidate should come out, or none.
   * Opened on a pin instead, it reads the ground under it and offers to turn
   * the pin the other way or take it away.
   */
  import { describeRule, formatValue } from '../../lib/map/analyzerRules.js';
  import Icon from '../../components/Icon.svelte';

  let {
    engine, probe, rules = [], colours = [], single = false, width = 0, height = 0, onclose = () => {},
    /** Drop a pin at the point: `onmark('found' | 'empty')`. Left out, the point cannot be kept. */
    onmark = null,
    /** The pin the card was opened on, `{ number, expect }`, when it was. */
    pin = null,
    onturn = () => {},
    onremove = () => {},
  } = $props();

  let revision = $state(0);
  $effect(() => {
    if (!engine) return;
    return engine.on('view-move', () => revision++);
  });
  const at = $derived.by(() => {
    revision;
    return engine?.latLngToContainerPoint(probe.point) ?? { x: 0, y: 0 };
  });
  /** Beside the point, on whichever side the map has room for it. */
  const place = $derived({
    left: width && at.x + 334 > width ? Math.max(4, at.x - 334) : at.x + 14,
    top: height && at.y + 180 > height ? Math.max(4, at.y - 180) : at.y + 14,
  });
  const result = $derived(probe.result);
  const status = $derived(
    probe.unread === 'passes' ? 'Pick the passes to read the rules here.'
    : probe.unread === 'frames' ? 'Test the check to read the rules here.'
    : probe.error ? probe.error
    : !result ? 'Reading…'
    : !result.ready ? 'Outside the ground the test read.'
    : !result.imaged ? 'No imagery here on the passes read.'
    : !result.measured ? 'Under cloud or shadow, so no rule is read.'
    : result.kept ? 'Kept' : 'Not kept'
  );
  /** A pin needs no reading, only somewhere to go; off the imagery it says nothing. */
  const markable = $derived(!!onmark && !pin && !(result?.ready && !result.imaged));
  const other = $derived(pin?.expect === 'found' ? 'Should stay empty' : 'Should be found');

  function reading(rule, row) {
    if (rule.measure === 'class') return row.passes ? 'yes' : 'no';
    if (rule.on === 'change' && rule.measure !== 'colour' && row.before !== null) {
      return `${formatValue(rule, row.before)} → ${formatValue(rule, row.after)} (${formatValue(rule, row.value, { signed: true })})`;
    }
    return formatValue(rule, row.value, { signed: !!rule.around });
  }
</script>

<div class="marker" style:left={`${at.x}px`} style:top={`${at.y}px`} aria-hidden="true"></div>
<div class="probe cmp-glass" role="dialog" aria-label="Rules at this point"
  style:left={`${place.left}px`} style:top={`${place.top}px`}>
  <header>
    <strong class:kept={result?.kept}>{status}</strong>
    <button class="cmp-icon" aria-label="Close the reading" title="Close" onclick={onclose}><Icon name="x" size={12} /></button>
  </header>
  {#if result?.ready && result.measured}
    <ul>
      {#each result.rules as row, i (i)}
        {#if rules[i]}
          <li style={`--tint: ${colours[i % colours.length]}`}>
            <span class="dot">{i + 1}</span>
            <span class="what" title={describeRule(rules[i], { single })}>{describeRule(rules[i], { single })}</span>
            <span class="value">{reading(rules[i], row)}</span>
            <span class="verdict" class:pass={row.passes}>{row.passes ? '✓' : '✗'}</span>
          </li>
        {/if}
      {/each}
    </ul>
  {/if}
  {#if pin}
    <footer>
      <span class="target">Pin {pin.number}: {pin.expect === 'found' ? 'should be found' : 'should stay empty'}</span>
      <div class="marks">
        <button class="btn btn-sm" onclick={onturn}>Turn into “{other}”</button>
        <button class="btn btn-sm" onclick={onremove}>Remove</button>
      </div>
    </footer>
  {:else if markable}
    <footer>
      <span class="target">Drop a pin here</span>
      <div class="marks">
        <button class="btn btn-sm" onclick={() => onmark('found')}>Should be found</button>
        <button class="btn btn-sm" onclick={() => onmark('empty')}>Should stay empty</button>
      </div>
    </footer>
  {/if}
</div>

<style>
  .marker {
    position: absolute;
    z-index: 560;
    width: 14px;
    height: 14px;
    transform: translate(-50%, -50%);
    border: 2px solid #fff;
    border-radius: 50%;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.6);
    pointer-events: none;
  }
  .probe {
    position: absolute;
    z-index: 660;
    display: grid;
    gap: 6px;
    width: min(320px, 70vw);
    padding: 8px 10px;
    font-size: var(--fs-xs);
  }
  header { display: flex; align-items: center; gap: 8px; }
  header strong { flex: 1; color: var(--glass-muted); }
  header strong.kept { color: var(--ok, #46a758); }
  ul { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; }
  li { display: grid; grid-template-columns: 14px 1fr auto 14px; align-items: center; gap: 6px; }
  .dot {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--tint);
    color: #111;
    font-size: 9px;
    font-weight: 800;
    line-height: 1;
  }
  .what { overflow: hidden; color: var(--glass-muted); text-overflow: ellipsis; white-space: nowrap; }
  .value { color: var(--glass-ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .verdict { color: var(--danger, #ef4444); font-weight: 700; text-align: center; }
  .verdict.pass { color: var(--ok, #46a758); }
  footer { display: grid; gap: 5px; padding-top: 6px; border-top: 1px solid var(--glass-line); }
  .target { color: var(--glass-muted); font-size: 10.5px; }
  .marks { display: flex; gap: 6px; }
  .marks .btn { flex: 1; }
</style>
