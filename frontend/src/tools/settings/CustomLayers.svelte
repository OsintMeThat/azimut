<script>
  /**
   * Copernicus layers written here, inside the Copernicus card.
   *
   * Settings keeps the list: renaming, re-reading and removing are things you
   * do without looking at a scene. Writing one is not — a script is judged on
   * pixels — so the map's own picker has the same form with a Preview, and both
   * read `lib/customLayers.js`.
   *
   * Visible without a key and marked, rather than hidden: a layer you cannot
   * render yet is still worth knowing you could write.
   */
  import { api } from '../../lib/api.js';
  import { toast } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';
  import CustomLayerForm from '../../components/CustomLayerForm.svelte';
  import {
    dataSources,
    deleteCustomLayer,
    readCustomLayers,
    saveCustomLayer,
    startForm,
  } from '../../lib/customLayers.js';

  let { keyed = false } = $props();

  let layers = $state([]);
  let max = $state(40);
  let scriptMax = $state(4000);
  let bands = $state([]);
  let radarLayer = $state('');
  let configured = $state([]); // the layers the instance serves, as bases
  let open = $state(false);
  let held = $state(null); // the draft, which the form reads and mutates
  let busy = $state(false);
  let loaded = false;

  // Reading the list is a local file, not a request to Copernicus, so it costs
  // nothing — but it still waits for the card to be worth reading.
  $effect(() => {
    if (loaded) return;
    loaded = true;
    void load();
  });

  async function load() {
    try {
      const found = await readCustomLayers(api);
      layers = found.layers;
      max = found.max;
      scriptMax = found.scriptMax;
      bands = found.bands;
      radarLayer = found.radarLayer;
      // Settings never asks the instance for its layers (that is a request, on
      // the analyst's own press, in the tools). So the bases on offer are the
      // ones already in use plus the layer every configuration is built on.
      configured = [...new Set(['TRUE_COLOR', ...found.layers.map((row) => row.base)])];
    } catch (error) {
      toast(`Could not read your layers: ${error.message}`, 'danger');
    }
  }

  const full = $derived(layers.length >= max);

  function write(ident) {
    held = startForm({
      layer: ident ? layers.find((row) => row.id === ident) ?? null : null,
      bases: dataSources(configured.map((id) => ({ id })), radarLayer),
      bands,
      radarLayer,
    });
    open = true;
  }

  async function save(draft) {
    busy = true;
    try {
      await saveCustomLayer(api, draft);
      await load();
      open = false;
      held = null;
      toast(`${draft.id} saved`, 'ok');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = false;
    }
  }

  async function remove(ident) {
    busy = true;
    try {
      await deleteCustomLayer(api, ident);
      await load();
      toast(`${ident} removed`, 'ok');
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = false;
    }
  }
</script>

<section class="custom-layers" class:locked={!keyed}>
  <header>
    <span class="title">
      <Icon name="layers" size={13} /> Your own layers
      {#if layers.length}<span class="count">{layers.length}/{max}</span>{/if}
    </span>
    {#if !open}
      <button
        class="btn btn-sm"
        disabled={busy || full}
        onclick={() => write('')}
        title={full ? `You can keep ${max} layers; remove one first` : 'Write a layer here'}
      >
        <Icon name="plus" size={12} /> Write one
      </button>
    {/if}
  </header>

  <p class="lead">
    A composite or an index of your own, written here instead of in the Copernicus dashboard.
    {#if !keyed}Save your Sentinel Hub key above to render one.{/if}
  </p>

  {#if open}
    <CustomLayerForm
      form={held}
      bases={dataSources(configured.map((id) => ({ id })), radarLayer)}
      {bands}
      taken={layers.filter((row) => row.id !== held.editing).map((row) => row.id)}
      {scriptMax}
      {busy}
      onsave={save}
      oncancel={() => {
        open = false;
        held = null;
      }}
      note="A script is judged on pixels: the layer picker on the map has this same form with a Preview."
    />
  {:else if layers.length}
    <ul class="rows">
      {#each layers as row (row.id)}
        <li>
          <span class="names">
            <strong class="mono">{row.id}</strong>
            <small>{row.hint || row.label}</small>
            <small class="through mono">reads {row.base}</small>
          </span>
          <span class="row-actions">
            <button class="btn btn-sm" disabled={busy} onclick={() => write(row.id)}>Edit</button>
            <button
              class="btn btn-sm danger"
              disabled={busy}
              onclick={() => remove(row.id)}
              title="Work already saved keeps this name in its provenance, and it stops rendering"
            >
              Remove
            </button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .custom-layers {
    display: grid;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .custom-layers.locked { opacity: 0.62; }
  header { display: flex; align-items: center; gap: 8px; }
  .title { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: var(--fs-sm); }
  .count { font-size: var(--fs-xs); color: var(--text-3); font-weight: 400; }
  header > .btn { margin-left: auto; }
  .lead { margin: 0; font-size: var(--fs-xs); color: var(--text-3); }
  .rows { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .rows > li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 7px 9px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-1);
  }
  .names { display: grid; gap: 1px; min-width: 0; }
  /* `.mono` sizes against its parent, so a layer name outgrows its own row. */
  .names > .mono { font-size: var(--fs-sm); }
  .names > small { font-size: var(--fs-xs); color: var(--text-3); }
  .through { color: var(--text-3); opacity: 0.8; }
  .row-actions { display: flex; gap: 6px; margin-left: auto; }
</style>
