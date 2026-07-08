<script>
  import { onMount } from 'svelte';
  import { api } from '../../lib/api.js';
  import { caseState, reloadCase, toast } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';

  // Non-destructive image adjustments. Controls are generated from the backend
  // filter registry (/api/inspect/ops) — adding a server-side filter surfaces a
  // slider here automatically. Live preview uses each filter's CSS hint; the
  // real render happens on "Export" so it stays reproducible (spec §6).
  let { source, shared, onProduced } = $props();

  const ORDER = ['brightness', 'contrast', 'saturation', 'gamma', 'sharpness', 'rotate', 'grayscale', 'invert'];

  let filters = $state([]);
  let values = $state({}); // filterId -> single param value
  let baking = $state(false);

  onMount(async () => {
    const ops = await api.get('/api/inspect/ops');
    filters = ops.filters
      .filter((f) => f.id !== 'crop')
      .sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    resetValues();
  });

  function resetValues() {
    const next = {};
    for (const f of filters) next[f.id] = f.params[0]?.default ?? 0;
    values = next;
    clearCrop();
  }

  function paramName(f) {
    return f.params[0]?.name ?? 'amount';
  }

  function isDefault(f) {
    return values[f.id] === (f.params[0]?.default ?? 0);
  }

  // live preview: CSS filter + transform strings pushed to the viewer
  $effect(() => {
    shared.filter = filters
      .filter((f) => f.css)
      .map((f) => f.css.replaceAll('{v}', values[f.id]))
      .join(' ');
    shared.transform = filters
      .filter((f) => f.transform)
      .map((f) => f.transform.replaceAll('{v}', values[f.id]))
      .join(' ');
  });

  function clearCrop() {
    shared.crop = null;
    shared.cropMode = false;
  }

  function toggleCrop() {
    shared.cropMode = !shared.cropMode;
  }

  function reset() {
    resetValues();
  }

  async function bake() {
    const ops = [];
    if (shared.crop) ops.push({ op: 'crop', params: shared.crop });
    for (const id of ORDER) {
      const f = filters.find((x) => x.id === id);
      if (!f || isDefault(f)) continue;
      ops.push({ op: id, params: { [paramName(f)]: values[id] } });
    }
    if (!ops.length) {
      toast('Nothing to apply — adjust a slider or set a crop first', 'info');
      return;
    }
    baking = true;
    try {
      const res = await api.post(`/api/cases/${caseState.current.id}/inspect/bake`, {
        path: source.path,
        ops,
      });
      await reloadCase();
      onProduced(res);
      toast(res.duplicate ? 'Identical image already in the case' : 'Edited image filed', res.duplicate ? 'warn' : 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      baking = false;
    }
  }
</script>

<div class="module">
  {#each filters as f (f.id)}
    <label class="row" class:toggle={f.params[0]?.type === 'toggle'}>
      <span class="lbl">
        {f.label}
        {#if !f.css && !f.transform}<span class="pill" title="No live preview — applied on export">export</span>{/if}
      </span>
      {#if f.params[0]?.type === 'toggle'}
        <input type="checkbox" checked={values[f.id] === 1} onchange={(e) => (values[f.id] = e.target.checked ? 1 : 0)} />
      {:else}
        <input
          type="range"
          min={f.params[0].min}
          max={f.params[0].max}
          step={f.params[0].step}
          bind:value={values[f.id]}
        />
        <span class="val mono">{Number(values[f.id]).toFixed(f.params[0].step < 1 ? 2 : 0)}{f.params[0].unit}</span>
      {/if}
    </label>
  {/each}

  <div class="crop-row">
    <button class="btn btn-sm" class:active={shared.cropMode} onclick={toggleCrop}>
      <Icon name="crop" size={14} /> {shared.cropMode ? 'Drag on image…' : 'Crop region'}
    </button>
    {#if shared.crop}
      <span class="crop-info mono">
        {Math.round(shared.crop.w * 100)}% × {Math.round(shared.crop.h * 100)}%
      </span>
      <button class="btn btn-ghost btn-xs" onclick={clearCrop} title="Clear crop"><Icon name="x" size={13} /></button>
    {/if}
  </div>

  <div class="actions">
    <button class="btn btn-ghost btn-sm" onclick={reset}><Icon name="reset" size={14} /> Reset</button>
    <button class="btn btn-primary" disabled={baking} onclick={bake}>
      <Icon name="save" size={15} /> Export as new image
    </button>
  </div>
</div>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 10px;
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
  .crop-row {
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px solid var(--border);
    padding-top: 12px;
  }
  .crop-info {
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .btn.active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .actions {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 4px;
  }
</style>
