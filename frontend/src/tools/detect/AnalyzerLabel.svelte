<script>
  /** How an analyzer's candidates are named and drawn. It never changes what is found. */
  let { recipe = $bindable(), readonly = false } = $props();
</script>

<details class="look">
  <summary>Label and colour</summary>
  <fieldset class="fields" disabled={readonly}>
    <label title="The label each candidate carries.">Candidate label
      <input bind:value={recipe.phenomenon} maxlength="120" />
    </label>
    <div class="row">
      <label class="grow">Colour<input type="color" bind:value={recipe.colour} /></label>
      <label class="grow">Layer style
        <select bind:value={recipe.style}>
          <option value="both">Pins and outlines</option><option value="pins">Pins</option><option value="outlines">Outlines with pins</option>
        </select>
      </label>
    </div>
  </fieldset>
</details>

<style>
  .fields { display: grid; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
  .look { display: grid; gap: 8px; }
  .look[open] { padding-top: 4px; }
  summary { color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
</style>
