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
   * A row opens folded to one line: the eye, the name, and the two acts as
   * icons. Unfolding it shows the rest. Staleness is the one thing a folded row
   * still says, because it is said before a mark is read. The rows are in the
   * order the map stacks them, top first, and the grip drags them into another.
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
  import { tick, untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import SearchInput from '../../components/SearchInput.svelte';
  import LayerTimeStrip from './LayerTimeStrip.svelte';
  import {
    countLabel,
    followed,
    freshness,
    grouped,
    legend,
    moveName,
    sourceLabel,
  } from '../../lib/map/addedLayers.js';

  let {
    /** The rows as the backend returned them. */
    rows = [],
    /** The layer an act is running on, so its buttons can say so. */
    busy = '',
    /** The head's Refresh is going through every followed layer. */
    refreshing = false,
    /** The layer just added, which opens unfolded since it was added to be read. */
    opened = '',
    open = $bindable(true),
    /** `(layer, query) => { total, results, ready }`, over features already in
     *  memory. Nothing here fetches. */
    search,
    ontoggle,
    oncategory,
    onrefresh,
    onrefreshall,
    onremove,
    /** `(names)`: every row's name in its new order, top of the map first. */
    onreorder,
    onpick,
    onadd,
    /** `(layer) => index | null`, the days its features carry (`layerDates.js`). */
    dates,
    /** `(layer, period, commit)`: the time strip moved, or was let go. */
    onperiod,
  } = $props();

  const live = $derived(rows.filter((row) => row.enabled).length);
  const anyFollowed = $derived(rows.some(followed));
  const names = $derived(rows.map((row) => row.name));

  /** Unfolded rows, by layer name. Every row starts folded, on every visit. */
  let unfolded = $state(new Set());

  /** Once per added layer: folding it afterwards must keep it folded. */
  let unfoldedOnAdd = '';
  $effect(() => {
    if (!opened || opened === unfoldedOnAdd) return;
    unfoldedOnAdd = opened;
    untrack(() => (unfolded = new Set(unfolded).add(opened)));
  });

  function toggleRow(name) {
    const next = new Set(unfolded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    unfolded = next;
  }

  /** The row being dragged, and the gap it would land in (a place in the list). */
  let dragged = $state('');
  let gap = $state(-1);
  let list = $state(null);

  /**
   * How far past the list a drag still counts as over it. The grip sits on the
   * row's left edge, so a hand moving down it drifts off the row within pixels,
   * and a drop the browser refuses snaps the row back to where it was.
   */
  const SLACK_X = 32;
  const SLACK_Y = 16;

  /** The gap under the pointer, by height alone, or -1 away from the list. */
  function gapAt(x, y) {
    const box = list?.getBoundingClientRect();
    if (!box) return -1;
    if (x < box.left - SLACK_X || x > box.right + SLACK_X) return -1;
    if (y < box.top - SLACK_Y || y > box.bottom + SLACK_Y) return -1;
    const items = [...list.children];
    const at = items.findIndex((item) => {
      const rect = item.getBoundingClientRect();
      return y < rect.top + rect.height / 2;
    });
    return at < 0 ? items.length : at;
  }

  function dragStart(event, row) {
    dragged = row.name;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', row.title);
    const item = event.currentTarget.closest('li');
    if (item) event.dataTransfer.setDragImage(item, 12, 12);
  }

  /** On the window, so the pointer need not stay on a row for the drop to take. */
  function dragOver(event) {
    if (!dragged) return;
    gap = gapAt(event.clientX, event.clientY);
    if (gap < 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function drop(event) {
    if (!dragged) return;
    event.preventDefault();
    if (gap < 0) return dragEnd();
    const next = moveName(names, dragged, gap);
    dragEnd();
    if (next.join('\n') !== names.join('\n')) onreorder?.(next);
  }

  function dragEnd() {
    dragged = '';
    gap = -1;
  }

  /** The same move from the keyboard, one place at a time, focus kept on the grip. */
  async function nudge(event, row, index) {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!step) return;
    event.preventDefault();
    const to = index + step;
    if (to < 0 || to >= names.length) return;
    onreorder?.(moveName(names, row.name, step > 0 ? to + 1 : to));
    await tick();
    document.querySelector(`[data-grip="${CSS.escape(row.name)}"]`)?.focus();
  }

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

<svelte:window ondragover={dragOver} ondrop={drop} />

<div class="head">
  <button type="button" class="sub-head" onclick={() => (open = !open)}>
    <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
    <Icon name="compass" size={13} />
    <span>Added layers</span>
    <span class="count">{live}</span>
  </button>
  {#if anyFollowed}
    <button
      type="button"
      class="icon-act"
      class:spin={refreshing}
      disabled={refreshing}
      aria-label="Refresh every followed layer"
      title={refreshing ? 'Reading…' : 'Refresh every followed layer'}
      onclick={() => onrefreshall?.()}
    >
      <Icon name="reset" size={13} />
    </button>
  {/if}
</div>

{#if open}
  {#if !rows.length}
    <p class="empty">Nothing added yet.</p>
  {/if}
  <ul class="layers" class:stackable={rows.length > 1} bind:this={list}>
    {#each rows as row, index (row.name)}
      {@const unfold = unfolded.has(row.name)}
      <li
        class:dragged={dragged === row.name}
        class:gap-above={dragged && gap === index}
        class:gap-below={dragged && gap === index + 1 && index === rows.length - 1}
      >
        <div class="row">
          {#if rows.length > 1}
            <!-- A span rather than a button: Firefox starts no drag from a button. -->
            <span
              role="button"
              tabindex="0"
              class="grip"
              draggable="true"
              data-grip={row.name}
              aria-label={`Move ${row.title}`}
              aria-keyshortcuts="ArrowUp ArrowDown"
              title="Drag to restack"
              ondragstart={(event) => dragStart(event, row)}
              ondragend={dragEnd}
              onkeydown={(event) => nudge(event, row, index)}
            >
              <Icon name="grip" size={14} />
            </span>
          {/if}
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
          <button
            type="button"
            class="fold"
            aria-expanded={unfold}
            aria-label={`${row.title}, details`}
            title={unfold ? 'Fold this layer' : 'Show its details'}
            onclick={() => toggleRow(row.name)}
          >
            <Icon name={unfold ? 'chevronDown' : 'chevronRight'} size={11} />
            <span class="name" class:off={!row.enabled} class:stale={row.stale}>{row.title}</span>
          </button>
          {#if row.stale && !unfold}
            <span class="stale-mark" title={freshness(row)}>
              <Icon name="alert" size={12} />
            </span>
          {/if}
          {#if followed(row)}
            <button
              type="button"
              class="icon-act"
              class:spin={busy === row.name}
              disabled={busy === row.name}
              aria-label={`Refresh ${row.title}`}
              title={busy === row.name ? 'Reading…' : 'Read it again from its source'}
              onclick={() => onrefresh?.(row)}
            >
              <Icon name="reset" size={13} />
            </button>
          {/if}
          <button
            type="button"
            class="icon-act danger"
            aria-label={`Remove ${row.title}`}
            title="Remove this layer"
            onclick={() => onremove?.(row)}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
        {#if unfold}
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

        {/if}
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
    --indent: 30px;
    margin: 0;
    padding: 0 4px;
    list-style: none;
  }
  .layers.stackable {
    --indent: 46px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .head .icon-act {
    margin-top: 6px;
  }
  .layers > li {
    position: relative;
    padding-bottom: 2px;
  }
  .layers > li.dragged {
    opacity: 0.45;
  }
  /* Where the dragged row would land: a line in the gap, above this row or,
     past the last one, below it. */
  .layers > li.gap-above::before,
  .layers > li.gap-below::after {
    content: '';
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }
  .layers > li.gap-above::before {
    top: -1px;
  }
  .layers > li.gap-below::after {
    bottom: -1px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 26px;
  }
  /* Always shown once there is something to reorder, and the details below
     move right by its width so they stay under the name. */
  .grip {
    display: grid;
    flex: none;
    place-items: center;
    width: 14px;
    height: 22px;
    margin-right: 2px;
    border-radius: var(--radius-1);
    color: var(--text-3);
    cursor: grab;
  }
  .grip:hover,
  .grip:focus-visible {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .grip:active {
    cursor: grabbing;
  }
  .fold {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 2px 0;
    color: var(--text-3);
    text-align: left;
    cursor: pointer;
  }
  .fold:hover,
  .fold:hover .name {
    color: var(--text-1);
  }
  .stale-mark {
    display: grid;
    place-items: center;
    color: var(--warn);
  }
  .icon-act {
    display: grid;
    flex: none;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-1);
    color: var(--text-3);
    cursor: pointer;
  }
  .icon-act:hover:not(:disabled) {
    color: var(--text-1);
    background: var(--bg-3);
  }
  .icon-act.danger:hover {
    color: var(--danger);
  }
  .icon-act:disabled {
    cursor: default;
  }
  .icon-act.spin :global(svg) {
    animation: spin 0.9s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .eye {
    flex: none;
    margin-right: 4px;
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
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
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
    padding-left: var(--indent, 30px);
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
    padding: 3px 0 2px calc(var(--indent, 30px) - 4px);
    color: var(--text-3);
    font-size: 10px;
    cursor: pointer;
  }
  .legend-head:hover {
    color: var(--text-1);
  }
  .legend {
    margin: 0;
    padding: 0 0 2px var(--indent, 30px);
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
    padding: 2px 4px 4px var(--indent, 30px);
  }
  .empty {
    margin: 0;
    padding: 2px 0 4px var(--indent, 30px);
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
