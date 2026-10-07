<script>
  /**
   * Build a figure: the same ground on one day, through the layers you pick.
   *
   * The figure an analyst publishes is rarely one picture. It is true colour
   * for what a reader recognises, a short-wave composite for the heat, an index
   * for the measurement — each captioned, with one line saying where and when.
   * By hand that is four captures, four drags onto a canvas and a footer typed
   * from memory.
   *
   * It is filed as a Geo Proof, so it opens in the composer with its captions
   * and its credit line already written and takes arrows like any other
   * composition. Each panel is a real capture, with its own provenance.
   *
   * One day for every panel, by design: a figure is about one acquisition seen
   * several ways. Panels of different dates compare two things at once, which
   * is what Compare is for.
   */
  import { untrack } from 'svelte';
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { api } from '../../lib/api.js';
  import { toast } from '../../lib/state.svelte.js';
  import { DEFAULT_PER_ROW, MAX_PANELS } from '../../lib/figures.js';

  let {
    caseId,
    /** The acquisition every panel is rendered from. Empty = nothing to build. */
    day,
    maxcc,
    /** Where and how the panels are framed, as the capture would frame them. */
    view,
    width,
    height,
    /** `[{id, label, hint, custom}]` — the layer picker's own list. */
    layers = [],
    scaleNorth = false,
    onclose,
    onbuilt,
  } = $props();

  // What a panel is called defaults to the layer's own label: the analyst's
  // words are what a figure's text refers to, and these are a start, not a rule.
  let chosen = $state(new Map());
  let title = $state('');
  let perRow = $state(DEFAULT_PER_ROW);
  // The capture's own tick is the opening answer; the dialog is mounted fresh
  // each time it opens, so it never needs to follow it afterwards.
  let burn = $state(untrack(() => scaleNorth));
  let busy = $state(false);

  const picked = $derived([...chosen.keys()].filter((id) => layers.some((e) => e.id === id)));
  const full = $derived(picked.length >= MAX_PANELS);

  function toggle(entry) {
    if (chosen.has(entry.id)) {
      chosen.delete(entry.id);
    } else {
      if (full) return;
      chosen.set(entry.id, entry.label || entry.id);
    }
    chosen = new Map(chosen);
  }

  /** Where this layer sits in the figure, which is what its caption is numbered by. */
  const place = (id) => picked.indexOf(id) + 1;

  async function build() {
    if (busy || !picked.length || !title.trim()) return;
    busy = true;
    try {
      const built = await api.post(`/api/cases/${caseId}/satellite/figure`, {
        title: title.trim(),
        lat: view.lat,
        lon: view.lon,
        zoom: Math.round(view.zoom),
        bearing: view.bearing ?? 0,
        width,
        height,
        day,
        maxcc,
        per_row: perRow,
        scale_north: burn,
        panels: picked.map((id) => ({ layer: id, caption: chosen.get(id) ?? '' })),
      });
      toast(`${picked.length} panels filed`, 'ok');
      onbuilt(built);
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = false;
    }
  }
</script>

<Modal title="Build a figure" {onclose} width="560px" align="top">
  {#if !day}
    <p class="lead warn">
      <Icon name="alert" size={13} />
      Pick a date first. Every panel of a figure is the same acquisition, so an undated map
      has nothing to build from.
    </p>
  {:else}
    <p class="lead">
      The same ground on <strong class="mono">{day}</strong>, through the layers you pick. Each
      panel is filed as its own capture, and the figure opens in Geo Proof ready to annotate.
    </p>

    <label class="field">
      <span>Title</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="input"
        bind:value={title}
        maxlength="200"
        autofocus
        placeholder="What the figure shows"
        aria-label="Figure title"
      />
    </label>

    <div class="panels">
      <div class="panels-head">
        <span class="label">Panels</span>
        <span class="count">{picked.length}/{MAX_PANELS}</span>
      </div>
      <ul>
        {#each layers as entry (entry.id)}
          {@const on = chosen.has(entry.id)}
          <li class:on>
            <label class="pick" title={entry.hint || entry.id}>
              <input
                type="checkbox"
                checked={on}
                disabled={!on && full}
                onchange={() => toggle(entry)}
              />
              <span class="num mono">{on ? `${place(entry.id)}.` : ''}</span>
              <span class="name">
                {entry.label || entry.id}
                {#if entry.custom}<span class="tag">yours</span>{/if}
              </span>
            </label>
            {#if on}
              <input
                class="input caption"
                value={chosen.get(entry.id)}
                maxlength="120"
                aria-label={`Caption for ${entry.label || entry.id}`}
                placeholder="Caption under this panel"
                oninput={(e) => {
                  chosen.set(entry.id, e.currentTarget.value);
                  chosen = new Map(chosen);
                }}
              />
            {/if}
          </li>
        {/each}
      </ul>
      <p class="help">
        <Icon name="info" size={12} />
        <span>
          Panels are numbered down the list, so a caption can be referred to as panel 2.
        </span>
      </p>
    </div>

    <div class="row">
      <label class="field narrow">
        <span>Panels per row</span>
        <select class="input" bind:value={perRow} aria-label="Panels per row">
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
          <option value={4}>4</option>
        </select>
      </label>
      <div class="field narrow">
        <span>Each panel</span>
        <span class="readout mono" title="The capture size, from the menu this opened from">
          {width}×{height}
        </span>
      </div>
      <label class="toggle">
        <input type="checkbox" bind:checked={burn} />
        <span>Scale bar and north arrow</span>
      </label>
    </div>

    <footer class="actions">
      <button
        class="btn btn-primary"
        disabled={busy || !picked.length || !title.trim()}
        onclick={build}
        title={!picked.length
          ? 'Pick at least one layer'
          : !title.trim()
            ? 'Name the figure'
            : `Render ${picked.length} panels and file them`}
      >
        {#if busy}<span class="spinner"></span> Rendering…{:else}Build the figure{/if}
      </button>
      <button class="btn" onclick={onclose}>Cancel</button>
      <span class="cost">{picked.length || 0} panels, {picked.length || 0} renders billed.</span>
    </footer>
  {/if}
</Modal>

<style>
  .lead { margin: 0 0 12px; font-size: var(--fs-sm); color: var(--text-2); line-height: 1.5; }
  /* `.mono` sizes against its parent rather than the scale around it. */
  .lead .mono, .readout { font-size: var(--fs-sm); }
  .lead.warn { display: flex; gap: 7px; align-items: flex-start; color: var(--warn); }
  .lead.warn :global(svg) { flex: none; margin-top: 2px; }

  .field { display: grid; gap: 4px; margin-bottom: 12px; }
  .field > span { font-size: var(--fs-xs); color: var(--text-3); }
  .field.narrow { margin-bottom: 0; min-width: 0; }

  .panels {
    display: grid;
    gap: 7px;
    margin-bottom: 12px;
    padding: 10px 11px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .panels-head { display: flex; align-items: baseline; gap: 8px; }
  .panels-head .label {
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--text-3);
  }
  .panels-head .count { margin-left: auto; font-size: var(--fs-xs); color: var(--text-3); }
  .panels ul { display: grid; gap: 5px; margin: 0; padding: 0; list-style: none; }
  .panels li { display: grid; gap: 4px; padding: 5px 6px; border-radius: var(--r-sm); }
  .panels li.on { background: var(--bg-1); }
  .pick { display: flex; align-items: center; gap: 8px; cursor: pointer; }
  .num { width: 1.4em; font-size: var(--fs-xs); color: var(--accent); }
  .name { font-size: var(--fs-sm); color: var(--text-1); }
  .tag {
    margin-left: 6px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 3px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-3);
  }
  .caption { margin-left: 26px; font-size: var(--fs-xs); }

  .row { display: flex; align-items: flex-end; gap: 14px; margin-bottom: 14px; }
  .readout { padding: 5px 0; color: var(--text-2); }
  .toggle { display: flex; align-items: center; gap: 7px; font-size: var(--fs-xs); color: var(--text-2); }

  .help {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    font-size: var(--fs-xs);
    line-height: 1.45;
    color: var(--text-3);
  }
  .help :global(svg) { flex: none; margin-top: 2px; opacity: 0.8; }

  .actions { display: flex; align-items: center; gap: 8px; }
  .cost { margin-left: auto; font-size: var(--fs-xs); color: var(--text-3); }
</style>
