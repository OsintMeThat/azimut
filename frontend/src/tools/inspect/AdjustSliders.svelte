<script>
  // Slider bank generated from the backend filter registry (/api/inspect/ops).
  // Writes live into `values` (a reactive object owned by the work), so the
  // caller can build both the CSS live-preview and the backend op pipeline.
  let { filters, values } = $props();
</script>

<div class="sliders">
  {#each filters as f (f.id)}
    <label class="row" class:toggle={f.params[0]?.type === 'toggle'}>
      <span class="lbl">
        {f.label}
        {#if !f.css && !f.transform}<span class="pill" title="Applied on save">save</span>{/if}
      </span>
      {#if f.params[0]?.type === 'toggle'}
        <input
          type="checkbox"
          checked={values[f.id] === 1}
          onchange={(e) => (values[f.id] = e.target.checked ? 1 : 0)}
        />
      {:else}
        <input
          type="range"
          min={f.params[0].min}
          max={f.params[0].max}
          step={f.params[0].step}
          bind:value={values[f.id]}
        />
        <span class="val mono">
          {Number(values[f.id]).toFixed(f.params[0].step < 1 ? 2 : 0)}{f.params[0].unit}
        </span>
      {/if}
    </label>
  {/each}
</div>

<style>
  .sliders {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .row {
    display: grid;
    grid-template-columns: 90px 1fr 42px;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-sm);
  }
  .row.toggle {
    grid-template-columns: 1fr auto;
  }
  .lbl {
    color: var(--text-2);
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .pill {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 4px;
    border-radius: 4px;
    background: var(--bg-2);
    color: var(--text-3);
  }
  input[type='range'] {
    width: 100%;
    accent-color: var(--accent);
  }
  input[type='checkbox'] {
    accent-color: var(--accent);
    width: 15px;
    height: 15px;
  }
  .val {
    text-align: right;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
</style>
