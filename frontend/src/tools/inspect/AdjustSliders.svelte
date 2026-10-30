<script>
  import { FILTER_HELP } from '../../lib/inspectHelp.js';

  // Slider bank generated from the backend filter registry (/api/inspect/ops).
  // Writes live into `values` (a reactive object owned by the work), so the
  // caller can build both the live preview and the backend op pipeline.
  //
  // `rendered` says the caller shows the picture as the server renders it, so every
  // filter previews; otherwise a filter with no CSS twin is marked as applied on save.
  let { filters, values, rendered = false } = $props();

  const kind = (f) => f.params[0]?.type ?? 'range';
</script>

<div class="sliders">
  {#each filters as f (f.id)}
    {@const p = f.params[0]}
    {#if kind(f) === 'choice'}
      <div class="row choice" title={FILTER_HELP[f.id]}>
        <span class="lbl">{f.label}</span>
        <div class="seg" role="radiogroup" aria-label={f.label}>
          {#each p.options ?? [] as o (o.value)}
            <button
              class="seg-btn"
              class:on={values[f.id] === o.value}
              role="radio"
              aria-checked={values[f.id] === o.value}
              onclick={() => (values[f.id] = o.value)}
            >{o.label}</button>
          {/each}
        </div>
      </div>
    {:else}
      <label class="row" class:toggle={kind(f) === 'toggle'} title={FILTER_HELP[f.id]}>
        <span class="lbl">
          {f.label}
          {#if !rendered && !f.css && !f.transform}<span class="pill" title="Applied on save">save</span>{/if}
        </span>
        {#if kind(f) === 'toggle'}
          <input
            type="checkbox"
            checked={values[f.id] === 1}
            onchange={(e) => (values[f.id] = e.target.checked ? 1 : 0)}
          />
        {:else}
          <input type="range" min={p.min} max={p.max} step={p.step} bind:value={values[f.id]} />
          <span class="val mono">
            {Number(values[f.id]).toFixed(p.step < 1 ? (p.step < 0.1 ? 2 : 1) : 0)}{p.unit}
          </span>
        {/if}
      </label>
    {/if}
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
    grid-template-columns: 96px 1fr 42px;
    align-items: center;
    gap: 8px;
    font-size: var(--fs-sm);
  }
  .row.toggle {
    grid-template-columns: 1fr auto;
  }
  .row.choice {
    grid-template-columns: 96px 1fr;
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
  .seg {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .seg-btn {
    padding: 3px 0;
    font-size: var(--fs-xs);
    color: var(--text-2);
    background: none;
  }
  .seg-btn + .seg-btn {
    border-left: 1px solid var(--border);
  }
  .seg-btn.on {
    background: var(--accent);
    color: var(--accent-text);
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
