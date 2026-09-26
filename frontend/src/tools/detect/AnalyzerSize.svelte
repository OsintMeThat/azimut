<script>
  /**
   * Small, Medium, Large or All: the floor and ceiling on a candidate's area,
   * with the cleanup and grouping that go with them. The band a size keeps is
   * said under the buttons, which read as sensitivity and are not. One
   * component, so the wizard can ask it first and the library beside the
   * thresholds, and both apply the same numbers.
   */
  import { sizeBand, sizeOf } from '../../lib/map/analyzers.js';

  const SIZES = [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['all', 'All']];

  let {
    recipe = $bindable(),
    capability = {},
    readonly = false,
    /** Told which size was pressed, so a caller can carry it to the next analyzer. */
    onpick = () => {},
  } = $props();

  const size = $derived(sizeOf(recipe.parameters, capability.sizes));

  function setSize(name) {
    if (readonly || !capability.sizes?.[name]) return;
    recipe.parameters = { ...recipe.parameters, ...capability.sizes[name] };
    onpick(name);
  }
</script>

{#if capability.sizes}
  <div class="cmp-seg fill" role="group" aria-label="Target size">
    {#each SIZES as [name, label] (name)}
      {#if capability.sizes[name]}
        <button type="button" class:on={size === name} aria-pressed={size === name} disabled={readonly}
          title={sizeBand(capability.sizes[name])} onclick={() => setSize(name)}>{label}</button>
      {/if}
    {/each}
  </div>
  <p class="hint">{size ? sizeBand(capability.sizes[size]) : 'Sizes are set by hand below.'}</p>
{/if}
