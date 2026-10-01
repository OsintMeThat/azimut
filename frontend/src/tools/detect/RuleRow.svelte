<script>
  /**
   * One rule of an analyzer of your own, written as the sentence it says:
   * what it measures, the date it is read on, and the line it has to cross.
   * The dot is the colour its pixels take on the map, with its number, and
   * hides or shows them. The line is a direction and an amount, and the pins of
   * the check on the bench sit along the slider where the last test read them,
   * so the line can be set between the ground that should come out and the
   * ground that should not.
   */
  import {
    BAND_NAMES, CLASS_NAMES, INDICES, L2A_BANDS, PAIRS, POLARISATIONS, amountOf, describeRule, directionOf,
    directionsFor, formatShare, lineScale, measuresFor, readsOneDate, retarget, ruleProblem, toEngine, whensFor,
    withAmount, withDirection,
  } from '../../lib/map/analyzerRules.js';
  import Icon from '../../components/Icon.svelte';

  let {
    rule = $bindable(),
    /** The analyzer, for which measures and dates a rule may use. */
    recipe,
    index = 0,
    colour = '#facc15',
    /** The first measured rule: candidates are ranked by it. */
    signal = false,
    /** `{ share, kept }` from the last test, or null. */
    reading = null,
    /** Where each pin of the check on the bench was read on this rule's line (`pinTicks`). */
    ticks = [],
    /** The last test no longer matches the rules, so what it said of this one is dimmed. */
    stale = false,
    /** What the last test said taking this rule out would change, in a few words, or ''. */
    effect = '',
    match = 'all',
    shown = true,
    ontoggle = () => {},
    bands = L2A_BANDS,
    classes = Object.keys(CLASS_NAMES),
    maxAround = 300,
    canRemove = true,
    onremove = () => {},
    onsignal = () => {},
    onhover = () => {},
  } = $props();

  const n = $derived(index + 1);
  const single = $derived(readsOneDate(recipe));
  const scale = $derived(lineScale(rule));
  const direction = $derived(directionOf(rule));
  const between = $derived(rule.op === 'between');
  const problem = $derived(ruleProblem(rule));
  const measures = $derived(measuresFor(recipe));
  const whens = $derived(whensFor(recipe, rule));
  const pair = $derived(PAIRS.find((entry) => entry.bands[0] === rule.bands[0] && entry.bands[1] === rule.bands[1])?.id ?? '');
  const shownAmount = $derived(Number((amountOf(rule) * scale.factor).toFixed(4)));
  const shownLower = $derived(Number((rule.value * scale.factor).toFixed(4)));
  const shownUpper = $derived(Number((rule.upper * scale.factor).toFixed(4)));
  /** Where the thumb sits along the track, 0 to 1. */
  const fraction = $derived(Math.min(1, Math.max(0, (shownAmount - scale.min) / (scale.max - scale.min))));
  /** Whether the ground that passes is above the thumb, as it is for at least, a rise or a drop. */
  const above = $derived(direction !== 'le');
  const hint = $derived(rule.on === 'a' ? 'Read on the before pass and painted on the left of the split.'
    : rule.on === 'b' ? 'Read on the after pass and painted on the right of the split.'
      : 'Read as after minus before and painted on both sides.');
  const sentence = $derived(describeRule(rule, { single }));
  /** Its own share of the measured ground, then what is left once the rules above it have had theirs. */
  const shareText = $derived(!reading ? '' : [
    `${formatShare(reading.share)} of the ground`,
    index > 0 ? `${formatShare(reading.kept)} ${match === 'any' ? 'with any above' : 'left with the ones above'}` : '',
  ].filter(Boolean).join(' · '));

  function set(patch) {
    rule = retarget(rule, patch);
  }
  function setAmount(text) {
    const number = Number(text);
    if (!Number.isFinite(number)) return;
    rule = { ...rule, value: withAmount(rule, toEngine(rule, number)) };
  }
  function setBound(key, text) {
    const number = Number(text);
    if (!Number.isFinite(number)) return;
    set({ [key]: toEngine(rule, number) });
  }
  function toggleClass(id) {
    const next = rule.classes.includes(id) ? rule.classes.filter((entry) => entry !== id) : [...rule.classes, id];
    set({ classes: next });
  }
  const tickWords = (tick) => `${tick.expect === 'found' ? 'Should be found' : 'Should stay empty'}: ${
    tick.passes ? 'this rule lets it through' : 'this rule turns it away'}`;
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="rule" class:off={!shown} style={`--tint: ${colour}`} onpointerenter={() => onhover(index)} onpointerleave={() => onhover(null)}>
  <div class="head">
    <button class="dot" class:off={!shown} aria-pressed={shown} aria-label={`${shown ? 'Hide' : 'Show'} rule ${n} on the map`}
      title={shown ? 'Hide its pixels on the map' : 'Show its pixels on the map'} onclick={ontoggle}>{n}</button>
    <p class="sentence" aria-label={`Rule ${n} says`}>{sentence}</p>
    <button class="star" class:on={signal} disabled={signal || rule.measure === 'class'}
      aria-label={signal ? `Rule ${n} ranks the candidates` : `Rank candidates by rule ${n}`}
      title={signal ? 'Candidates are ranked by this rule' : 'Rank candidates by this rule'} onclick={onsignal}>{signal ? '★' : '☆'}</button>
    {#if canRemove}
      <button class="cmp-icon" aria-label={`Remove rule ${n}`} title="Remove this rule" onclick={onremove}>
        <Icon name="x" size={13} />
      </button>
    {/if}
  </div>

  <div class="field">
    <span class="label">Measures</span>
    <div class="control">
      {#if measures.length > 1}
        <select aria-label={`Rule ${n} measures`} value={rule.measure} onchange={(event) => set({ measure: event.currentTarget.value })}>
          {#each measures as measure (measure.id)}<option value={measure.id} title={measure.hint}>{measure.label}</option>{/each}
        </select>
      {/if}
      {#if rule.measure === 'index'}
        <select aria-label={`Rule ${n} index`} value={rule.index} onchange={(event) => set({ index: event.currentTarget.value })}>
          {#each INDICES as entry (entry.id)}<option value={entry.id}>{entry.label} · {entry.hint}</option>{/each}
        </select>
      {:else if rule.measure === 'nd'}
        <div class="pair">
          <select aria-label={`Rule ${n} first band`} value={rule.bands[0]}
            onchange={(event) => set({ bands: [event.currentTarget.value, rule.bands[1]] })}>
            {#each bands as band (band)}<option value={band}>{band} · {BAND_NAMES[band] ?? ''}</option>{/each}
          </select>
          <span class="minus">vs</span>
          <select aria-label={`Rule ${n} second band`} value={rule.bands[1]}
            onchange={(event) => set({ bands: [rule.bands[0], event.currentTarget.value] })}>
            {#each bands as band (band)}<option value={band}>{band} · {BAND_NAMES[band] ?? ''}</option>{/each}
          </select>
        </div>
        <select aria-label={`Rule ${n} known pair`} value={pair}
          onchange={(event) => {
            const found = PAIRS.find((entry) => entry.id === event.currentTarget.value);
            if (found) set({ bands: [...found.bands] });
          }}>
          <option value="">(first − second) / (first + second)</option>
          {#each PAIRS as entry (entry.id)}<option value={entry.id}>{entry.label} · {entry.hint}</option>{/each}
        </select>
      {:else if rule.measure === 'band'}
        <select aria-label={`Rule ${n} band`} value={rule.band} onchange={(event) => set({ band: event.currentTarget.value })}>
          {#each bands as band (band)}<option value={band}>{band} · {BAND_NAMES[band] ?? ''}</option>{/each}
        </select>
      {:else if rule.measure === 'radar'}
        <div class="cmp-seg fill" role="group" aria-label={`Rule ${n} polarisation`}>
          {#each POLARISATIONS as entry (entry.id)}
            <button type="button" class:on={rule.polarisation === entry.id} aria-pressed={rule.polarisation === entry.id}
              onclick={() => set({ polarisation: entry.id })}>{entry.label}</button>
          {/each}
        </div>
      {:else if rule.measure === 'class'}
        <div class="classes" role="group" aria-label={`Rule ${n} ground classes`}>
          {#each classes as id (id)}
            <button type="button" class="chip" class:on={rule.classes.includes(id)} aria-pressed={rule.classes.includes(id)}
              onclick={() => toggleClass(id)}>{CLASS_NAMES[id] ?? id}</button>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  {#if whens.length > 1}
    <div class="field">
      <span class="label">Read on</span>
      <div class="control">
        <div class="cmp-seg fill" role="group" aria-label={`Rule ${n} reads`}>
          {#each whens as [id, label] (id)}
            <button type="button" class:on={rule.on === id} aria-pressed={rule.on === id} onclick={() => set({ on: id })}>{label}</button>
          {/each}
        </div>
        <span class="note">{hint}</span>
      </div>
    </div>
  {/if}

  {#if rule.measure !== 'class'}
    <div class="field">
      <span class="label">Line</span>
      <div class="control">
        <div class="cmp-seg fill" role="group" aria-label={`Rule ${n} comparison`}>
          {#each directionsFor(rule) as [id, label] (id)}
            <button type="button" class:on={direction === id} aria-pressed={direction === id}
              onclick={() => (rule = withDirection(rule, id))}>{label}</button>
          {/each}
        </div>
        <div class="value">
          {#if between}
            <input type="number" aria-label={`Rule ${n} value`} step={scale.step} value={shownLower}
              onchange={(event) => setBound('value', event.currentTarget.value)} />
            <span class="minus">to</span>
            <input type="number" aria-label={`Rule ${n} upper value`} step={scale.step} value={shownUpper}
              onchange={(event) => setBound('upper', event.currentTarget.value)} />
          {:else}
            <input type="number" aria-label={`Rule ${n} value`} step={scale.step} value={shownAmount}
              onchange={(event) => setAmount(event.currentTarget.value)} />
          {/if}
          <span class="unit">{scale.suffix.trim()}</span>
        </div>
        {#if !between}
          <div class="line" class:stale>
            <input class="range" class:above type="range" aria-label={`Rule ${n} line`} min={scale.min} max={scale.max} step={scale.step}
              style={`--fraction: ${fraction}`} value={Math.min(scale.max, Math.max(scale.min, shownAmount))}
              oninput={(event) => setAmount(event.currentTarget.value)} />
            {#each ticks as tick (tick.pin)}
              <i class="tick tick-{tick.expect}" class:passes={tick.passes} class:clipped={tick.clipped}
                style={`--at: ${tick.at}`} title={tickWords(tick)} role="img" aria-label={tickWords(tick)}></i>
            {/each}
          </div>
          {#if ticks.length}
            <span class="key" aria-hidden="true"><i class="tick tick-found"></i> should be found <i class="tick tick-empty"></i> should stay empty</span>
          {/if}
        {/if}
        <label class="check" title="Compare with the ground around it, not a fixed value">
          <input type="checkbox" checked={rule.around > 0}
            onchange={(event) => set({ around: event.currentTarget.checked ? 150 : 0 })} />
          Against the ground around it
          {#if rule.around > 0}
            <input class="metres" type="number" min="20" max={maxAround} step="10" aria-label={`Rule ${n} surroundings in metres`}
              value={rule.around}
              onchange={(event) => set({ around: Math.min(maxAround, Math.max(20, Math.round(Number(event.currentTarget.value) || 150))) })} />
            m
          {/if}
        </label>
      </div>
    </div>
  {:else}
    <div class="field">
      <span class="label">Ground is</span>
      <div class="control">
        <div class="cmp-seg fill" role="group" aria-label={`Rule ${n} comparison`}>
          {#each directionsFor(rule) as [id, label] (id)}
            <button type="button" class:on={direction === id} aria-pressed={direction === id} onclick={() => set({ op: id })}>{label}</button>
          {/each}
        </div>
      </div>
    </div>
  {/if}

  {#if problem}
    <p class="warn">{problem}</p>
  {:else if shareText}
    <p class="share" class:stale aria-label={`Rule ${n} share`}>{shareText}</p>
  {/if}
  {#if effect}
    <p class="effect" class:stale aria-label={`Rule ${n} effect`}>{effect}</p>
  {/if}
</div>

<style>
  .rule {
    container: rule / inline-size;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 8px;
    padding: 9px 10px 10px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--tint);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .rule.off { border-left-color: color-mix(in srgb, var(--tint) 35%, transparent); }
  .head { display: flex; align-items: flex-start; gap: 7px; }
  .dot {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    margin-top: 0;
    border-radius: 50%;
    background: var(--tint);
    color: #111;
    font-size: 11px;
    font-weight: 800;
    line-height: 1;
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.3);
  }
  .dot.off { background: transparent; color: var(--text-2); box-shadow: inset 0 0 0 2px var(--tint); }
  .sentence {
    flex: 1;
    min-width: 0;
    margin: 1px 0 0;
    color: var(--text-1);
    font-size: var(--fs-xs);
    font-weight: 600;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .star { flex: 0 0 auto; padding: 0 3px; color: var(--text-3); font-size: 15px; line-height: 20px; }
  .star:hover:not(:disabled) { color: var(--accent); }
  .star.on { color: var(--accent); }
  .star:disabled { cursor: default; }
  .star:disabled:not(.on) { opacity: 0.35; }
  .head .cmp-icon { width: 22px; height: 22px; }
  .field { display: grid; grid-template-columns: 58px minmax(0, 1fr); gap: 8px; align-items: start; }
  .label { padding-top: 6px; color: var(--text-3); font-size: 10.5px; font-weight: 600; letter-spacing: 0.02em; }
  .control { display: grid; gap: 6px; min-width: 0; }
  .control select { width: 100%; min-width: 0; }
  /* A row of choices that does not fit goes onto a second line rather than out of the card. */
  .control :global(.cmp-seg.fill) { flex-wrap: wrap; }
  /* At the dock's narrowest the label goes over its control, which then has the card's whole width. */
  @container rule (max-width: 300px) {
    .field { grid-template-columns: minmax(0, 1fr); gap: 3px; }
    .label { padding-top: 0; }
    .control :global(.cmp-seg.fill > button) { padding: 0 5px; }
  }
  .pair { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 5px; }
  .note { color: var(--text-3); font-size: 10.5px; line-height: 1.4; }
  .value { display: flex; align-items: center; gap: 6px; }
  .value input[type='number'] { width: 84px; }
  .minus, .unit { color: var(--text-3); font-size: var(--fs-xs); }
  .metres { width: 62px; }
  .classes { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip {
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-2);
    font-size: 10.5px;
  }
  .chip.on { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }

  /* The slider, with the ground that passes in the accent and the pins along it. */
  .line { position: relative; padding-top: 12px; }
  .line.stale { opacity: 0.6; }
  .range {
    --track: calc(7px + (100% - 14px) * var(--fraction));
    -webkit-appearance: none;
    appearance: none;
    display: block;
    width: 100%;
    height: 18px;
    margin: 0;
    background: transparent;
    cursor: pointer;
  }
  .range::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 99px;
    background: linear-gradient(90deg, var(--accent) var(--track), var(--border-strong) var(--track));
  }
  .range.above::-webkit-slider-runnable-track {
    background: linear-gradient(90deg, var(--border-strong) var(--track), var(--accent) var(--track));
  }
  .range::-moz-range-track { height: 4px; border-radius: 99px; background: var(--border-strong); }
  .range::-moz-range-progress { height: 4px; border-radius: 99px; background: var(--accent); }
  .range.above::-moz-range-progress { background: var(--border-strong); }
  .range.above::-moz-range-track { background: var(--accent); }
  .range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    margin-top: -5px;
    border: 2px solid var(--bg-2);
    border-radius: 50%;
    background: var(--text-1);
    box-shadow: 0 1px 4px rgb(0 0 0 / 0.5);
  }
  .range::-moz-range-thumb { width: 10px; height: 10px; border: 2px solid var(--bg-2); border-radius: 50%; background: var(--text-1); }
  .range:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
  /* The shapes the map draws: filled where a candidate should come out, struck
     where none should. */
  .tick {
    position: absolute;
    top: 1px;
    left: calc(7px + (100% - 14px) * var(--at));
    width: 9px;
    height: 9px;
    transform: translateX(-50%);
    border: 2px solid var(--text-1);
    border-radius: 50%;
    background: var(--bg-2);
    box-sizing: border-box;
  }
  .tick-found { background: var(--text-1); }
  .tick-empty { border-style: dashed; }
  .tick.clipped { opacity: 0.6; }
  .tick.passes { box-shadow: 0 0 0 2px color-mix(in srgb, var(--ok) 70%, transparent); }
  .key { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; color: var(--text-3); font-size: 10px; }
  .key .tick { position: static; flex: 0 0 auto; transform: none; margin-left: 4px; }
  .key .tick:first-child { margin-left: 0; }
  .check { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; color: var(--text-2); font-size: var(--fs-xs); }
  .share, .effect { margin: 0; color: var(--text-3); font-size: 10.5px; line-height: 1.4; }
  .effect { color: var(--text-2); }
  .share.stale, .effect.stale { opacity: 0.6; }
  .warn { margin: 0; }
</style>
