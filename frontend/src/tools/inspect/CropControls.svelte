<script>
  import { clampCrop } from '../../lib/inspect.js';

  // Precise controls for an editable crop: aspect-ratio lock (presets) plus
  // numeric entry. Operates on a bindable fractional crop + bindable aspect
  // (pixel w/h, null = free). When natural pixel dims are known the numeric
  // fields are pixels, otherwise percentages. Pairs with CropBox.
  let {
    crop = $bindable(null),
    aspect = $bindable(null),
    natW = null,
    natH = null,
    onclear = null,
  } = $props();

  const nat = $derived(!!(natW && natH));
  const fracAspect = $derived(aspect ? (nat ? aspect * (natH / natW) : aspect) : null);

  const PRESETS = [
    { label: 'Free', a: null },
    { label: '1:1', a: 1 },
    { label: '4:3', a: 4 / 3 },
    { label: '3:2', a: 3 / 2 },
    { label: '16:9', a: 16 / 9 },
    { label: '5:4', a: 5 / 4 },
    { label: '4:5', a: 4 / 5 },
    { label: '9:16', a: 9 / 16 },
  ];

  // Re-fit the current crop to a newly picked aspect, keeping its centre.
  function fitAspect(fa) {
    if (!crop || !fa) return;
    const cx = crop.x + crop.w / 2;
    const cy = crop.y + crop.h / 2;
    let w = crop.w;
    let h = w / fa;
    if (h > 1) { h = 1; w = h * fa; }
    if (w > 1) { w = 1; h = w / fa; }
    crop = clampCrop({ x: cx - w / 2, y: cy - h / 2, w, h });
  }

  function pickAspect(a) {
    aspect = a;
    if (a) fitAspect(nat ? a * (natH / natW) : a);
  }

  const originalAspect = $derived(nat ? natW / natH : null);

  // px (or %) → fraction, applied to one field with the aspect lock honoured.
  function setField(field, raw) {
    if (!crop) return;
    const val = Number(raw);
    if (!Number.isFinite(val)) return;
    const denom = field === 'w' || field === 'x' ? (nat ? natW : 100) : (nat ? natH : 100);
    const f = val / denom;
    const c = { ...crop, [field]: f };
    if (fracAspect && field === 'w') c.h = c.w / fracAspect;
    if (fracAspect && field === 'h') c.w = c.h * fracAspect;
    crop = clampCrop(c);
  }

  const disp = (f, denom) => (crop ? Math.round(f * (nat ? denom : 100)) : 0);
</script>

<div class="crop-controls">
  <div class="chips">
    {#each PRESETS as p (p.label)}
      <button
        class="chip"
        class:on={aspect === p.a}
        onclick={() => pickAspect(p.a)}
        disabled={!crop && p.a != null}
        title={`Lock ${p.label}`}
      >{p.label}</button>
    {/each}
    {#if originalAspect}
      <button
        class="chip"
        class:on={aspect === originalAspect}
        onclick={() => pickAspect(originalAspect)}
        disabled={!crop}
        title="Lock the source aspect ratio"
      >Orig</button>
    {/if}
  </div>

  {#if crop}
    <div class="fields">
      <label>W<input type="number" min="1" value={disp(crop.w, natW)} onchange={(e) => setField('w', e.target.value)} /></label>
      <label>H<input type="number" min="1" value={disp(crop.h, natH)} onchange={(e) => setField('h', e.target.value)} /></label>
      <label>X<input type="number" min="0" value={disp(crop.x, natW)} onchange={(e) => setField('x', e.target.value)} /></label>
      <label>Y<input type="number" min="0" value={disp(crop.y, natH)} onchange={(e) => setField('y', e.target.value)} /></label>
      <span class="unit">{nat ? 'px' : '%'}</span>
      {#if onclear}
        <button class="chip clear" onclick={onclear} title="Remove the crop">Clear</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .crop-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-1);
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .chip:hover:not(:disabled) {
    border-color: var(--accent);
  }
  .chip.on {
    border-color: var(--accent);
    color: var(--accent);
    background: var(--accent-soft);
  }
  .chip:disabled {
    opacity: 0.4;
  }
  .chip.clear {
    margin-left: auto;
    color: var(--danger, #d86a6a);
  }
  .fields {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }
  .fields label {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .fields input {
    width: 56px;
    padding: 3px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-0);
    color: var(--text-1);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
  .unit {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
