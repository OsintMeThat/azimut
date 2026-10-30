<script>
  /**
   * The Layers menu of Horizon's maps, the small one and Find's: the base map
   * picked first, then every layer the other maps offer, under the button that
   * opened it at the map's top right.
   */
  import LayerList from '../../components/LayerList.svelte';

  let {
    id,
    /** The base maps offered, `{ id, label, title }`. */
    bases = [],
    providerId = $bindable(),
    /** What `LayerList` takes, handed on as it is. */
    rows = [],
    added = [],
    ontoggleadded = () => {},
    onmanage = null,
    oneditadded = null,
    onnewpersonal = null,
    ondownloadadded = null,
    folded = $bindable({}),
  } = $props();
</script>

<div class="hz-layers" {id} role="dialog" aria-label="Base map and layers">
  <div class="hz-bases" role="group" aria-label="Base map">
    {#each bases as base (base.id)}
      <button
        type="button"
        class:on={providerId === base.id}
        aria-pressed={providerId === base.id}
        title={base.title}
        onclick={() => (providerId = base.id)}>{base.label}</button
      >
    {/each}
  </div>
  <LayerList {rows} {added} {ontoggleadded} {onmanage} {oneditadded} {onnewpersonal} {ondownloadadded} bind:folded />
</div>

<style>
  .hz-layers {
    position: absolute;
    top: 42px;
    right: 8px;
    z-index: 701;
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 260px;
    max-height: calc(100% - 50px);
    overflow-y: auto;
    padding: 10px;
    border-radius: var(--r-md);
    background: var(--bg-1);
    box-shadow:
      0 0 0 1px var(--border),
      0 8px 24px rgba(0, 0, 0, 0.35);
    font-size: var(--fs-xs);
  }
  .hz-bases {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: var(--r-md);
    background: var(--bg-0);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .hz-bases button {
    flex: 1;
    min-height: 24px;
    padding: 0 6px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .hz-bases button:hover {
    color: var(--text-1);
  }
  .hz-bases button.on {
    color: var(--accent);
    background: var(--accent-soft);
  }
</style>
