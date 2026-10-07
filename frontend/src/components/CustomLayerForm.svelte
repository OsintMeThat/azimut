<script>
  /**
   * One Copernicus layer being written: how its pixels are made, and what it is
   * called.
   *
   * Three ways in, the ones Copernicus Browser offers: three bands on red,
   * green and blue; one normalised difference on a ramp; or the JavaScript
   * itself. The first two *write* the script rather than being a different kind
   * of layer, so what is saved is always a script and everything downstream
   * stays one idea. Leaving a form for Custom script hands over the text it
   * generated, which is then yours to take anywhere.
   *
   * **The draft belongs to whoever opened this form**, not to the form, so
   * closing the panel to look at the preview on the map and reopening it keeps
   * what was typed. `lib/customLayers.startForm` makes one; this reads and
   * mutates it.
   *
   * The same form in both places it is needed, so Settings and the map picker
   * cannot drift. Settings manages the list and has no scene to try a script
   * on; the picker passes `onpreview` and draws the result on the map, which is
   * the only way to tell whether a script says what you meant.
   */
  import Icon from './Icon.svelte';
  import { asName, layerPayload, layerProblem } from '../lib/customLayers.js';
  import {
    COMPOSITE_PRESETS,
    INDEX_PRESETS,
    RAMPS,
    WAYS,
    bandLabel,
    rampGradient,
    scriptFor,
  } from '../lib/layerScripts.js';

  let {
    /** The draft, from `startForm`. Mutated here, owned by the caller. */
    form,
    /** Layer ids a script can read its data from (radar already excluded). */
    bases = [],
    /** The Sentinel-2 L2A bands, from the backend, which owns the list. */
    bands = [],
    /** Names already taken by something this form must not overwrite. */
    taken = [],
    scriptMax = 4000,
    /** Draw the script on the map as it stands. Absent = no preview here. */
    onpreview = null,
    onsave,
    oncancel,
    busy = false,
    /** Said under the buttons: what the last preview or save did. */
    note = '',
  } = $props();

  const choices = $derived(bands.length ? bands : ['B02', 'B03', 'B04', 'B08', 'B11', 'B12']);
  /** What would be saved, whichever way is open. */
  const script = $derived(
    scriptFor(form.way, { composite: form.composite, index: form.index, script: form.typed })
  );
  const problem = $derived(layerProblem({ ...form, script }, { taken, scriptMax }));
  const over = $derived(script.length > scriptMax);
  // Only a new layer is named here. An existing one keeps the name and the data
  // source every capture, cache directory and saved session was rendered from.
  const naming = $derived(!form.editing);
  const way = $derived(WAYS.find((entry) => entry.id === form.way) ?? WAYS[0]);
  const chosenRamp = $derived(RAMPS.find((entry) => entry.id === form.index.rampId) ?? RAMPS[0]);

  /** Leaving a form for the script carries its text over, so nothing is lost. */
  function go(next) {
    if (next === 'script' && form.way !== 'script') form.typed = script;
    form.way = next;
  }

  function useComposite(preset) {
    const [red, green, blue] = preset.bands;
    Object.assign(form.composite, { red, green, blue });
    if (!form.hint) form.hint = preset.hint;
  }

  function useIndex(preset) {
    Object.assign(form.index, { high: preset.high, low: preset.low, rampId: preset.rampId });
    if (!form.hint) form.hint = preset.hint;
  }
</script>

<div class="layer-form">
  <section class="block">
    <header class="block-head">
      <h4>How the pixels are made</h4>
      <span class="count mono" class:over title="Characters of script, and the budget">
        {script.length}/{scriptMax}
      </span>
    </header>

    <div class="ways" role="tablist" aria-label="How the pixels are made">
      {#each WAYS as entry (entry.id)}
        <button
          class="way"
          class:on={form.way === entry.id}
          role="tab"
          aria-selected={form.way === entry.id}
          title={entry.hint}
          onclick={() => go(entry.id)}
        >
          {entry.label}
        </button>
      {/each}
    </div>
    <p class="why">{way.hint}.</p>

    {#if form.way === 'composite'}
      <div class="presets">
        <span class="presets-label">Start from</span>
        {#each COMPOSITE_PRESETS as preset (preset.id)}
          <button class="chip" title={preset.hint} onclick={() => useComposite(preset)}>
            {preset.label}
          </button>
        {/each}
      </div>

      <!-- Three explicit binds rather than a loop over the channel names: a
           `bind:` through a computed key does not hold its channel. -->
      <div class="three">
        <label class="field">
          <span class="chan"><i class="dot red"></i> Red</span>
          <select class="input" aria-label="Red band" bind:value={form.composite.red}>
            {#each choices as entry (entry)}<option value={entry}>{bandLabel(entry)}</option>{/each}
          </select>
        </label>
        <label class="field">
          <span class="chan"><i class="dot green"></i> Green</span>
          <select class="input" aria-label="Green band" bind:value={form.composite.green}>
            {#each choices as entry (entry)}<option value={entry}>{bandLabel(entry)}</option>{/each}
          </select>
        </label>
        <label class="field">
          <span class="chan"><i class="dot blue"></i> Blue</span>
          <select class="input" aria-label="Blue band" bind:value={form.composite.blue}>
            {#each choices as entry (entry)}<option value={entry}>{bandLabel(entry)}</option>{/each}
          </select>
        </label>
      </div>

      <label class="field">
        <span class="row-label">
          Brightness <span class="readout mono">×{form.composite.gain}</span>
        </span>
        <input
          class="slider"
          type="range"
          min="0.5"
          max="8"
          step="0.1"
          aria-label="Brightness"
          bind:value={form.composite.gain}
        />
      </label>
      <p class="help">
        <Icon name="info" size={12} />
        <span>A band's value runs 0 to 1, so it needs multiplying to fill a channel.</span>
      </p>
    {:else if form.way === 'index'}
      <div class="presets">
        <span class="presets-label">Start from</span>
        {#each INDEX_PRESETS as preset (preset.id)}
          <button class="chip" title={preset.hint} onclick={() => useIndex(preset)}>
            {preset.label}
          </button>
        {/each}
      </div>

      <div class="two">
        <label class="field">
          <span>Band A</span>
          <select class="input" aria-label="Band A" bind:value={form.index.high}>
            {#each choices as entry (entry)}<option value={entry}>{bandLabel(entry)}</option>{/each}
          </select>
        </label>
        <label class="field">
          <span>Band B</span>
          <select class="input" aria-label="Band B" bind:value={form.index.low}>
            {#each choices as entry (entry)}<option value={entry}>{bandLabel(entry)}</option>{/each}
          </select>
        </label>
      </div>
      <p class="help">
        <Icon name="info" size={12} />
        <span>
          Each pixel becomes <span class="mono">(A − B) / (A + B)</span>, a number from −1 to 1.
        </span>
      </p>

      <label class="field">
        <span>Colours</span>
        <select class="input" aria-label="Colour ramp" bind:value={form.index.rampId}>
          {#each RAMPS as entry (entry.id)}<option value={entry.id}>{entry.label}</option>{/each}
        </select>
      </label>
      <div class="ramp">
        <span class="ramp-end mono">−1</span>
        <span
          class="ramp-bar"
          style:background={rampGradient(form.index.rampId)}
          role="img"
          aria-label={`${chosenRamp.label} ramp, from −1 to 1`}
        ></span>
        <span class="ramp-end mono">+1</span>
      </div>
      <p class="help">
        <Icon name="info" size={12} />
        <span>The number picks its colour along that bar.</span>
      </p>

      <label class="field">
        <span>Leave dark at or below</span>
        <input
          class="input narrow"
          type="number"
          min="-1"
          max="1"
          step="0.05"
          aria-label="Leave dark at or below"
          bind:value={form.index.threshold}
          placeholder="nothing"
        />
      </label>
      <p class="help">
        <Icon name="info" size={12} />
        <span>
          Empty draws the whole bar; a number hides everything under it, which is how a hotspot
          reads on its own.
        </span>
      </p>
    {:else}
      <textarea
        class="input script mono"
        bind:value={form.typed}
        spellcheck="false"
        rows="14"
        aria-label="Evalscript"
        placeholder="//VERSION=3&#10;function setup() &#123; … &#125;&#10;function evaluatePixel(p) &#123; … &#125;"
      ></textarea>
      <p class="help">
        <Icon name="info" size={12} />
        <span>A Copernicus evalscript. The Composite and Index tabs write one for you to edit.</span>
      </p>
    {/if}
  </section>

  <section class="block">
    <header class="block-head"><h4>Name it</h4></header>

    <div class="two">
      <label class="field">
        <span>Name</span>
        <input
          class="input mono"
          value={form.id}
          disabled={!naming}
          placeholder="PLUME_SWIR"
          aria-label="Layer name"
          title={naming
            ? 'Capitals, digits and underscores'
            : 'A saved layer keeps its name: captures and caches are filed under it'}
          oninput={(e) => (form.id = asName(e.currentTarget.value))}
        />
      </label>
      <label class="field">
        <span>Reads data from</span>
        <select
          class="input"
          aria-label="Layer to read data from"
          bind:value={form.base}
          disabled={!naming}
        >
          {#each bases as base (base)}
            <option value={base}>{base}</option>
          {/each}
          {#if !bases.includes(form.base)}
            <option value={form.base}>{form.base}</option>
          {/if}
        </select>
      </label>
    </div>
    <p class="help">
      <Icon name="info" size={12} />
      <span>
        {#if naming}
          The name a capture records, and one layer of your Copernicus configuration whose
          satellite data this reads — its own colours are replaced by yours.
        {:else}
          Both are what everything already filed under this layer was rendered from, so neither
          changes.
        {/if}
      </span>
    </p>

    <div class="two">
      <label class="field">
        <span>Shown as</span>
        <input
          class="input"
          bind:value={form.label}
          maxlength="60"
          aria-label="Label"
          placeholder={form.id || 'SWIR plume'}
          title="What the layer picker calls it"
        />
      </label>
      <label class="field">
        <span>Note</span>
        <input
          class="input"
          bind:value={form.hint}
          maxlength="160"
          aria-label="Note"
          placeholder="Why you'd pick it"
          title="One clause under the name, for when you come back to it"
        />
      </label>
    </div>
  </section>

  <div class="actions">
    {#if onpreview}
      <button
        class="btn"
        disabled={busy || over || !script.trim()}
        onclick={() => onpreview({ base: form.base, script })}
        title="Draw this on the map, over the date already chosen. Nothing is saved"
      >
        <Icon name="eye" size={13} /> {busy ? 'Drawing…' : 'Preview on the map'}
      </button>
    {/if}
    <button
      class="btn primary"
      disabled={busy || !!problem}
      onclick={() => onsave(layerPayload(form, script))}
      title={problem || 'Keep this layer under its name'}
    >
      {form.editing ? 'Save changes' : 'Save layer'}
    </button>
    <button class="btn" onclick={oncancel} title="Close without keeping it">Cancel</button>
  </div>

  <!-- What just happened beats what is still missing: a preview needs no name,
       and Save already says why it is disabled. -->
  {#if note}
    <p class="hint" role="status">{note}</p>
  {:else if problem}
    <p class="hint" class:warn={!!form.id} role="status">{problem}</p>
  {:else}
    <p class="hint">Kept, it joins the layer picker in Satellite, Compare and Detect.</p>
  {/if}
</div>

<style>
  .layer-form { display: grid; gap: 12px; }

  .block {
    display: grid;
    gap: 9px;
    padding: 11px 12px 13px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .block-head { display: flex; align-items: baseline; gap: 10px; }
  .block-head h4 {
    margin: 0;
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .count { margin-left: auto; font-size: var(--fs-xs); color: var(--text-3); }
  .count.over { color: var(--warn); }

  .ways { display: flex; gap: 4px; flex-wrap: wrap; }
  .way {
    padding: 5px 11px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-1);
    color: var(--text-2);
    font-size: var(--fs-sm);
    cursor: pointer;
  }
  .way:hover { border-color: var(--text-3); color: var(--text-1); }
  .way.on {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: 600;
  }
  .why { margin: -3px 0 0; font-size: var(--fs-xs); color: var(--text-3); }

  .presets { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
  .presets-label { margin-right: 2px; font-size: var(--fs-xs); color: var(--text-3); }
  .chip {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--bg-1);
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .chip:hover { border-color: var(--accent); color: var(--accent); }

  .two, .three { display: grid; gap: 9px; }
  .two { grid-template-columns: 1fr 1fr; }
  .three { grid-template-columns: repeat(3, 1fr); }
  .field { display: grid; gap: 4px; min-width: 0; }
  .field > span { font-size: var(--fs-xs); color: var(--text-3); }
  .field .input { min-width: 0; }
  .narrow { max-width: 130px; }
  .chan { display: inline-flex; align-items: center; gap: 5px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  .dot.red { background: #e5484d; }
  .dot.green { background: #46a758; }
  .dot.blue { background: #3b82f6; }

  .row-label { display: flex; align-items: baseline; gap: 8px; }
  .readout { margin-left: auto; color: var(--text-2); }
  .slider { width: 100%; }

  .ramp { display: flex; align-items: center; gap: 7px; }
  .ramp-bar { flex: 1; height: 12px; border: 1px solid var(--border); border-radius: 3px; }
  .ramp-end { font-size: var(--fs-xs); color: var(--text-3); }

  .help {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: -2px 0 0;
    font-size: var(--fs-xs);
    line-height: 1.45;
    color: var(--text-3);
  }
  .help :global(svg) { flex: none; margin-top: 2px; opacity: 0.8; }

  /* `.mono` in app.css sizes itself at 0.92em of its *parent*, not of the input
     scale, so a code field and a mono input land a couple of points bigger than
     every control around them. Pinned back to the scale the form is written at. */
  .script,
  .field .input.mono { font-size: var(--fs-sm); }
  .script { resize: vertical; line-height: 1.5; white-space: pre; overflow-wrap: normal; }

  .actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .hint { margin: 0; font-size: var(--fs-xs); color: var(--text-3); }
  .hint.warn { color: var(--warn); }

  @media (max-width: 620px) {
    .two, .three { grid-template-columns: 1fr; }
  }
</style>
