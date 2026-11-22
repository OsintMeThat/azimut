<script>
  /**
   * The Measure tool's panel, in the rail's one panel slot.
   *
   * The map carries the numbers, written along each line; the panel carries
   * what a measure can be made to say. It lists every measure drawn, each with
   * what it reads, and opens the selected one: its reading in large, the length and bearing typed in place
   * to move B, what a line of two points is used as, whether the ground is
   * read, and the acts that keep it, copy it or look along it.
   *
   * It folds down to its header and one line, what the measure in hand reads,
   * so the map has its room back; the fold is remembered.
   */
  import Icon from '../../components/Icon.svelte';
  import DateField from '../../components/DateField.svelte';
  import { formatArea, formatBearing, formatDistance, pathLength, perimeter, polygonArea } from '../../lib/measure.js';
  import {
    coneWidth,
    fieldUnit,
    fieldValue,
    formatTolerance,
    isPair,
    MAX_RINGS,
    MAX_TOLERANCE,
    pairReading,
    parseDistance,
    PAST,
    REACH,
    USES,
  } from '../../lib/measures.js';
  import { parseHeading, windOf } from '../../lib/horizon/geometry.js';

  let {
    /** The tool's store (state/measure.svelte.js). */
    tool,
    /** Put the measure in one of the case's layers, the menu hung on the button pressed. */
    onkeep,
    oncopy,
    /** Open Horizon at A, facing B. */
    onlook,
  } = $props();

  const UNITS = [
    [null, 'App', 'The units set in Settings'],
    ['metric', 'km', 'Metres and kilometres'],
    ['imperial', 'mi', 'Feet and miles'],
    ['nautical', 'NM', 'Nautical miles, heights in metres'],
  ];
  const ICONS = { ring: 'rings', cone: 'viewCone', align: 'alignment', shadow: 'sun', viewshed: 'eye' };
  const FOLD_KEY = 'azimut:measurePanelFolded';

  let folded = $state(foldRemembered());

  function foldRemembered() {
    try {
      return localStorage.getItem(FOLD_KEY) === '1';
    } catch {
      return false;
    }
  }

  function fold() {
    folded = !folded;
    try {
      if (folded) localStorage.setItem(FOLD_KEY, '1');
      else localStorage.removeItem(FOLD_KEY);
    } catch {
      /* the fold is a convenience */
    }
  }

  const m = $derived(tool.drawing ? null : tool.selected);
  const units = $derived(tool.units);
  const pair = $derived(isPair(m));
  const reading = $derived(pair ? pairReading(m) : null);
  const unit = $derived(reading ? fieldUnit(reading.length, units) : 'm');
  const answer = $derived(m ? (tool.answers[m.id] ?? {}) : {});
  const reach = $derived(m?.reach ?? REACH);
  const reachUnit = $derived(fieldUnit(reach, units));
  const meet = $derived(m?.use === 'align' ? tool.meeting : null);
  const tolerance = $derived(m?.tolerance ?? 0);
  const opensAt = $derived(m?.use === 'align' ? tool.bandOpensAt(m.id) : null);

  function typedLength(event) {
    const metres = parseDistance(event.currentTarget.value, unit);
    if (metres) tool.setLength(m.id, metres);
    else event.currentTarget.value = fieldValue(reading.length, unit);
  }

  function typedReach(event) {
    const metres = parseDistance(event.currentTarget.value, reachUnit);
    if (metres) tool.setReach(m.id, metres);
    else event.currentTarget.value = fieldValue(reach, reachUnit);
  }

  function typedBearing(event) {
    const degrees = parseHeading(event.currentTarget.value);
    if (degrees != null) tool.setBearing(m.id, degrees);
    else event.currentTarget.value = formatBearing(reading.bearing, 1).replace('°', '');
  }

  /** Enter in a field is the field's: the map's own Enter finishes a measure. */
  function enter(event) {
    if (event.key !== 'Enter') return;
    event.stopPropagation();
    event.currentTarget.blur();
  }

  function height(which, event) {
    tool.setHeights({ [which]: event.currentTarget.value });
  }
</script>

<div class="measure-panel card" class:folded data-guide="map.measure">
  <header>
    <span class="title"><Icon name="ruler" size={13} /> Measure</span>
    <div class="segments units" role="group" aria-label="Units">
      {#each UNITS as [value, label, said] (label)}
        <button type="button" aria-pressed={tool.unitsChoice === value} title={said} onclick={() => tool.setUnits(value)}>{label}</button>
      {/each}
    </div>
    {#if tool.measures.length}
      <button class="btn btn-ghost btn-sm icon" onclick={() => tool.clearAll()} title="Take every measure off the map" aria-label="Clear every measure">
        <Icon name="reset" size={13} />
      </button>
    {/if}
    <button
      class="btn btn-ghost btn-sm icon"
      onclick={fold}
      title={folded ? 'Unfold the panel' : 'Fold the panel to one line'}
      aria-label={folded ? 'Unfold the measure panel' : 'Fold the measure panel'}
      aria-expanded={!folded}
    >
      <Icon name={folded ? 'chevronDown' : 'chevronUp'} size={13} />
    </button>
  </header>

  {#if tool.aligning}
    <div class="aligning">
      <Icon name="alignment" size={13} />
      <span>{tool.hint}</span>
      <button class="btn btn-ghost btn-xs" onclick={() => tool.stopAligning()} title="New lines are plain measures again (Escape)">Stop</button>
    </div>
  {/if}

  {#if folded}
    <!-- while aligning, the strip above says what to click -->
    {#if tool.drawing && !tool.aligning}
      <p class="drawing"><span class="pulse"></span>{tool.hint}</p>
    {:else if tool.selected && !tool.drawing}
      <p class="compact mono"><span class="n">{tool.selectedId}</span>{tool.readingOf(tool.selectedId) || '…'}</p>
    {:else if !tool.aligning}
      <p class="how">{tool.hint}</p>
    {/if}
  {:else}

  {#if !tool.measures.length && !tool.aligning}
    <div class="welcome">
      <svg viewBox="0 0 120 34" aria-hidden="true">
        <path d="M12 24 L58 10 L104 22" class="drawn" />
        <circle cx="12" cy="24" r="4" /><circle cx="58" cy="10" r="4" /><circle cx="104" cy="22" r="4" />
        <rect x="22" y="2" width="30" height="9" rx="2" /><rect x="70" y="2" width="30" height="9" rx="2" />
      </svg>
      <p class="lead">Click on the map to start a measure.</p>
      <p class="how">A double click ends a line, a click on its first point closes an area.</p>
      <ul class="keys">
        <li><kbd>Backspace</kbd> takes a point back</li>
        <li><kbd>Alt</kbd> keeps a click off what is there</li>
      </ul>
    </div>
  {:else if tool.drawing && !tool.aligning}
    <p class="drawing"><span class="pulse"></span>{tool.hint}</p>
  {/if}

  {#if tool.measures.length}
    <ul class="list" aria-label="Measures">
      {#each tool.measures as one (one.id)}
        <li class:on={one.id === tool.selectedId}>
          <button class="row" onclick={() => tool.select(one.id)} title="Select this measure">
            <span class="n mono">{one.id}</span>
            <Icon name={one.closed ? 'polygon' : 'ruler'} size={12} />
            <span class="what mono">{tool.readingOf(one.id) || '…'}</span>
          </button>
          <button class="btn btn-ghost btn-xs gone" onclick={() => tool.remove(one.id)} title="Take this measure off the map" aria-label="Remove measure {one.id}">
            <Icon name="x" size={12} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if m && m.points.length >= 2}
    <section class="detail">
      {#if pair}
        <div class="hero">
          <label class="big" title="Type a length to move B along the line, in any unit: 2.5 km, 800 m, 3 NM">
            <input
              class="mono"
              aria-label="Length"
              value={fieldValue(reading.length, unit)}
              style:width={`${fieldValue(reading.length, unit).length + 0.8}ch`}
              onchange={typedLength}
              onkeydown={enter}
            />
            <span class="unit">{unit === 'nm' ? 'NM' : unit}</span>
          </label>
          <label class="big bearing" title="Type a bearing, or a wind like NE, to turn B round A">
            <input
              class="mono"
              aria-label="Bearing"
              value={formatBearing(reading.bearing, 1).replace('°', '')}
              style:width="5.8ch"
              onchange={typedBearing}
              onkeydown={enter}
            />
            <span class="unit">° {windOf(reading.bearing)}</span>
          </label>
          <button class="btn btn-ghost btn-sm icon" onclick={() => tool.swap(m.id)} title="Turn the line round: B becomes A" aria-label="Turn the line round">
            <Icon name="swap" size={13} />
          </button>
        </div>
        <p class="sub mono">back {formatBearing(reading.back, 1)}</p>

        <div class="tiles" role="group" aria-label="Use this line as">
          {#each USES as use (use.id)}
            <button type="button" aria-pressed={m.use === use.id} title={use.title} onclick={() => tool.setUse(m.id, use.id)}>
              <Icon name={ICONS[use.id]} size={16} />
              <span>{use.label}</span>
            </button>
          {/each}
        </div>

        {#if m.use === 'ring'}
          <div class="use">
            <label class="field" title="How many rings, each as wide as the line again">
              <span>Rings</span>
              <input class="mono" type="number" min="1" max={MAX_RINGS} value={m.rings} onchange={(e) => tool.setRings(m.id, e.currentTarget.value)} />
            </label>
            <p class="answer">out to {formatDistance(reading.length * m.rings, units)}</p>
          </div>
        {:else if m.use === 'cone'}
          <div class="use">
            <label class="field" title="How wide the cone opens, in degrees">
              <span>Opening</span>
              <input class="mono" type="number" min="1" max="360" value={m.aperture} onchange={(e) => tool.setAperture(m.id, e.currentTarget.value)} />
              <span class="unit">°</span>
            </label>
            <p class="answer">{formatDistance(coneWidth(m), units)} across at B</p>
          </div>
        {:else if m.use === 'align'}
          <div class="use column">
            <div class="row-fields">
              <div class="segments" role="group" aria-label="Run the line on">
                {#each PAST as way (way.id)}
                  <button type="button" aria-pressed={(m.past ?? 'both') === way.id} title={way.title} onclick={() => tool.setPast(m.id, way.id)}>{way.label}</button>
                {/each}
              </div>
              <label class="field" title="How far the line runs on, in any unit: 20 km, 5 mi">
                <span>for</span>
                <input
                  class="mono"
                  aria-label="How far the line runs on"
                  value={fieldValue(reach, reachUnit)}
                  onchange={typedReach}
                  onkeydown={enter}
                />
                <span class="unit">{reachUnit === 'nm' ? 'NM' : reachUnit}</span>
              </label>
            </div>
            <label class="field tolerance" title="How far off true the two things may line up in the picture">
              <span>Within</span>
              <input
                type="range"
                min="0"
                max={MAX_TOLERANCE}
                step="0.1"
                aria-label="Tolerance in degrees"
                value={tolerance}
                oninput={(e) => tool.setTolerance(m.id, e.currentTarget.value)}
              />
              <span class="mono value">{tolerance ? formatTolerance(tolerance) : 'exact'}</span>
            </label>
            {#if opensAt != null}
              <p class="note">At {formatTolerance(tolerance)} it rules nothing out past {formatDistance(opensAt, units)}.</p>
            {/if}
            {#if meet}
              {#if meet.at}
                <div class="meet">
                  <p class="answer">{meet.lead}</p>
                  <button class="btn btn-ghost btn-xs mono" onclick={() => tool.copyMeeting()} title="Copy where they meet">
                    {meet.where} <Icon name="copy" size={11} />
                  </button>
                </div>
              {:else}
                <p class="answer">{meet.lead}</p>
              {/if}
              {#if meet.missing}<p class="note">{meet.missing}.</p>{/if}
            {/if}
            <p class="note">The camera stands on the line, on the side of the nearer thing.</p>
          </div>
        {:else if m.use === 'shadow'}
          <div class="use column">
            <DateField
              day
              reading={false}
              label="The day the picture was taken"
              value={tool.shadowDate(m.id) ?? ''}
              onchange={(value) => tool.setShadowDate(m.id, value)}
            />
            {#if !tool.shadowDate(m.id)}
              <p class="note">The picture has no day: type the one it was taken.</p>
            {:else if answer.shadow?.busy}
              <p class="note">Reading the sun…</p>
            {:else if answer.shadow?.error}
              <p class="failed">{answer.shadow.error}</p>
            {:else if answer.shadow?.answer}
              <p class="answer">{tool.readout}</p>
            {/if}
            <p class="note">From the foot of what casts it to the tip of its shadow. Assumes level ground seen from overhead.</p>
          </div>
        {:else if m.use === 'viewshed'}
          <div class="use column">
            <div class="row-fields">
              <label class="field" title="How high the eye stands above the ground at A">
                <span>Eye</span>
                <input class="mono" type="number" min="0" step="any" value={tool.eyeHeight} onchange={(e) => height('eye', e)} />
                <span class="unit">m</span>
              </label>
              <label class="field" title="How high what is looked for stands above the ground">
                <span>Target</span>
                <input class="mono" type="number" min="0" step="any" value={tool.targetHeight} onchange={(e) => height('target', e)} />
                <span class="unit">m</span>
              </label>
            </div>
            {#if answer.viewshed?.busy}
              <p class="note">Reading the ground round A…</p>
            {:else if answer.viewshed?.error}
              <p class="failed">{answer.viewshed.error}</p>
            {:else if answer.viewshed?.answer}
              <div class="share">
                <div class="meter"><span style:width={`${Math.round(answer.viewshed.answer.share * 100)}%`}></span></div>
                <p class="answer">
                  {Math.round(answer.viewshed.answer.share * 100)}% of the ground within {formatDistance(answer.viewshed.answer.radius_m, units)} in sight
                </p>
              </div>
            {/if}
            <p class="note">Bare ground: buildings and trees are not in the heights.{reading.length > 30_000 ? ' Reads 30 km out at most.' : ''}</p>
          </div>
        {/if}
      {:else if m.closed}
        <div class="hero">
          <span class="big read mono">{formatArea(polygonArea(m.points), units)}</span>
        </div>
        <p class="sub mono">perimeter {formatDistance(perimeter(m.points), units)} · {m.points.length} corners</p>
        <button class="btn btn-ghost btn-sm" onclick={() => tool.setClosed(m.id, false)} title="Make it a line again">Open the area</button>
      {:else}
        <div class="hero">
          <span class="big read mono">{formatDistance(pathLength(m.points), units)}</span>
        </div>
        <p class="sub mono">{m.points.length - 1} legs</p>
        <button class="btn btn-ghost btn-sm" onclick={() => tool.setClosed(m.id, true)} title="Close it back to its first point">Close into an area</button>
      {/if}

      {#if !m.closed}
        <div class="ground-row">
          <label class="switch" title={tool.groundForced ? 'The 3D view reads the ground' : 'Read the heights along the line, and what A sees of it'}>
            <input type="checkbox" role="switch" checked={tool.groundOn} disabled={tool.groundForced} onchange={(e) => tool.setGround(e.currentTarget.checked)} />
            <span class="track" aria-hidden="true"><span class="knob"></span></span>
            <span class="say">
              <span>Ground</span>
              <span class="note">{tool.groundForced ? 'read by the 3D view' : pair ? 'heights and line of sight' : 'heights along the line'}</span>
            </span>
          </label>
          {#if tool.groundOn}
            <button
              class="btn btn-sm chart"
              class:on={tool.chartShown}
              onclick={() => tool.showChart(!tool.chartShown)}
              aria-pressed={tool.chartShown}
              title={tool.chartShown ? 'Hide the heights chart' : 'Show the heights chart'}
            >
              <Icon name="profile" size={13} /> Chart
            </button>
          {/if}
        </div>
      {/if}

      <div class="acts">
        <button class="btn btn-primary btn-sm" onclick={(event) => onkeep(m.id, event.currentTarget)} title="Put this measure in one of the case's layers">
          <Icon name="layers" size={13} /> Keep
        </button>
        <button class="btn btn-sm" onclick={() => oncopy(m.id)} title="Copy what it reads, with its points">
          <Icon name="copy" size={13} /> Copy
        </button>
        {#if pair}
          <button class="btn btn-sm" onclick={() => onlook(m.id)} title="Open Horizon standing at A, facing B">
            <Icon name="horizon" size={13} /> Look from A
          </button>
        {/if}
        <button class="btn btn-ghost btn-sm icon trash" onclick={() => tool.remove(m.id)} title="Take it off the map (Delete)" aria-label="Remove">
          <Icon name="trash" size={13} />
        </button>
      </div>
    </section>
  {/if}
  {/if}
</div>

<style>
  .measure-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 330px;
    max-height: calc(100vh - 220px);
    overflow-y: auto;
    padding: 10px 12px 12px;
    background: rgba(20, 20, 20, 0.94);
    backdrop-filter: blur(8px);
    box-shadow: var(--shadow-2), 0 0 0 1px var(--border);
    font-size: var(--fs-xs);
  }
  header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .measure-panel.folded {
    gap: 6px;
    padding-bottom: 9px;
  }
  .compact {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 0;
    color: var(--text-1);
    font-weight: 600;
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-right: auto;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .segments {
    display: flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
    background: var(--bg-1);
  }
  .segments button {
    padding: 2px 8px;
    color: var(--text-2);
    font-size: 10.5px;
    cursor: pointer;
  }
  .segments button + button {
    border-left: 1px solid var(--border);
  }
  .segments button:hover {
    background: var(--bg-3);
  }
  .segments button[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--text-1);
    font-weight: 600;
  }
  .welcome {
    display: grid;
    gap: 5px;
    padding: 4px 2px 2px;
  }
  .welcome svg {
    width: 120px;
    height: 34px;
    margin-bottom: 2px;
  }
  .welcome .drawn {
    fill: none;
    stroke: #f5a623;
    stroke-width: 2;
    stroke-linecap: round;
  }
  .welcome circle {
    fill: #f5a623;
    stroke: #fff;
    stroke-width: 1.5;
  }
  .welcome rect {
    fill: rgba(255, 255, 255, 0.08);
    stroke: rgba(245, 166, 35, 0.5);
  }
  .lead {
    margin: 0;
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  .how,
  .keys,
  .note,
  .sub {
    margin: 0;
    color: var(--text-3);
  }
  .keys {
    display: grid;
    gap: 4px;
    margin: 2px 0 0;
    padding: 0;
    list-style: none;
  }
  .keys li {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  kbd {
    padding: 0 5px;
    border: 1px solid var(--border-strong);
    border-bottom-width: 2px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font: 600 10px var(--font-mono);
  }
  .drawing {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    color: var(--text-2);
  }
  .pulse {
    width: 8px;
    height: 8px;
    flex: none;
    border-radius: 50%;
    background: #f5a623;
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 5px rgba(245, 166, 35, 0.15);
      opacity: 0.6;
    }
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .list li {
    display: flex;
    align-items: center;
    border-radius: var(--r-md);
  }
  .list li:hover {
    background: var(--bg-2);
  }
  .list li.on {
    background: var(--accent-soft);
  }
  .row {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 4px 6px;
    color: var(--text-2);
    cursor: pointer;
    text-align: left;
  }
  .list li.on .row {
    color: var(--text-1);
  }
  .n {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    flex: none;
    border-radius: 50%;
    background: rgba(245, 166, 35, 0.18);
    color: #f5a623;
    font-size: 9.5px;
    font-weight: 700;
  }
  .what {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .gone {
    opacity: 0;
  }
  .list li:hover .gone,
  .gone:focus-visible {
    opacity: 1;
  }
  .detail {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .hero {
    display: flex;
    align-items: baseline;
    gap: 12px;
  }
  .big {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
    color: var(--text-1);
    font-size: 1.45rem;
    font-weight: 600;
    line-height: 1.1;
  }
  .big.read {
    font-family: var(--font-mono);
  }
  .big input {
    min-width: 2.5ch;
    padding: 0 2px;
    border: 0;
    border-bottom: 1px dashed transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    font-family: var(--font-mono);
    outline: none;
  }
  .big input:hover {
    border-bottom-color: var(--border-strong);
  }
  .big input:focus {
    border-bottom-color: var(--accent);
  }
  .big.bearing {
    color: #f5a623;
  }
  .big .unit {
    color: var(--text-3);
    font-size: var(--fs-sm);
    font-weight: 500;
  }
  .icon {
    padding: 4px 6px;
  }
  .hero .icon {
    margin-left: auto;
    align-self: center;
  }
  .sub {
    margin-top: -4px;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 5px;
  }
  .tiles button {
    display: grid;
    justify-items: center;
    gap: 3px;
    padding: 7px 2px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-1);
    color: var(--text-2);
    font-size: 10.5px;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s, color 0.12s;
  }
  .tiles button:hover {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .tiles button[aria-pressed='true'] {
    border-color: rgba(245, 166, 35, 0.8);
    background: var(--accent-soft);
    color: #f5c06a;
    font-weight: 600;
  }
  .use {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: var(--r-lg);
    background: rgba(255, 255, 255, 0.03);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .use.column {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .row-fields {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .aligning {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 6px 5px 9px;
    border-radius: var(--r-md);
    background: rgba(45, 224, 255, 0.08);
    box-shadow: inset 0 0 0 1px rgba(45, 224, 255, 0.35);
    color: #8eefff;
  }
  .aligning span {
    margin-right: auto;
  }
  .field.tolerance {
    display: flex;
  }
  .field.tolerance input {
    flex: 1;
    width: auto;
    padding: 0;
    border: 0;
    background: none;
    accent-color: #2de0ff;
  }
  .field.tolerance .value {
    min-width: 4.5ch;
    color: var(--text-1);
    text-align: right;
  }
  .meet {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 4px 8px;
  }
  .meet .btn {
    gap: 5px;
    color: var(--text-2);
  }
  .field {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-3);
  }
  .field input {
    width: 52px;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-1);
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .answer {
    margin: 0;
    color: var(--text-1);
    font-weight: 600;
  }
  .failed {
    margin: 0;
    color: var(--warn);
  }
  .share {
    display: grid;
    gap: 4px;
  }
  .meter {
    height: 5px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .meter span {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #1aa6c0, #2de0ff);
  }
  .ground-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .chart.on {
    border-color: var(--accent);
    color: var(--accent);
  }
  .switch {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 2px 0;
    cursor: pointer;
  }
  /* the box itself lies over the track, unseen, so the track is what is pressed */
  .switch input {
    position: absolute;
    left: 0;
    width: 28px;
    height: 16px;
    margin: 0;
    opacity: 0;
    cursor: pointer;
    z-index: 1;
  }
  .track {
    position: relative;
    width: 28px;
    height: 16px;
    flex: none;
    border-radius: 999px;
    background: var(--bg-3);
    box-shadow: inset 0 0 0 1px var(--border-strong);
    transition: background 0.15s;
  }
  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #d6d6d6;
    transition: transform 0.15s var(--ease);
  }
  .switch input:checked + .track {
    background: #c98a2c;
  }
  .switch input:checked + .track .knob {
    transform: translateX(12px);
    background: #fff;
  }
  .switch input:focus-visible + .track {
    outline: 1px solid var(--accent);
    outline-offset: 2px;
  }
  .switch input:disabled + .track {
    opacity: 0.7;
  }
  .say {
    display: grid;
    color: var(--text-1);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 5px;
    padding-top: 2px;
  }
  .trash {
    margin-left: auto;
  }
</style>
