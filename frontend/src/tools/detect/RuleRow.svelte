<script>
  /**
   * One rule of an analyzer of your own: what it measures, on which date or
   * across the two, and the line it has to cross. Its colour is the colour its
   * pixels take on the map, and the share under it is how much of the measured
   * ground it keeps, alone and together with the rules above it.
   */
  import {
    BAND_NAMES, CLASS_NAMES, INDICES, L2A_BANDS, MEASURES, PAIRS, POLARISATIONS, formatShare, opsFor,
    retarget, scaleOf, ruleProblem, toEngine,
  } from '../../lib/map/analyzerRules.js';
  import Icon from '../../components/Icon.svelte';

  let {
    rule = $bindable(),
    index = 0,
    colour = '#facc15',
    /** The first measured rule: candidates are ranked by it. */
    signal = false,
    /** `{ share, kept }` from the last preview, or null. */
    reading = null,
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
  const scale = $derived(scaleOf(rule));
  const shownValue = $derived(Number((rule.value * scale.factor).toFixed(4)));
  const shownUpper = $derived(Number((rule.upper * scale.factor).toFixed(4)));
  const problem = $derived(ruleProblem(rule));
  const pair = $derived(PAIRS.find((entry) => entry.bands[0] === rule.bands[0] && entry.bands[1] === rule.bands[1])?.id ?? '');
  const DATES = [['a', 'A'], ['b', 'B'], ['change', 'A → B']];
  /** Its own share of the measured ground, then what is left once the rules above it have had theirs. */
  const shareText = $derived(!reading ? '' : [
    `${formatShare(reading.share)} of the ground`,
    index > 0 ? `${formatShare(reading.kept)} ${match === 'any' ? 'with any above' : 'left with the ones above'}` : '',
  ].filter(Boolean).join(' · '));

  function set(patch) {
    rule = retarget(rule, patch);
  }
  function setValue(key, shown) {
    const number = Number(shown);
    if (!Number.isFinite(number)) return;
    set({ [key]: toEngine(rule, number) });
  }
  function toggleClass(id) {
    const next = rule.classes.includes(id) ? rule.classes.filter((entry) => entry !== id) : [...rule.classes, id];
    set({ classes: next });
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="rule" style={`--tint: ${colour}`} onpointerenter={() => onhover(index)} onpointerleave={() => onhover(null)}>
  <div class="row head">
    <button class="eye" class:off={!shown} aria-pressed={shown} aria-label={`${shown ? 'Hide' : 'Show'} rule ${n} on the map`}
      title={shown ? 'Hide its pixels on the map' : 'Show its pixels on the map'} onclick={ontoggle}>
      <span class="swatch"></span>
    </button>
    {#if signal}
      <span class="rank on" title="Candidates are ranked by this rule">★ {n}</span>
    {:else}
      <button class="rank" title="Rank candidates by this rule" aria-label={`Rank candidates by rule ${n}`}
        disabled={rule.measure === 'class'} onclick={onsignal}>{n}</button>
    {/if}
    <select class="grow" aria-label={`Rule ${n} measures`} value={rule.measure}
      onchange={(event) => set({ measure: event.currentTarget.value })}>
      {#each MEASURES as measure (measure.id)}<option value={measure.id}>{measure.label}</option>{/each}
    </select>
    {#if canRemove}
      <button class="cmp-icon" aria-label={`Remove rule ${n}`} title="Remove this rule" onclick={onremove}>
        <Icon name="x" size={13} />
      </button>
    {/if}
  </div>

  {#if rule.measure === 'index'}
    <select aria-label={`Rule ${n} index`} value={rule.index}
      onchange={(event) => set({ index: event.currentTarget.value })}>
      {#each INDICES as entry (entry.id)}<option value={entry.id}>{entry.label} · {entry.hint}</option>{/each}
    </select>
  {:else if rule.measure === 'nd'}
    <div class="row">
      <select class="grow" aria-label={`Rule ${n} first band`} value={rule.bands[0]}
        onchange={(event) => set({ bands: [event.currentTarget.value, rule.bands[1]] })}>
        {#each bands as band (band)}<option value={band}>{band} · {BAND_NAMES[band] ?? ''}</option>{/each}
      </select>
      <span class="minus">vs</span>
      <select class="grow" aria-label={`Rule ${n} second band`} value={rule.bands[1]}
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
    <select aria-label={`Rule ${n} band`} value={rule.band}
      onchange={(event) => set({ band: event.currentTarget.value })}>
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

  <div class="row">
    <div class="cmp-seg" role="group" aria-label={`Rule ${n} reads`}>
      {#each DATES as [id, label] (id)}
        {@const allowed = rule.measure === 'colour' ? id === 'change' : rule.measure === 'class' ? id !== 'change' : true}
        <button type="button" class:on={rule.on === id} aria-pressed={rule.on === id}
          title={id === 'change' ? 'The change from A to B' : `Pass ${label} alone`}
          disabled={!allowed} onclick={() => set({ on: id })}>{label}</button>
      {/each}
    </div>
    <select class="grow" aria-label={`Rule ${n} comparison`} value={rule.op}
      onchange={(event) => set({ op: event.currentTarget.value })}>
      {#each opsFor(rule) as [id, label] (id)}<option value={id}>{label}</option>{/each}
    </select>
  </div>

  {#if rule.measure !== 'class'}
    <div class="row value">
      <input type="number" aria-label={`Rule ${n} value`} step={scale.step}
        value={shownValue} onchange={(event) => setValue('value', event.currentTarget.value)} />
      {#if rule.op === 'between'}
        <span class="minus">to</span>
        <input type="number" aria-label={`Rule ${n} upper value`} step={scale.step}
          value={shownUpper} onchange={(event) => setValue('upper', event.currentTarget.value)} />
      {/if}
      <span class="unit">{scale.suffix.trim()}</span>
    </div>
    <input type="range" aria-label={`Rule ${n} line`} min={scale.min} max={scale.max} step={scale.step}
      value={Math.min(scale.max, Math.max(scale.min, shownValue))}
      oninput={(event) => setValue('value', event.currentTarget.value)} />
    <label class="check" title="Compare with the ground around it rather than with a fixed value">
      <input type="checkbox" checked={rule.around > 0}
        onchange={(event) => set({ around: event.currentTarget.checked ? 150 : 0 })} />
      Against its surroundings
      {#if rule.around > 0}
        <input class="metres" type="number" min="20" max={maxAround} step="10" aria-label={`Rule ${n} surroundings in metres`}
          value={rule.around}
          onchange={(event) => set({ around: Math.min(maxAround, Math.max(20, Math.round(Number(event.currentTarget.value) || 150))) })} />
        m
      {/if}
    </label>
  {/if}

  {#if problem}
    <p class="warn">{problem}</p>
  {:else if reading}
    <p class="share" aria-label={`Rule ${n} share`}>{shareText}</p>
  {/if}
</div>

<style>
  .rule {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 6px;
    padding: 8px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--tint);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .head { gap: 5px; }
  /* A band's name is long; the column is not, and must not widen for it. */
  .rule > select, .rule select.grow { width: 100%; min-width: 0; }
  .eye { display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; }
  .eye:hover { background: var(--bg-3); }
  .swatch { width: 12px; height: 12px; border-radius: 50%; background: var(--tint); box-shadow: 0 0 0 1px rgb(0 0 0 / 0.3); }
  .eye.off .swatch { background: transparent; box-shadow: inset 0 0 0 2px var(--tint); }
  .rank {
    min-width: 26px;
    padding: 2px 5px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: 10.5px;
    font-weight: 700;
    text-align: center;
  }
  button.rank:hover:not(:disabled) { color: var(--text-1); background: var(--bg-3); }
  .rank.on { color: var(--accent); background: var(--accent-soft); }
  .minus, .unit { color: var(--text-3); font-size: var(--fs-xs); }
  .value input[type='number'] { width: 84px; }
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
  .share { margin: 0; color: var(--text-3); font-size: 10.5px; }
</style>
