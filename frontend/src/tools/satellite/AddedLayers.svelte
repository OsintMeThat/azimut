<script>
  /**
   * The second section of the Layers panel: what the analyst put there.
   *
   * The list above it is Azimut's own stack, and it is untouched. The line
   * between the two is *who chose it* — not local versus remote, which is why a
   * dropped KMZ and a followed My Maps are rows of one list.
   *
   * A row here carries four things a curated row does not, and each is a failure
   * this feature would otherwise have:
   *
   * - **where it came from**, because a layer with no stated source is a claim
   *   with no provenance;
   * - **how fresh it is**, said before the marks are read rather than after —
   *   week-old data drawn silently on a map where decisions get made is the
   *   worst thing this could do;
   * - **its legend, which is the filter**, one row per category with its colour
   *   and its count, clicking one hides exactly those features;
   * - **Refresh and Remove**, because the analyst owns this layer in a way
   *   they do not own the borders overlay.
   *
   * Everything a row states is computed in `lib/map/addedLayers.js`, so the
   * rules are read off a test rather than off a screen.
   *
   * The legend and the search share one slot under the chevron, and never show
   * at once. They are the two ways into the same features and they are not the
   * same act: the legend is the filter, persisted on the spec and counted on the
   * row above; the search is a finder, ephemeral, and it changes nothing about
   * what the map draws. One slot is also what keeps a row this tall from growing
   * a third thing to unfold.
   */
  import Icon from '../../components/Icon.svelte';
  import SearchInput from '../../components/SearchInput.svelte';
  import LayerTimeStrip from './LayerTimeStrip.svelte';
  import {
    countLabel,
    followed,
    freshness,
    grouped,
    legend,
    sourceLabel,
  } from '../../lib/map/addedLayers.js';

  let {
    /** The rows as the backend returned them. */
    rows = [],
    /** The layer an act is running on, so its buttons can say so. */
    busy = '',
    open = $bindable(true),
    /** `(layer, query) => { total, results, ready }`, over features already in
     *  memory. Nothing here fetches. */
    search,
    ontoggle,
    oncategory,
    onrefresh,
    onremove,
    onpick,
    onadd,
    /** `(layer) => index | null`, the days its features carry (`layerDates.js`). */
    dates,
    /** `(layer, period, commit)`: the time strip moved, or was let go. */
    onperiod,
  } = $props();

  const live = $derived(rows.filter((row) => row.enabled).length);

  /** Expanded legends, by layer name. A layer's categories are its own list and
   *  three of them open at once would push the case's own panel off screen. */
  let expanded = $state(new Set());

  /** What is typed in each layer's box, by layer name. Kept while a row is
   *  folded away: it costs nothing, since a search draws nothing. */
  let queries = $state({});

  function toggleLegend(name) {
    const next = new Set(expanded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    expanded = next;
  }
</script>

<button type="button" class="sub-head" onclick={() => (open = !open)}>
  <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
  <Icon name="compass" size={13} />
  <span>Added layers</span>
  <span class="count">{live}</span>
</button>

{#if open}
  {#if !rows.length}
    <p class="empty">Nothing added yet.</p>
  {/if}
  <ul class="layers">
    {#each rows as row (row.name)}
      <li>
        <div class="row">
          <button
            type="button"
            class="eye"
            class:on={row.enabled}
            aria-pressed={row.enabled}
            aria-label={row.title}
            title={row.enabled ? 'Stop drawing this layer' : 'Draw this layer'}
            onclick={() => ontoggle?.(row)}
          >
            <Icon name="eye" size={13} />
          </button>
          <span class="name" class:off={!row.enabled}>{row.title}</span>
        </div>
        <p class="meta">
          <!-- A followed map is a page somebody publishes, so where it came
               from is a way of getting there: this is the one thing on the row
               that leaves the app, and it leaves on a click rather than on a
               render. A file has no such address and stays plain text. -->
          {#if followed(row) && row.source.url}
            <a
              class="from"
              href={row.source.url}
              target="_blank"
              rel="noreferrer"
              title="Open this map at its source"
            >{sourceLabel(row)} <Icon name="external" size={9} /></a>
          {:else}
            <span>{sourceLabel(row)}</span>
          {/if}
          <!-- A stale subscription says so here, in its own colour, before
               anyone reads a single mark it drew. -->
          <span class:stale={row.stale}>{freshness(row)}</span>
        </p>
        <!-- Both numbers, always: what is loaded and what is drawn, never the
             one passing for the other. -->
        <p class="meta counts">{countLabel(row)}</p>

        <!-- Only on a layer being drawn, and only once its features are in hand
             and turn out to be dated: a filter over marks nobody can see would
             be a control with nothing to show for it. -->
        {#if row.enabled}
          {@const index = dates?.(row)}
          {#if index}
            <LayerTimeStrip
              {index}
              hidden={row.hidden}
              period={row.period}
              label={row.title}
              oninput={(period) => onperiod?.(row, period, false)}
              onchange={(period) => onperiod?.(row, period, true)}
            />
          {/if}
        {/if}

        {#if row.categories.length}
          <button
            type="button"
            class="legend-head"
            aria-expanded={expanded.has(row.name)}
            onclick={() => toggleLegend(row.name)}
          >
            <Icon name={expanded.has(row.name) ? 'chevronDown' : 'chevronRight'} size={11} />
            <span>{row.categories.length} {row.categories.length === 1 ? 'group' : 'groups'}</span>
          </button>
          {#if expanded.has(row.name)}
            {@const query = (queries[row.name] ?? '').trim()}
            <!-- Only on a layer being drawn: a match is somewhere to go, and a
                 layer switched off has nowhere. -->
            {@const found = row.enabled && query ? search?.(row, query) : null}
            {#if row.enabled}
              <div class="find">
                <SearchInput
                  bind:value={
                    () => queries[row.name] ?? '',
                    (typed) => (queries[row.name] = typed)
                  }
                  placeholder="Find a pin"
                  width="100%"
                  count={found?.ready ? grouped(found.total) : null}
                />
              </div>
            {/if}

            {#if found}
              {#if !found.ready}
                <p class="empty">Reading…</p>
              {:else if !found.total}
                <p class="empty">No pin matches that.</p>
              {:else}
                <ul class="legend">
                  {#each found.results as hit (hit.index)}
                    <li>
                      <!-- A match in a group the legend switched off is listed
                           all the same, marked, and going to it turns the group
                           back on. -->
                      <button
                        type="button"
                        class="cat"
                        class:off={hit.hidden}
                        title={hit.outside
                          ? 'Show every date and go there'
                          : hit.hidden
                            ? 'Show this group and go there'
                            : 'Go to this pin'}
                        onclick={() => onpick?.(row, hit)}
                      >
                        <span class="swatch" style="--swatch: {hit.colour}"></span>
                        <span class="cat-name">{hit.name}</span>
                        {#if hit.category}<span class="cat-group">{hit.category}</span>{/if}
                      </button>
                    </li>
                  {/each}
                </ul>
                {#if found.total > found.results.length}
                  <p class="empty">First {found.results.length} of {grouped(found.total)}.</p>
                {/if}
              {/if}
            {:else}
              <ul class="legend">
                {#each legend(row) as entry (entry.name)}
                  <li>
                    <button
                      type="button"
                      class="cat"
                      class:off={!entry.on}
                      aria-pressed={entry.on}
                      title={entry.on ? 'Hide this group' : 'Show this group'}
                      onclick={() => oncategory?.(row, entry.name)}
                    >
                      <span class="swatch" style="--swatch: {entry.colour}"></span>
                      <span class="cat-name">{entry.name}</span>
                      <span class="cat-count">{entry.count}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          {/if}
        {/if}

        <nav class="acts" aria-label={row.title}>
          {#if followed(row)}
            <button
              class="btn btn-sm"
              disabled={busy === row.name}
              onclick={() => onrefresh?.(row)}
            >{busy === row.name ? 'Reading…' : 'Refresh'}</button>
          {/if}
          <button class="btn btn-sm quiet" onclick={() => onremove?.(row)}>Remove</button>
        </nav>
      </li>
    {/each}
  </ul>
  <button type="button" class="add" onclick={() => onadd?.()}>
    <Icon name="plus" size={12} />
    <span>Add a layer</span>
  </button>
{/if}

<style>
  .layers {
    margin: 0;
    padding: 0 4px;
    list-style: none;
  }
  .layers > li {
    padding-bottom: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 26px;
  }
  .eye {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-1);
    color: var(--text-3);
    cursor: pointer;
  }
  .eye:hover {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .eye.on {
    color: var(--accent);
  }
  .name {
    flex: 1;
    font-size: var(--fs-sm);
    color: var(--text-1);
  }
  .name.off {
    color: var(--text-3);
  }
  .meta {
    display: flex;
    gap: 6px;
    margin: 0;
    padding-left: 30px;
    font-size: 10px;
    color: var(--text-3);
  }
  .meta > * + *::before {
    content: '· ';
  }
  .from {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: inherit;
    text-decoration: none;
  }
  .from:hover {
    color: var(--text-1);
    text-decoration: underline;
  }
  .counts {
    font-variant-numeric: tabular-nums;
  }
  /* The one thing on this row that is allowed to shout. */
  .stale {
    color: var(--warn, #ffcc66);
  }
  .legend-head {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 0 2px 26px;
    color: var(--text-3);
    font-size: 10px;
    cursor: pointer;
  }
  .legend-head:hover {
    color: var(--text-1);
  }
  .legend {
    margin: 0;
    padding: 0 0 2px 30px;
    list-style: none;
  }
  .cat {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 2px 4px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .cat:hover {
    background: var(--bg-3);
    color: var(--text-1);
  }
  .cat.off {
    color: var(--text-3);
  }
  .swatch {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 2px;
    background: var(--swatch);
  }
  .cat.off .swatch {
    background: none;
    box-shadow: inset 0 0 0 1px var(--swatch);
  }
  .cat-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cat-count {
    font-variant-numeric: tabular-nums;
    color: var(--text-3);
  }
  /* Which group a match came from, since the list is no longer sorted into
     them. Capped, so a long group name never squeezes out the pin's own. */
  .cat-group {
    flex: none;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-3);
  }
  .find {
    padding: 2px 4px 4px 30px;
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 4px 0 0 30px;
  }
  .empty {
    margin: 0;
    padding: 2px 0 4px 30px;
    font-size: 10px;
    color: var(--text-3);
  }
  .add {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 4px 10px 30px;
    padding: 4px 8px;
    border: 1px dashed var(--border);
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: 11px;
    cursor: pointer;
  }
  .add:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
