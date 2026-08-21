<script>
  /**
   * Move the ticked rows into another sheet, in two screens.
   *
   * The gesture the binders' tabs were built out of. An inbox, a worklist and a reference
   * table at **one schema**, and a row moves up a floor once it has been worked out: the
   * link to sort, then the lead being checked, then the thing the case is sure of. Copying
   * it by hand is what everybody does instead, and it loses the colour, the entity the
   * cell points at and the record that the row was already promoted — which is exactly the
   * state worth keeping.
   *
   * It used to be one press: pick a sheet, move, and read afterwards which columns had
   * been dropped. Two things were wrong with that. The lot is whatever the grid was
   * holding, and a drag down a column is a lot of rows nobody counted — so the rows are
   * **listed and un-tickable here**. And the columns were matched on their names alone, so
   * `Adresse` arriving at a sheet that calls it `Address` was a silent loss — so the
   * second screen **lines them up** and says what stays behind before the press.
   */
  import Icon from './Icon.svelte';
  import { ID_COLUMN, suggestMapping } from '../lib/sheet.js';

  let {
    sheets,
    sheetId,
    columns,
    rows = [],
    scope = 'ticked',
    busy = false,
    onmove,
    onclose,
  } = $props();

  const others = $derived((sheets ?? []).filter((sheet) => sheet.id !== sheetId));
  let to = $state('');
  /** Which screen: the rows and where they go, then which column lands in which. */
  let step = $state('where');
  let reviewing = $state(false);
  /** Rows the analyst took back out of the lot. Kept by key, so a re-sort cannot move it. */
  let dropped = $state(new Set());
  /** One line per column of this sheet, each pointed at one of theirs or at nothing. */
  let pairs = $state([]);

  $effect(() => {
    if (!to && others.length) to = others[0].id;
  });

  const target = $derived(others.find((sheet) => sheet.id === to) ?? null);
  const going = $derived(rows.filter((row) => !dropped.has(row.key)));
  const mine = $derived(
    (columns ?? []).filter((name) => String(name).toLowerCase() !== ID_COLUMN),
  );
  const theirs = $derived(
    (target?.headings ?? []).filter((name) => String(name).toLowerCase() !== ID_COLUMN),
  );
  const moving = $derived(pairs.filter((pair) => pair.to));
  /** Columns of theirs nothing is pointed at: the rows land with those cells empty. */
  const empty = $derived(theirs.filter((name) => !moving.some((pair) => pair.to === name)));

  function toggle(key) {
    const next = new Set(dropped);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    dropped = next;
  }

  /** Onto the second screen, with the names lined up as far as they line up themselves. */
  function next() {
    if (!target || !going.length) return;
    pairs = suggestMapping(mine, target.headings ?? []);
    step = 'columns';
  }

  function point(name, at) {
    pairs = pairs.map((pair) =>
      pair.name === name
        ? { ...pair, to: at, guessed: false }
        : // One column of theirs holds one of ours: the second would overwrite the first,
          // and the server refuses it anyway.
          pair.to === at && at
          ? { ...pair, to: '', guessed: false }
          : pair,
    );
  }

  function press() {
    onmove(
      to,
      going.map((row) => row.key),
      Object.fromEntries(moving.map((pair) => [pair.name, pair.to])),
    );
  }
</script>

<div class="move">
  {#if !others.length}
    <p class="hint">
      <Icon name="table" size={12} />
      This case holds no other sheet. Make one from this one's columns first.
    </p>
    <div class="modal-row">
      <div class="spacer"></div>
      <button class="btn" onclick={onclose}>Cancel</button>
    </div>
  {:else if step === 'where'}
    <p class="lead">
      <strong>{going.length}</strong> {scope} {going.length === 1 ? 'row' : 'rows'}, out of
      this sheet and into another. Their colour, their links and what they had already
      promoted travel with them.
    </p>

    <label class="row">
      <span>Into</span>
      <select class="input" value={to} aria-label="The sheet to move them into"
              onchange={(event) => (to = event.currentTarget.value)}>
        {#each others as sheet (sheet.id)}
          <option value={sheet.id}>{sheet.title} · {sheet.rows} rows</option>
        {/each}
      </select>
    </label>

    <!-- The lot, said row by row. "Forty rows" that turn out to be the wrong forty is the
         one thing this must not do, and the grid's selection is a drag away from being
         every row on screen. -->
    <button class="review" onclick={() => (reviewing = !reviewing)}>
      <Icon name={reviewing ? 'chevronDown' : 'chevronRight'} size={12} />
      {reviewing ? 'Hide the rows' : `Review the ${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`}
      {#if dropped.size}<span class="held">{dropped.size} kept back</span>{/if}
    </button>
    {#if reviewing}
      <ul class="rows">
        {#each rows as row (row.key)}
          <li class:out={dropped.has(row.key)}>
            <label>
              <input type="checkbox" checked={!dropped.has(row.key)}
                     onchange={() => toggle(row.key)} />
              <span class="dot c-{row.colour ?? 'none'}"></span>
              <span class="what">{row.label || row.key}</span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="modal-row">
      <div class="spacer"></div>
      <button class="btn" onclick={onclose}>Cancel</button>
      <button class="btn btn-primary" disabled={!to || !going.length} onclick={next}>
        Next
      </button>
    </div>
  {:else}
    <p class="lead">
      <strong>{going.length}</strong> {going.length === 1 ? 'row' : 'rows'} into
      <strong>{target?.title}</strong>. A column with nothing in front of it stays behind.
    </p>

    <ul class="pairs">
      {#each pairs as pair (pair.name)}
        <li>
          <span class="mine">{pair.name}</span>
          <Icon name="arrowRight" size={12} />
          <select class="input" value={pair.to} aria-label="Where {pair.name} lands"
                  onchange={(event) => point(pair.name, event.currentTarget.value)}>
            <option value="">Don't move</option>
            {#each theirs as name (name)}
              <option value={name}>{name}</option>
            {/each}
          </select>
          <!-- Said out loud, because `Time` onto `Local time` is right about as often as
               it is wrong and a guess that looks like a match is worse than none. -->
          <span class="guess">{pair.guessed ? 'guessed' : ''}</span>
        </li>
      {/each}
    </ul>

    <p class="note">
      {moving.length} {moving.length === 1 ? 'column moves' : 'columns move'}, {mine.length -
        moving.length} {mine.length - moving.length === 1 ? 'stays' : 'stay'} behind.
      {#if empty.length}Left empty over there: {empty.join(', ')}.{/if}
    </p>

    <div class="modal-row">
      <button class="btn" onclick={() => (step = 'where')}>Back</button>
      <div class="spacer"></div>
      <button class="btn" onclick={onclose}>Cancel</button>
      <button class="btn btn-primary" disabled={busy || !to || !going.length} onclick={press}>
        {busy ? 'Moving' : `Move ${going.length} ${going.length === 1 ? 'row' : 'rows'}`}
      </button>
    </div>
  {/if}
</div>

<style>
  .move { display: flex; flex-direction: column; min-height: 0; }
  .lead { color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .lead strong { color: var(--text-1); }
  .note { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; padding: 8px 0 0; }
  .hint {
    display: flex; align-items: center; gap: 7px; padding: 14px 4px;
    color: var(--text-3); font-size: var(--fs-sm); line-height: 1.5;
  }
  .row {
    display: grid; grid-template-columns: minmax(0, 1fr) 190px; align-items: center;
    gap: 8px; padding: 10px 0 3px;
  }
  .row span { color: var(--text-2); font-size: var(--fs-sm); }
  .review {
    display: flex; align-items: center; gap: 6px; margin-top: 10px; padding: 4px 0;
    border: 0; background: transparent; color: var(--text-3);
    font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .review:hover { color: var(--text-1); }
  .held { color: var(--warn); }
  .rows {
    max-height: 210px; overflow-y: auto; margin: 4px 0 0; padding: 0; list-style: none;
    border: 1px solid var(--border); border-radius: var(--r-sm);
  }
  .rows li { border-bottom: 1px solid var(--border); }
  .rows li:last-child { border-bottom: 0; }
  .rows label {
    display: flex; align-items: center; gap: 8px; padding: 6px 10px;
    font-size: var(--fs-sm); cursor: pointer;
  }
  .rows li.out .what { color: var(--text-3); text-decoration: line-through; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--mark, transparent); }
  .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pairs {
    max-height: 300px; overflow-y: auto; margin: 12px 0 0; padding: 0; list-style: none;
  }
  .pairs li {
    display: grid; grid-template-columns: minmax(0, 1fr) 12px 190px 58px;
    align-items: center; gap: 8px; padding: 4px 0;
  }
  .mine {
    color: var(--text-1); font-size: var(--fs-sm);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .guess { color: var(--text-3); font-size: var(--fs-xs); }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .spacer { flex: 1; }
</style>
