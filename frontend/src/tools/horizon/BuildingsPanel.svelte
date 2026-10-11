<script>
  /**
   * The settings the Buildings row's Settings action opens: which radius
   * around the eye, which sources, what an unknown height does, how the roofs
   * and the walls look, the nudge that lines the picture up with the footprints,
   * and where the data comes from. Every change goes through the state's set(),
   * so the view redraws and the choice is saved with it.
   */
  import Icon from '../../components/Icon.svelte';
  import { RADII, SOURCES } from '../../lib/horizon/buildings.js';

  let {
    /** The buildings state (state/buildings.svelte.js). */
    buildings,
    /** Close the panel. */
    onclose = () => {},
  } = $props();

  const settings = $derived(buildings.settings);
  const radiusLabel = (metres) => `${metres / 1000} km`;

  function setSource(id, on) {
    buildings.set({ sources: { ...settings.sources, [id]: on } });
  }
</script>

<section class="bpanel" aria-label="Buildings settings">
  <header class="head">
    <h3>Buildings</h3>
    <button class="close" aria-label="Close" title="Close" onclick={onclose}>
      <Icon name="x" size={13} />
    </button>
  </header>

  <div class="group">
    <h4>Around the eye</h4>
    <div class="chips" role="group" aria-label="Radius around the eye">
      {#each RADII as metres (metres)}
        <button
          class="chip"
          class:on={settings.radius === metres}
          aria-pressed={settings.radius === metres}
          onclick={() => buildings.set({ radius: metres })}
        >{radiusLabel(metres)}</button>
      {/each}
    </div>
  </div>

  <div class="group">
    <h4>Sources</h4>
    {#each SOURCES as source (source.id)}
      <label class="check" title={source.title}>
        <input
          type="checkbox"
          checked={settings.sources[source.id]}
          onchange={(event) => setSource(source.id, event.currentTarget.checked)}
        />
        <span>{source.label}</span>
      </label>
    {/each}
    <p class="hint">
      Footprints come from the IGN where it has them, else OpenStreetMap where it maps most of the ground, else 3D-GloBFP. Heights: measured first, then estimated.
    </p>
  </div>

  <div class="group">
    <h4>Unknown heights</h4>
    <div class="chips" role="group" aria-label="Unknown heights">
      <button
        class="chip"
        class:on={settings.unknown === 'draw'}
        aria-pressed={settings.unknown === 'draw'}
        onclick={() => buildings.set({ unknown: 'draw' })}
      >Draw at 6 m</button>
      <button
        class="chip"
        class:on={settings.unknown === 'hide'}
        aria-pressed={settings.unknown === 'hide'}
        onclick={() => buildings.set({ unknown: 'hide' })}
      >Hide</button>
    </div>
    <label class="check">
      <input
        type="checkbox"
        checked={settings.showKinds}
        onchange={(event) => buildings.set({ showKinds: event.currentTarget.checked })}
      />
      <span>Tint doubtful heights</span>
    </label>
    <div class="legend">
      <span class="key"><i class="swatch range"></i>range of storeys</span>
      <span class="key"><i class="swatch unknown"></i>unknown</span>
    </div>
  </div>

  <div class="group">
    <h4>Roofs</h4>
    <div class="chips" role="group" aria-label="Roofs">
      <button
        class="chip"
        class:on={settings.roofs === 'tint'}
        aria-pressed={settings.roofs === 'tint'}
        onclick={() => buildings.set({ roofs: 'tint' })}
      >One tint</button>
      <button
        class="chip"
        class:on={settings.roofs === 'photo'}
        aria-pressed={settings.roofs === 'photo'}
        onclick={() => buildings.set({ roofs: 'photo' })}
      >Satellite photo</button>
    </div>
  </div>

  <div class="group">
    <h4>Look</h4>
    <div class="chips" role="group" aria-label="Look">
      <button
        class="chip"
        class:on={settings.look === 'solid'}
        aria-pressed={settings.look === 'solid'}
        onclick={() => buildings.set({ look: 'solid' })}
      >Solid</button>
      <button
        class="chip"
        class:on={settings.look === 'outline'}
        aria-pressed={settings.look === 'outline'}
        title="Edges only: the buildings' outlines, for laying a photo over them"
        onclick={() => buildings.set({ look: 'outline' })}
      >Edges only</button>
    </div>
  </div>

  <div class="group">
    <h4>Align the picture</h4>
    <div class="slide">
      <span class="name">Shift east</span>
      <input
        type="range"
        min="-15"
        max="15"
        step="0.5"
        aria-label="Shift east"
        value={settings.shift[0]}
        oninput={(event) => buildings.set({ shift: [Number(event.currentTarget.value), settings.shift[1]] })}
      />
      <output>{settings.shift[0].toFixed(1)} m</output>
    </div>
    <div class="slide">
      <span class="name">Shift north</span>
      <input
        type="range"
        min="-15"
        max="15"
        step="0.5"
        aria-label="Shift north"
        value={settings.shift[1]}
        oninput={(event) => buildings.set({ shift: [settings.shift[0], Number(event.currentTarget.value)] })}
      />
      <output>{settings.shift[1].toFixed(1)} m</output>
    </div>
    <div class="slide">
      <span class="name" title="Metres of lean per 10 m of height">Lean east</span>
      <input
        type="range"
        min="-8"
        max="8"
        step="0.25"
        aria-label="Lean east"
        value={settings.lean[0] * 10}
        oninput={(event) => buildings.set({ lean: [Number(event.currentTarget.value) / 10, settings.lean[1]] })}
      />
      <output>{(settings.lean[0] * 10).toFixed(2)} m</output>
    </div>
    <div class="slide">
      <span class="name" title="Metres of lean per 10 m of height">Lean north</span>
      <input
        type="range"
        min="-8"
        max="8"
        step="0.25"
        aria-label="Lean north"
        value={settings.lean[1] * 10}
        oninput={(event) => buildings.set({ lean: [settings.lean[0], Number(event.currentTarget.value) / 10] })}
      />
      <output>{(settings.lean[1] * 10).toFixed(2)} m</output>
    </div>
    <div class="reset-row">
      <p class="hint">Only the picture moves; the buildings keep their coordinates.</p>
      <button class="btn btn-sm" onclick={() => buildings.resetAlignment()}>Reset</button>
    </div>
  </div>

  <div class="group">
    <h4>Data</h4>
    <ul class="credits">
      {#each buildings.creditLines as line (line.id)}
        <li><a href={line.link} target="_blank" rel="noopener noreferrer">{line.text}</a></li>
      {/each}
    </ul>
    <p class="hint">The Fit ignores buildings for now.</p>
    <button class="btn btn-sm btn-ghost" disabled={buildings.busy} onclick={() => buildings.clearCache()}>
      Clear downloaded buildings
    </button>
  </div>
</section>

<style>
  .bpanel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 14px 16px;
    font-size: var(--fs-xs);
    color: var(--text-1);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  h3 {
    margin: 0;
    flex: 1;
    font-size: var(--fs-sm, 12px);
    font-weight: 600;
  }
  h4 {
    margin: 0 0 5px;
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .close {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    border-radius: var(--r-sm);
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }
  .close:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    padding: 3px 7px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: 10px;
    white-space: nowrap;
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--border-strong);
    color: var(--text-1);
  }
  .chip.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .check {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
    cursor: pointer;
  }
  .check input {
    margin: 0;
    accent-color: var(--accent);
  }
  .hint {
    margin: 0;
    color: var(--text-3);
    line-height: 1.4;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    color: var(--text-3);
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 2px;
  }
  .swatch.range {
    background: var(--warn, #f5b335);
  }
  .swatch.unknown {
    background: var(--danger, #e5473c);
  }
  .slide {
    display: grid;
    grid-template-columns: 74px 1fr 52px;
    align-items: center;
    gap: 6px;
    color: var(--text-2);
  }
  .slide input {
    width: 100%;
    margin: 0;
    accent-color: var(--accent);
  }
  .slide output {
    color: var(--text-3);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .reset-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .reset-row .hint {
    flex: 1;
  }
  .credits {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 3px;
    color: var(--text-2);
  }
  .credits a {
    color: var(--accent);
  }
</style>
