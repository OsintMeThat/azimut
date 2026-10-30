<script>
  /**
   * The ground window's body: what the line climbs and falls, the heights the
   * eye and the target stand at, how the crest is coloured, then the chart.
   *
   * The heights sit with the answer they change, each with the usual ones a
   * press away. The crest is coloured by what the eye at A sees once a line of
   * sight is read, and by how steep each stretch is otherwise; the choice is
   * remembered.
   */
  import Icon from '../../components/Icon.svelte';
  import ElevationProfile from './ElevationProfile.svelte';
  import { formatDistance, formatHeight, haversine } from '../../lib/measure.js';
  import { climb, gradeDegrees, slopes } from '../../lib/profile.js';

  let {
    /** The Measure tool's store (state/measure.svelte.js). */
    tool,
    /** Open Horizon at A, facing B. */
    onlook,
    /** A point of the chart brought to the middle of the map. */
    onpick,
  } = $props();

  const EYES = [
    [1.7, 'A person'],
    [10, 'A roof or a mast'],
    [30, 'A tower'],
    [120, 'A drone'],
  ];
  const TARGETS = [
    [0, 'The ground'],
    [1.7, 'A person'],
    [3, 'A vehicle'],
    [10, 'A building'],
    [30, 'A mast'],
  ];
  const MODE_KEY = 'azimut:groundColour';

  let mode = $state(remembered());

  function remembered() {
    try {
      return localStorage.getItem(MODE_KEY) === 'slope' ? 'slope' : 'sight';
    } catch {
      return 'sight';
    }
  }

  function colourBy(next) {
    mode = next;
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* the choice is a convenience */
    }
  }

  const m = $derived(tool.selected);
  const ground = $derived(tool.ground);
  const profile = $derived(ground?.answer ?? null);
  const units = $derived(tool.units);
  const pair = $derived(m?.points.length === 2 && !m.closed);
  const stats = $derived(profile ? climb(profile.elevation) : null);
  const steepest = $derived(profile ? Math.max(0, ...slopes(profile.distance_m, profile.elevation).map(Math.abs)) : 0);
  // where the line's inner corners fall along it, for the chart to mark
  const marks = $derived.by(() => {
    if (!m || m.points.length < 3) return [];
    let along = 0;
    return m.points.slice(1, -1).map((point, i) => (along += haversine(m.points[i], point)));
  });

  function height(which, value) {
    if (value === '' || value == null) return;
    tool.setHeights({ [which]: value });
  }
</script>

<div class="ground">
  <div class="bar">
    {#if stats}
      <dl class="stats">
        <div><dt>Length</dt><dd class="mono">{formatDistance(profile.distance_m.at(-1), units)}</dd></div>
        <div><dt>Climb</dt><dd class="mono up">↗ {formatHeight(stats.up, units)}</dd></div>
        <div><dt>Descent</dt><dd class="mono down">↘ {formatHeight(stats.down, units)}</dd></div>
        <div><dt>Lowest</dt><dd class="mono">{formatHeight(stats.min, units)}</dd></div>
        <div><dt>Highest</dt><dd class="mono">{formatHeight(stats.max, units)}</dd></div>
        <div><dt>Steepest</dt><dd class="mono">{Math.round(gradeDegrees(steepest))}°</dd></div>
      </dl>
    {:else}
      <span class="stats-wait"></span>
    {/if}

    <div class="controls">
      {#if pair}
        <div class="height" title="How high the eye stands above the ground at A">
          <Icon name="eye" size={12} />
          <span class="key">Eye</span>
          <input
            class="mono"
            type="number"
            min="0"
            step="any"
            aria-label="Eye at A, metres above the ground"
            value={tool.eyeHeight}
            onchange={(event) => height('eye', event.currentTarget.value)}
          />
          <span class="unit">m</span>
          <select aria-label="The usual eye heights" onchange={(event) => { height('eye', event.currentTarget.value); event.currentTarget.value = ''; }}>
            <option value="" hidden></option>
            {#each EYES as [value, label] (value)}<option {value}>{label}, {value} m</option>{/each}
          </select>
        </div>
        <div class="height" title="How high the target stands above the ground at B">
          <Icon name="crosshair" size={12} />
          <span class="key">Target</span>
          <input
            class="mono"
            type="number"
            min="0"
            step="any"
            aria-label="Target at B, metres above the ground"
            value={tool.targetHeight}
            onchange={(event) => height('target', event.currentTarget.value)}
          />
          <span class="unit">m</span>
          <select aria-label="The usual target heights" onchange={(event) => { height('target', event.currentTarget.value); event.currentTarget.value = ''; }}>
            <option value="" hidden></option>
            {#each TARGETS as [value, label] (value)}<option {value}>{label}, {value} m</option>{/each}
          </select>
        </div>
      {/if}
      {#if profile?.sight}
        <div class="segments" role="group" aria-label="Colour the ground by">
          <button type="button" aria-pressed={mode === 'sight'} title="What the eye at A sees of the line" onclick={() => colourBy('sight')}>Sight</button>
          <button type="button" aria-pressed={mode === 'slope'} title="How steep each stretch is" onclick={() => colourBy('slope')}>Slope</button>
        </div>
      {/if}
      {#if pair}
        <button class="btn btn-ghost btn-sm" onclick={() => tool.swap(m.id)} title="Look from B toward A instead">
          <Icon name="swap" size={13} />
        </button>
        <button class="btn btn-sm look" onclick={onlook} title="Open Horizon standing at A, facing B">
          <Icon name="horizon" size={13} /> Look from A
        </button>
      {/if}
    </div>
  </div>

  <ElevationProfile
    {profile}
    busy={ground?.busy}
    error={ground?.error}
    {units}
    mode={profile?.sight ? mode : 'slope'}
    {marks}
    readIndex={tool.readIndex}
    onhover={(index) => tool.showReading(index)}
    {onpick}
  />
</div>

<style>
  .ground {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px 18px;
    flex-wrap: wrap;
  }
  .stats {
    display: flex;
    margin: 0;
  }
  .stats div {
    display: grid;
    gap: 1px;
    padding: 0 14px;
    border-left: 1px solid var(--border);
  }
  .stats div:first-child {
    padding-left: 0;
    border-left: 0;
  }
  .stats dt {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-3);
  }
  .stats dd {
    margin: 0;
    font-size: var(--fs-sm);
    font-weight: 600;
    color: var(--text-1);
  }
  .stats .up {
    color: #efb446;
  }
  .stats .down {
    color: #7dd3fc;
  }
  .stats-wait {
    flex: 1;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .height {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 4px 0 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-1);
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .height:focus-within {
    border-color: var(--accent);
  }
  .key {
    color: var(--text-2);
  }
  .height input {
    width: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--text-1);
    font-size: var(--fs-xs);
    text-align: right;
    outline: none;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .height input::-webkit-inner-spin-button {
    display: none;
  }
  /* the usual heights, behind a small chevron */
  .height select {
    width: 18px;
    height: 18px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'%3E%3Cpath d='M2 3.5l3 3 3-3' fill='none' stroke='%239f9f9f' stroke-width='1.4'/%3E%3C/svg%3E")
      center / 10px no-repeat;
    color: transparent;
    cursor: pointer;
    appearance: none;
  }
  .height select:hover {
    background-color: var(--bg-3);
  }
  .height select option {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .segments {
    display: flex;
    height: 26px;
    border: 1px solid var(--border);
    border-radius: 999px;
    overflow: hidden;
    background: var(--bg-1);
  }
  .segments button {
    padding: 0 10px;
    color: var(--text-2);
    font-size: 10.5px;
    cursor: pointer;
  }
  .segments button + button {
    border-left: 1px solid var(--border);
  }
  .segments button[aria-pressed='true'] {
    background: var(--accent-soft);
    color: var(--text-1);
    font-weight: 600;
  }
  .look {
    border-radius: 999px;
  }
</style>
