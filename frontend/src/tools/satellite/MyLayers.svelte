<script>
  import Icon from '../../components/Icon.svelte';

  let { rows = [], controller, onnew, onedit, onstart, ontoggle, ondone, onfly } = $props();
  const personal = $derived(rows.filter((row) => row.editable));
  const selected = $derived(controller.selected);
  let changes = $state({ name: '', description: '', colour: '#0072b2', symbol: 'pin' });
  const SYMBOLS = [['pin', 'Pin'], ['circle', 'Circle'], ['star', 'Star'], ['flag', 'Flag']];
  const COLOURS = [['#0072b2', 'Blue'], ['#d55e00', 'Orange'], ['#009e73', 'Green'], ['#cc79a7', 'Purple'], ['#f0e442', 'Yellow']];

  $effect(() => {
    const props = selected?.properties;
    if (!props) return;
    changes = { name: props.name ?? '', description: props.description ?? '',
      colour: props.colour || '#0072b2', symbol: props.symbol || 'pin' };
  });

  function saveSelected() {
    const before = selected?.properties;
    if (!before) return;
    const patch = Object.fromEntries(Object.entries(changes).filter(([key, value]) =>
      value !== (before[key] ?? (key === 'symbol' ? 'pin' : key === 'colour' ? '#0072b2' : ''))));
    if (Object.keys(patch).length) controller.update(before.key, patch);
  }
</script>

{#snippet fields(value, prefix)}
  <label class="field">
    <span>Name</span>
    <input type="text" aria-label={`${prefix} name`} bind:value={value.name} maxlength="300" placeholder="Automatic name" />
  </label>
  <div class="style-row">
    <label class="field symbol">
      <span>Symbol</span>
      <select aria-label={`${prefix} symbol`} bind:value={value.symbol}>
        {#each SYMBOLS as [id, label]}<option value={id}>{label}</option>{/each}
      </select>
    </label>
    <label class="field">
      <span>Colour</span>
      <input type="color" aria-label={`${prefix} colour`} bind:value={value.colour} />
    </label>
  </div>
  <div class="palette" role="group" aria-label={`${prefix} palette`}>
    {#each COLOURS as [colour, label]}
      <button type="button" class="swatch" class:chosen={value.colour === colour}
        style={`--swatch:${colour}`} aria-label={`${prefix} ${label.toLowerCase()}`} title={label}
        aria-pressed={value.colour === colour} onclick={() => (value.colour = colour)}></button>
    {/each}
  </div>
{/snippet}

<section class="my-layers" aria-label="My layers">
  {#if controller.editor}
    <header class="editor-head">
      <strong>{controller.editor.title}</strong>
      <button class="btn btn-ghost btn-xs" onclick={ondone}>Done</button>
    </header>
    {#if controller.editor.origin}
      <p class="note">Copy of {controller.editor.origin.source.name || controller.editor.origin.source.url}</p>
    {/if}
    {#if controller.loading}
      <p class="note">Opening layer…</p>
    {:else}
      <button type="button" class="btn btn-sm add-markers" class:chosen={controller.placing}
        aria-pressed={controller.placing} onclick={() => controller.placing ? controller.stop() : onstart()}>
        <Icon name="pin" size={13} /> {controller.placing ? 'Stop adding' : 'Add markers'}
      </button>
      {#if controller.placing}
        <p class="note">Click the map to add markers. Esc to stop.</p>
        {@render fields(controller.draft, 'New marker')}
      {/if}
      <p class="note">Markers stay in this layer until saved as case places.</p>
      {#if controller.pending}<p class="saving" role="status">Saving {controller.pending}…</p>{/if}
      {#if selected}
        <div class="selection">
          <strong>{selected.properties.name || 'Unnamed feature'}</strong>
          {@render fields(changes, 'Selected marker')}
          <label class="field">
            <span>Note</span>
            <textarea aria-label="Selected marker note" bind:value={changes.description} maxlength="4000" rows="2"></textarea>
          </label>
          <button class="btn btn-sm" disabled={controller.pending > 0} onclick={saveSelected}>Save changes</button>
          {#if selected.geometry.type === 'Point'}
            <button class="btn btn-sm" disabled={controller.pending > 0 || !!selected.properties.place_id}
              onclick={() => controller.promote(selected.properties.key)}>
              {selected.properties.place_id ? 'Saved as case place' : 'Save as case place'}
            </button>
          {/if}
        </div>
      {/if}
      <p class="tally">{controller.features.length} {controller.features.length === 1 ? 'feature' : 'features'}</p>
      <ul class="features">
        {#each controller.features.slice(-100).toReversed() as feature (feature.properties.key)}
          <li>
            <button class:active={selected?.properties.key === feature.properties.key}
              onclick={() => { controller.select(feature.properties.key); onfly?.(feature); }}>
              <Icon name={feature.properties.symbol || (feature.geometry.type === 'Point' ? 'pin' : 'polygon')} size={13} />
              <span>{feature.properties.name || 'Unnamed feature'}</span>
              {#if feature.properties.place_id}<Icon name="link" size={11} />{/if}
            </button>
          </li>
        {/each}
      </ul>
      {#if controller.features.length > 100}<p class="note">Showing the last 100. Every feature is drawn on the map.</p>{/if}
    {/if}
  {:else}
    <header class="list-head"><Icon name="stack" size={13} /><strong>My layers</strong></header>
    <ul class="personal">
      {#each personal as row (row.name)}
        <li>
          <button type="button" class="eye" class:on={row.enabled} aria-label={`Show ${row.title}`}
            aria-pressed={row.enabled} onclick={() => ontoggle(row)}><Icon name="eye" size={13} /></button>
          <span>{row.title}</span>
          <button class="btn btn-ghost btn-xs" aria-label={`Edit ${row.title}`} onclick={() => onedit(row)}>Edit</button>
        </li>
      {/each}
    </ul>
    {#if !personal.length}<p class="note">No personal layers yet.</p>{/if}
    <button class="btn btn-sm" onclick={onnew}><Icon name="plus" size={13} /> New layer</button>
  {/if}
</section>

<style>
  .my-layers { margin: 10px 0; padding: 10px 4px; border-top: 1px solid var(--border); }
  .editor-head, .list-head, .style-row, .palette { display: flex; align-items: center; gap: 8px; }
  .editor-head strong { flex: 1; overflow-wrap: anywhere; }
  strong { font-size: var(--fs-sm); }
  .note, .tally, .saving { margin: 7px 0; font-size: var(--fs-xs); color: var(--text-3); }
  .saving { color: var(--accent); }
  .field { display: grid; gap: 4px; margin-top: 9px; min-width: 0; }
  .field span { font-size: var(--fs-xs); color: var(--text-3); }
  .field input, .field select, .field textarea { width: 100%; min-width: 0; }
  .symbol { flex: 1; }
  input[type='color'] { width: 42px; height: 30px; padding: 2px; }
  .palette { margin: 8px 0; }
  .swatch { width: 20px; height: 20px; border-radius: 50%; background: var(--swatch); border: 2px solid transparent; cursor: pointer; }
  .swatch.chosen { outline: 1px solid var(--text-1); outline-offset: 2px; }
  .chosen { border-color: var(--accent); color: var(--accent); }
  .add-markers { margin-top: 8px; }
  .selection { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--border); }
  .selection > button { margin: 8px 4px 0 0; }
  ul { padding: 0; margin: 8px 0; list-style: none; }
  .personal li { display: flex; align-items: center; gap: 7px; margin-bottom: 5px; }
  .personal li > span { flex: 1; overflow-wrap: anywhere; font-size: var(--fs-sm); }
  .eye { color: var(--text-3); cursor: pointer; }
  .eye.on { color: var(--accent); }
  .features li button { display: flex; align-items: center; gap: 7px; width: 100%; padding: 6px 3px; text-align: left; color: var(--text-2); cursor: pointer; }
  .features li button span { flex: 1; overflow-wrap: anywhere; font-size: var(--fs-xs); }
  .features li button.active { color: var(--accent); background: var(--bg-3); }
</style>
