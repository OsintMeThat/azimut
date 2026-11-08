<script>
  /**
   * What the symbol button opens: every icon a proof can stamp, grouped, with the
   * view the next model is drawn at. A model shows at that view here, so a picture
   * of the tile is a picture of the stamp.
   */
  import ProofGlyph from '../../components/ProofGlyph.svelte';
  import { proofPicker } from '../../lib/icons/catalog.js';
  import { MODEL_VIEWS } from '../../lib/icons/modelMeta.js';
  import { setStampView, stampViewId } from '../../lib/icons/stampView.svelte.js';

  let { iconName, pick = () => {}, maxHeight = null } = $props();

  const groups = proofPicker();
  const view = $derived(stampViewId());
  // A family starts a row, so each row of models is one family: Road, then Armour…
  const rowStarts = new Set(groups.flatMap(({ items }) => items
    .filter((e, i) => e.family && e.family !== 'Generic' && e.family !== 'Rail' && items[i - 1]?.family !== e.family)
    .map((e) => e.id)));
  /** The flat vehicle stamps and the models carry the same names, so the flat ones say so. */
  const named = (entry) => (entry.kind === 'stamp' && entry.group === 'Vehicles' ? `${entry.label}, flat` : entry.label);
</script>

<div class="picker" style:max-height={maxHeight}>
  <div class="lib">
    {#each groups as { group, items } (group)}
      <section aria-label={group}>
        <h3>{group}</h3>
        <div class="grid">
          {#each items as entry (entry.id)}
            <button
              type="button"
              class="tile"
              class:active={iconName === entry.id}
              class:row-start={rowStarts.has(entry.id)}
              title={named(entry)}
              aria-label={named(entry)}
              onclick={() => pick(entry.id)}
            >
              <ProofGlyph name={entry.id} size={32} view={view} />
            </button>
          {/each}
        </div>
      </section>
    {/each}
  </div>
  <div class="foot">
    <span class="foot-label">View</span>
    <div class="seg" role="radiogroup" aria-label="View of the next model">
      {#each MODEL_VIEWS as option (option.id)}
        <button
          type="button"
          role="radio"
          aria-checked={view === option.id}
          class:on={view === option.id}
          onclick={() => setStampView(option.id)}
        >{option.label}</button>
      {/each}
    </div>
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    width: 300px;
    max-height: 560px;
    min-height: 0;
  }
  .lib {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-right: 2px;
  }
  h3 {
    margin: 0 0 4px;
    font-size: var(--fs-xs, 0.72rem);
    font-weight: 500;
    color: var(--text-2);
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }
  .tile {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--r-sm, 5px);
    color: var(--text-2);
    background: transparent;
    cursor: pointer;
    transition: border-color 0.12s var(--ease), color 0.12s var(--ease);
  }
  .tile.row-start { grid-column-start: 1; }
  .tile :global(svg) { max-width: 100%; }
  .tile:hover { border-color: var(--border-strong, var(--border)); color: var(--text-1); }
  .tile.active {
    border-color: var(--accent);
    /* --accent-text is ink for sitting ON the accent, not a foreground: on a
       transparent button it is near-black, which in the dark theme is invisible. */
    color: var(--text-1);
    background: var(--bg-3);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 8px;
    margin-top: 8px;
    border-top: 1px solid var(--border);
  }
  .foot-label { font-size: var(--fs-xs, 0.72rem); color: var(--text-2); }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--r-sm, 5px);
    overflow: hidden;
  }
  .seg button {
    padding: 3px 10px;
    font-size: var(--fs-xs, 0.72rem);
    color: var(--text-2);
    background: transparent;
    border: 0;
    border-right: 1px solid var(--border);
    cursor: pointer;
  }
  .seg button:last-child { border-right: 0; }
  .seg button:hover { color: var(--text-1); background: var(--bg-3); }
  .seg button.on { background: var(--accent); color: var(--accent-text); font-weight: 600; }
</style>
