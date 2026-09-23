<script>
  /**
   * How picky an analyzer is: the target size first, then the cloud switch,
   * then the thresholds behind a link. One component, so a detection tuned for
   * one run and an analyzer tuned for the library read the same numbers the
   * same way. What the method can do comes from the catalogue, never from its
   * name.
   */
  import CloudFilter from '../compare/CloudFilter.svelte';
  import { sizeBand, sizeOf } from '../../lib/map/analyzers.js';

  const SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['all', 'All']];
  const INDICES = [
    ['ndvi', 'NDVI · vegetation'], ['nbr', 'NBR · burn scars'], ['mndwi', 'MNDWI · open water'],
    ['ndwi', 'NDWI · open water'], ['bsi', 'BSI · bare soil'], ['ndbi', 'NDBI · built-up'],
  ];

  let {
    recipe = $bindable(),
    capability = {},
    /** Thresholds shown outright rather than behind a link. */
    expanded = false,
    readonly = false,
  } = $props();

  let showThresholds = $state(false);
  const open = $derived(expanded || showThresholds);
  const single = $derived(!!capability.single);
  const size = $derived(sizeOf(recipe.parameters, capability.sizes));

  function setSize(name) {
    if (readonly || !capability.sizes?.[name]) return;
    recipe.parameters = { ...recipe.parameters, ...capability.sizes[name] };
  }

  function setWeather(on) {
    if (readonly) return;
    recipe.parameters = { ...recipe.parameters, ignore_clouds: on, ignore_shadows: on };
  }
</script>

<fieldset class="settings" disabled={readonly}>
  {#if capability.sizes}
    <div class="cmp-seg fill" role="group" aria-label="Target size">
      {#each SIZES as [name, label] (name)}
        {#if capability.sizes[name]}
          <button type="button" class:on={size === name} aria-pressed={size === name}
            title={sizeBand(capability.sizes[name])} onclick={() => setSize(name)}>{label}</button>
        {/if}
      {/each}
    </div>
    <p class="hint">{size ? sizeBand(capability.sizes[size]) : 'Sizes are set by hand below.'}</p>
  {/if}
  {#if capability.clouds}
    <CloudFilter clouds={recipe.parameters.ignore_clouds} shadows={recipe.parameters.ignore_shadows}
      ontoggle={setWeather} />
  {/if}
  {#if !expanded}
    <button type="button" class="link" onclick={() => (showThresholds = !showThresholds)} aria-expanded={showThresholds}>
      {showThresholds ? 'Hide thresholds' : 'Adjust thresholds…'}
    </button>
  {/if}
  {#if open}
    <label title="Higher finds fainter signals, and more noise with them.">Sensitivity · {recipe.parameters.sensitivity}
      <input aria-label="Analyzer sensitivity" type="range" min="0" max="100" bind:value={recipe.parameters.sensitivity} />
    </label>
    <div class="row">
      <label class="grow" title="Drop candidates smaller than this.">Min area (m²)
        <input aria-label="Minimum area" type="number" min="0" max="100000000" bind:value={recipe.parameters.min_area} />
      </label>
      <label class="grow" title="Drop candidates larger than this; 0 keeps them all.">Max area (m²)
        <input aria-label="Maximum area" type="number" min="0" max="100000000" bind:value={recipe.parameters.max_area} />
      </label>
    </div>
    {#if recipe.method === 'index'}
      <label>Index
        <select aria-label="Spectral index" bind:value={recipe.parameters.index}>
          {#each INDICES as [id, label] (id)}<option value={id}>{label}</option>{/each}
        </select>
      </label>
    {/if}
    {#if !single}
      <label title="Keep what brightened, what darkened, or both.">Direction
        <select bind:value={recipe.parameters.direction}><option value="both">Both</option><option value="gain">Gain</option><option value="loss">Loss</option></select>
      </label>
    {/if}
    {#if capability.clouds}
      <label class="check"><input type="checkbox" bind:checked={recipe.parameters.ignore_clouds} /> Exclude cloud and snow</label>
      <label class="check"><input type="checkbox" bind:checked={recipe.parameters.ignore_shadows} /> Exclude cloud shadow</label>
      <label title="Grow the mask past the edge the classification drew.">Mask margin · {recipe.parameters.cloud_margin}px
        <input aria-label="Cloud mask margin" type="range" min="0" max="10" bind:value={recipe.parameters.cloud_margin} />
      </label>
    {/if}
    <details>
      <summary>Noise and grouping</summary>
      <label title="Remove specks narrower than this; it also removes small real objects.">Noise cleanup · {recipe.parameters.cleanup}px<input type="range" min="0" max="3" bind:value={recipe.parameters.cleanup} /></label>
      <label title="Blur the reading first; zero keeps the finest detail.">Smoothing · {recipe.parameters.smoothing}px<input type="range" min="0" max="3" bind:value={recipe.parameters.smoothing} /></label>
      <label title="Join candidates this close; zero joins only touching ones.">Group within (m)<input type="number" min="0" max="500" bind:value={recipe.parameters.merge_metres} /></label>
    </details>
  {/if}
</fieldset>

<style>
  .settings {
    display: grid;
    gap: 8px;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  details { display: grid; gap: 8px; }
  details[open] { padding-top: 4px; }
  summary { color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .link { justify-self: start; color: var(--accent); font-size: var(--fs-xs); text-align: left; }
</style>
