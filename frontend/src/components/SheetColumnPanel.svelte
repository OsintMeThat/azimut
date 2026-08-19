<script>
  /**
   * How one column is set up, with room.
   *
   * A heading has three doors and this is the one used least: what the column *is* — its
   * name, its type and vocabulary, the line of instruction, what it can be read for. Nearly
   * all of it decided once and then left alone.
   *
   * The other two are next door because they are wanted constantly: the **funnel** asks
   * something of the rows (`SheetFilterMenu`), and a **right-click on the heading** is the
   * short list of gestures — insert, duplicate, rename, sort, split, hide, delete
   * (`SheetHeadingMenu`). Those are not restated here; one screen offering a thing twice is
   * how two of them come to disagree.
   *
   * It is a **side panel** and shares its slot with the row panel, which opening either one
   * puts away. That is what a dialog could not do: the panel stays open as the next heading
   * is clicked, so setting up a fresh import is one click per column rather than a dialog
   * opened and closed for each. It also keeps the column's own cells on screen beside the
   * words being written about them.
   *
   * It owns no rules. Every answer is a call back up, and `lib/sheet.js` and
   * `lib/sheetRoles.js` are where a filter or a role means something.
   */
  import Icon from './Icon.svelte';
  import SheetRoleEditor from './SheetRoleEditor.svelte';
  import { ID_COLUMN, columnValues, filterSummary, urlsIn } from '../lib/sheet.js';
  import { countedOf, isChipped } from '../lib/sheetRoles.js';
  import { rowTargets, unresolved } from '../lib/sheetRows.js';

  let {
    table,
    meta,
    column,
    filter = null,
    onrename,
    onfreeze,
    onclearfilter,
    onrole,
    onnote,
    onprogress,
    onmap,
    ontimeline,
    onnormalise,
    onduplicates,
    onnearby,
    onvalue,
    ongeocode,
    oncheck,
    onanchors,
    onclose,
  } = $props();

  const role = $derived(meta?.roles?.[column.name] ?? null);
  /** A column of values counts its own values in the funnel, one by one, so "what is said
   *  twice here" is a reading it already gives. */
  const chipped = $derived(isChipped(role));
  const asked = $derived(filterSummary(filter));
  const isKey = $derived(String(column.name).toLowerCase() === ID_COLUMN);
  const frozen = $derived(meta?.frozen === column.name);
  const isProgress = $derived(meta?.progress === column.name);
  const counted = $derived(countedOf(role));
  /** How many of a `row` column's names reach no single row. The binders' own version of
   *  this column had already decayed to `#REF!`; re-read from the words every time, the
   *  same decay is a number that goes up the moment somebody renames a row. */
  const adrift = $derived(
    role?.kind === 'row' ? unresolved(rowTargets(table, column.index, role)) : 0,
  );

  /** What this column actually says, commonest first. The funnel counts the same values and
   *  makes you open it column by column; a worklist's real question — *which cities does
   *  this hold, and how many rows each* — is a reading, so it is read here. */
  const spread = $derived(columnValues(table, column.name, role, { limit: 8 }));

  /** Whether the column holds addresses, over a sample rather than the whole sheet: this is
   *  only deciding whether to offer a button, and reading twenty thousand rows to draw one
   *  is a cost nobody asked for. */
  const holdsLinks = $derived(
    (table?.rows ?? []).slice(0, 200).some((row) => urlsIn(row[column.index]).length),
  );

  let note = $state('');
  let name = $state('');
  // Re-seeded when the dialog opens on another heading, so the boxes hold that column's
  // answers rather than the previous one's.
  $effect(() => {
    note = meta?.notes?.[column.name] ?? '';
  });
  $effect(() => {
    name = column.name;
  });
</script>

<aside class="panel column-panel" aria-label="How this column is set up">
  <header>
    <Icon name="sliders" size={13} />
    <span class="which">{column.name}</span>
    <div class="spacer"></div>
    <button class="btn btn-ghost btn-sm" title="Close" aria-label="Close this column"
            onclick={onclose}>
      <Icon name="x" size={14} />
    </button>
  </header>

  <div class="body">
  {#if isKey}
    <p class="note">The row's handle. It is never renamed, moved or rewritten.</p>
  {:else}
    <label class="field">
      <span>Name</span>
      <input class="input name" bind:value={name} aria-label="Column name"
             onkeydown={(event) => event.key === 'Enter' && onrename(name)}
             onblur={() => onrename(name)} />
    </label>

    {#if asked}
      <!-- Said, not offered: the funnel on the heading is where a filter is set, and this
           is the dialog telling you the rows you are looking at are not all of them. -->
      <section class="asked">
        <Icon name="filter" size={12} />
        <span>{asked}</span>
        <button class="clear" onclick={onclearfilter}>Clear</button>
      </section>
    {/if}

    <SheetRoleEditor {table} {meta} {column} {role} onchange={onrole} {onanchors} />

    <section>
      <label class="field">
        <span>Note</span>
        <input class="input" placeholder="what belongs here" bind:value={note}
               onkeydown={(event) => event.key === 'Enter' && onnote(note)}
               onblur={() => onnote(note)} />
      </label>
    </section>

    <!-- What this column can be *read* for, which is not the same as what can be done to
         it: the frequent gestures — insert, duplicate, rename, split, hide, delete — are one
         right-click on the heading, so they are not restated here. -->
    <section>
      <p class="what">Read this column</p>
      {#if spread?.values?.length}
        <!-- The count per value, which is the pivot a worklist asks for constantly: how
             many rows say Kherson. Clicking one is the filter, so the reading and the
             question are one gesture apart. -->
        <div class="spread">
          {#each spread.values as entry (entry.value)}
            <button class="value-row" onclick={() => onvalue(entry.value)}
                    title="Keep only rows with “{entry.value}”">
              <span>{entry.value || '(blank)'}</span>
              <small>{entry.rows}</small>
            </button>
          {/each}
        </div>
        {#if spread.total > spread.values.length}
          <p class="menu-note">The 8 commonest of {spread.total}. The filter lists the rest.</p>
        {/if}
      {/if}
      {#if role?.kind === 'latlon'}
        <button class="row-btn" onclick={() => onmap(column.name)}>
          <Icon name="satellite" size={12} /><span>Show on the map</span>
        </button>
        <button class="row-btn" onclick={() => onnearby(column.name)}>
          <Icon name="crosshair" size={12} /><span>Find points too close</span>
        </button>
        <button class="row-btn" onclick={() => onnormalise(column.name)}>
          <Icon name="wand" size={12} /><span>Rewrite as <code>lat, lon</code></span>
        </button>
        <!-- The other direction of the geocoder, and the one a geolocation index wants at
             the end: the points are established, and now the rows need a place name. -->
        <button class="row-btn" onclick={() => ongeocode('reverse')}>
          <Icon name="globe" size={12} /><span>Name these points…</span>
        </button>
      {/if}
      {#if role?.kind === 'when'}
        <!-- What it does, said as what it does. "Send to the Timeline" read as filing the
             dates there; it opens the Timeline on the period they cover. -->
        <button class="row-btn" onclick={() => ontimeline(column.name)}>
          <Icon name="clock" size={12} /><span>Open the Timeline on this period</span>
        </button>
      {/if}
      {#if !role || role.kind === 'choice' || role.kind === 'state'}
        <!-- A column of place names is what a binder actually holds, and typing four
             hundred coordinates by hand is what it costs. Proposed, never applied. -->
        <button class="row-btn" onclick={() => ongeocode('forward')}>
          <Icon name="pin" size={12} /><span>Read these places into coordinates…</span>
        </button>
      {/if}
      {#if holdsLinks}
        <!-- The only reading that reaches the network, and only on this press. -->
        <button class="row-btn" onclick={() => oncheck(column.name)}>
          <Icon name="external" size={12} /><span>Check these links…</span>
        </button>
      {/if}
      {#if !chipped}
        <!-- Not on a column of values: there, every value said twice is every value, and
             the spread above already counts them one by one. -->
        <button class="row-btn" onclick={() => onduplicates(column.name)}>
          <Icon name="copy" size={12} /><span>Show duplicates</span>
        </button>
      {/if}
    </section>

    <!-- Into the case is one road now, and it is a whole-sheet answer: every column takes
         a mode in one screen, so a per-column button here would be the second way in. What
         stays is the reading this panel is for — how many names reach no row. -->
    {#if role?.kind === 'row' && adrift}
      <section>
        <p class="what">Into the case</p>
        <p class="menu-note">
          {adrift} {adrift === 1 ? 'name reaches' : 'names reach'} no single row, and are
          marked in the cells.
        </p>
      </section>
    {/if}

    <!-- A sheet-wide answer, set from the column that carries it: one column per sheet says
         how far along the work is, and this is where it is chosen or given up. -->
    <section>
      <p class="what">This sheet</p>
      <button class="row-btn" class:on={isProgress} onclick={() => onprogress(column.name)}>
        <Icon name="chart" size={12} />
        <span>{isProgress ? 'Stop counting progress here' : 'Count the sheet progress here'}</span>
      </button>
      <button class="row-btn" class:on={frozen} onclick={() => onfreeze(column.name)}>
        <Icon name="pushpin" size={12} />
        <span>{frozen ? 'Let it scroll' : 'Keep it in view'}</span>
      </button>
      {#if counted}
        <p class="menu-note">
          This column counts {counted} {counted === 1 ? 'column' : 'columns'}, so the cells
          read <code>0</code> to <code>{counted}</code>.
        </p>
      {/if}
    </section>
  {/if}
  </div>
</aside>

<style>
  /* The same 340px slot the row panel takes, and the two take turns in it: you are either
     reading a row across its fields or working on a column down the rows. Opening one puts
     the other away, so there is never a question about which the panel is showing. */
  .panel {
    width: 340px; flex: none; display: flex; flex-direction: column; min-height: 0;
    border-left: 1px solid var(--border); background: var(--bg-1);
  }
  header {
    display: flex; align-items: center; gap: 6px; padding: 5px 8px;
    border-bottom: 1px solid var(--border); color: var(--text-3);
  }
  .which {
    min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-1); font-size: var(--fs-sm); font-weight: 500;
  }
  .body { flex: 1; min-height: 0; overflow: auto; padding: 6px 10px 14px; }
  .spacer { flex: 1; }
  section { padding-top: 6px; margin-top: 5px; border-top: 1px solid var(--border); }
  .what { padding: 2px 3px 5px; color: var(--text-3); font-size: var(--fs-xs); }
  .asked {
    display: flex; align-items: center; gap: 6px; padding: 6px 7px; margin-top: 8px;
    border-radius: var(--r-sm); background: var(--accent-soft); color: var(--accent);
    font-size: var(--fs-xs);
  }
  .asked span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .asked .clear { flex: none; color: inherit; text-decoration: underline; }
  .field { display: block; padding: 2px 0; }
  .field span { display: block; color: var(--text-3); font-size: var(--fs-xs); margin-bottom: 3px; }
  .field .input { width: 100%; }
  .row-btn {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 6px 6px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left; font-size: var(--fs-sm);
  }
  .row-btn:hover { background: var(--bg-2); color: var(--text-1); }
  .row-btn.on { color: var(--accent); }
  .row-btn span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* The count per value: the word, then how many rows hold it. A row per value, because
     that is how a tally is read. */
  .spread { max-height: 190px; overflow: auto; margin-bottom: 4px; }
  .value-row {
    display: flex; align-items: center; gap: 8px; width: 100%; padding: 4px 6px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left; font-size: var(--fs-sm);
  }
  .value-row:hover { background: var(--bg-2); color: var(--text-1); }
  .value-row span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .value-row small { flex: none; color: var(--text-3); font-size: var(--fs-xs); }
  .note { padding: 6px 4px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  .menu-note { padding: 6px 7px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  .spacer { flex: 1; }
</style>
