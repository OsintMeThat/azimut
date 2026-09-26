<script>
  /**
   * How picky an analyzer is: the target size first, then the cloud switch,
   * then the thresholds behind a link. One component, so a detection tuned for
   * one run and an analyzer tuned for the library read the same numbers the
   * same way. What the method can do comes from the catalogue, never from its
   * name.
   */
  import CloudFilter from '../compare/CloudFilter.svelte';
  import AnalyzerSize from './AnalyzerSize.svelte';

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
    /** The wizard asks for the size first, above the analyzers, and not here. */
    showSize = true,
  } = $props();

  let showThresholds = $state(false);
  const open = $derived(expanded || showThresholds);
  const single = $derived(!!capability.single);
  /** An analyzer of your own sets its lines rule by rule, so it has no
   *  sensitivity or direction here, and it cleans and smooths on one date too. */
  const rules = $derived(recipe.method === 'rules');
  const SHAPES = [['any', 'Any shape'], ['compact', 'Compact: roofs, craters, vehicles'], ['elongated', 'Long and thin: roads, tracks, trenches']];

  function setWeather(on) {
    if (readonly) return;
    recipe.parameters = { ...recipe.parameters, ignore_clouds: on, ignore_shadows: on };
  }
</script>

<fieldset class="settings" disabled={readonly}>
  {#if showSize}<AnalyzerSize bind:recipe {capability} {readonly} />{/if}
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
    {#if !rules}
      <label title="Higher finds fainter signals, and more noise with them.">Sensitivity · {recipe.parameters.sensitivity}
        <input aria-label="Analyzer sensitivity" type="range" min="0" max="100" bind:value={recipe.parameters.sensitivity} />
      </label>
    {/if}
    <div class="row">
      <label class="grow" title="Drop candidates smaller than this.">Min area (m²)
        <input aria-label="Minimum area" type="number" min="0" max="100000000" bind:value={recipe.parameters.min_area} />
      </label>
      <label class="grow" title="Drop candidates larger than this, or none at 0.">Max area (m²)
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
    <label title="Keep only candidates of this shape.">Shape
      <select aria-label="Candidate shape" value={recipe.parameters.shape ?? 'any'}
        onchange={(event) => (recipe.parameters = { ...recipe.parameters, shape: event.currentTarget.value })}>
        {#each SHAPES as [id, label] (id)}<option value={id}>{label}</option>{/each}
      </select>
    </label>
    {#if !single && !rules}
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
    <!-- Cleanup and smoothing work on a difference, so a built-in that reads
         one image has neither; rules of your own clean and smooth whatever they
         read. Radar counts its smoothing on the ground. -->
    <details>
      <summary>{single && !rules ? 'Grouping' : 'Noise and grouping'}</summary>
      {#if !single || rules}
        <label title="Remove specks narrower than this, real ones included.">Noise cleanup · {recipe.parameters.cleanup}px<input type="range" min="0" max="3" bind:value={recipe.parameters.cleanup} /></label>
        {#if capability.smoothing_m}
          <label title="Average the radar over this ground to quiet its speckle.">Averaging · {capability.smoothing_m * Math.max(1, recipe.parameters.smoothing)} m<input aria-label="Radar averaging" type="range" min="1" max="3" bind:value={recipe.parameters.smoothing} /></label>
        {:else}
          <label title="Blur the reading first, or not at all at zero.">Smoothing · {recipe.parameters.smoothing}px<input type="range" min="0" max="3" bind:value={recipe.parameters.smoothing} /></label>
        {/if}
      {/if}
      <label title="Join candidates this close, only touching ones at zero.">Group within (m)<input type="number" min="0" max="500" bind:value={recipe.parameters.merge_metres} /></label>
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
