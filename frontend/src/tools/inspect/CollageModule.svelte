<script>
  import { api } from '../../lib/api.js';
  import { caseState, reloadCase, toast } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';

  // Assemble several case images (frames, crops, photos) into one contact-sheet.
  let { mediaList, onProduced } = $props();

  let picked = $state([]); // ordered list of paths
  let columns = $state(2);
  let cell = $state(400);
  let gap = $state(8);
  let building = $state(false);

  const images = $derived((mediaList ?? []).filter((m) => m.kind === 'image'));

  function toggle(path) {
    const i = picked.indexOf(path);
    if (i === -1) picked.push(path);
    else picked.splice(i, 1);
  }

  function orderOf(path) {
    const i = picked.indexOf(path);
    return i === -1 ? null : i + 1;
  }

  async function build() {
    if (picked.length < 1) return;
    building = true;
    try {
      const res = await api.post(`/api/cases/${caseState.current.id}/inspect/collage`, {
        paths: [...picked],
        columns,
        cell,
        gap,
      });
      await reloadCase();
      onProduced(res);
      picked = [];
      toast('Collage filed to the case', 'ok');
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      building = false;
    }
  }
</script>

<div class="module">
  <p class="hint">Pick images in the order you want them; they tile left-to-right.</p>

  <div class="grid">
    {#each images as m (m.path)}
      <button class="tile" class:sel={orderOf(m.path)} onclick={() => toggle(m.path)} title={m.filename}>
        <img src={`/files/${caseState.current.id}/${m.thumbnail ?? m.path}`} alt={m.filename} />
        {#if orderOf(m.path)}<span class="badge">{orderOf(m.path)}</span>{/if}
      </button>
    {/each}
  </div>

  {#if images.length === 0}
    <p class="empty">No images yet — capture frames or add media first.</p>
  {/if}

  <div class="controls">
    <label>Cols <input type="number" min="1" max="8" bind:value={columns} /></label>
    <label>Cell <input type="number" min="64" max="1024" step="20" bind:value={cell} /></label>
    <label>Gap <input type="number" min="0" max="64" bind:value={gap} /></label>
  </div>

  <button class="btn btn-primary w-full" disabled={building || picked.length < 1} onclick={build}>
    <Icon name="layers" size={15} /> Build collage ({picked.length})
  </button>
</div>

<style>
  .module {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .hint,
  .empty {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    max-height: 320px;
    overflow: auto;
  }
  .tile {
    position: relative;
    aspect-ratio: 1;
    border-radius: var(--r-sm);
    overflow: hidden;
    border: 2px solid transparent;
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .tile.sel {
    border-color: var(--accent);
  }
  .badge {
    position: absolute;
    top: 3px;
    left: 3px;
    background: var(--accent);
    color: #10141c;
    font-size: 11px;
    font-weight: 700;
    border-radius: 50%;
    width: 18px;
    height: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .controls {
    display: flex;
    gap: 8px;
  }
  .controls label {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    flex: 1;
  }
  .controls input {
    width: 100%;
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    padding: 4px 6px;
    color: var(--text-1);
    font-size: var(--fs-sm);
  }
  .w-full {
    width: 100%;
    justify-content: center;
  }
</style>
