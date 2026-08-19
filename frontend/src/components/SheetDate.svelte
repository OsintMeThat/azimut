<script>
  /**
   * A column of hours as **statements** the case holds — one mode of the press that sends a
   * sheet to the case.
   *
   * The binders do not hold dates. They hold a reasoning *about* a date across three
   * columns: the hour that was established, the hour that was estimated, and how it was
   * worked out. Copied into one date field that is one number and two lost columns.
   *
   * So this asks for four things and shows what they produce. **The worked example is the
   * point**: `01:57` on a chosen day reads back as the moment that will be stored, so the
   * two answers a file cannot hold — which day a bare clock belongs to, which zone it is
   * written in — are checked by eye instead of by a paragraph explaining them. Everything
   * else folds away, because it has a right default.
   *
   * The subject comes from the pass, and so does the plan and the press: this reports its
   * answers upward and owns none of that.
   */
  import { ID_COLUMN } from '../lib/sheet.js';
  import { parseWhen, whenShape } from '../lib/sheetRoles.js';

  let { table, meta, subject = '', onchoices, onanchors } = $props();

  const CONFIDENCE = [
    { id: 'certain', label: 'Certain' },
    { id: 'probable', label: 'Probable' },
    { id: 'possible', label: 'Possible' },
  ];
  const ROLES = [
    { id: 'occurred', label: 'It happened then' },
    { id: 'observed', label: 'It was seen then' },
    { id: 'valid', label: 'It held then' },
  ];
  const ZONES = [
    { id: '', label: 'Local' },
    { id: 'Z', label: 'UTC' },
  ];

  const columns = $derived(
    (table?.columns ?? []).filter((name) => String(name).toLowerCase() !== ID_COLUMN),
  );
  /** Offset columns, the other road in: rows lined up on one shot, dated the moment it is. */
  const offsets = $derived(columns.filter((name) => meta?.roles?.[name]?.kind === 'offset'));
  /** Columns the sheet already says hold a time, which is what gets picked by default. */
  const timed = $derived(columns.filter((name) => meta?.roles?.[name]?.kind === 'when'));

  let from = $state('columns'); // 'columns' | 'anchor'
  let whenColumn = $state('');
  let estimateColumn = $state('');
  let methodColumn = $state('');
  let placeColumn = $state('');
  let linkColumn = $state('');
  let offsetColumn = $state('');
  let day = $state('');
  let zone = $state('');
  let confidence = $state('probable');
  let timeRole = $state('occurred');
  let more = $state(false);

  // Seeded from what the sheet already declares, so the ordinary case is answered before it
  // is asked: a column with the `when` role is the column of hours.
  $effect(() => {
    if (!whenColumn && timed.length) whenColumn = timed[0];
  });
  $effect(() => {
    if (!offsetColumn && offsets.length) offsetColumn = offsets[0];
  });

  const byAnchor = $derived(from === 'anchor');
  const anchor = $derived(meta?.roles?.[offsetColumn]?.anchor ?? '');
  const anchorAt = $derived(meta?.anchors?.[anchor]?.at ?? '');
  const ready = $derived(
    Boolean(subject && (byAnchor ? offsetColumn : whenColumn || estimateColumn)),
  );

  /** The cells of the chosen column, which is what says whether the file holds a day. */
  const cells = $derived.by(() => {
    const at = (table?.columns ?? []).indexOf(whenColumn || estimateColumn);
    if (at === -1) return [];
    return (table?.rows ?? []).map((row) => row[at] ?? '');
  });
  /** Bare clocks have no date in them, so that is the one answer the sheet has to give. */
  const needsDay = $derived(!byAnchor && cells.length > 0 && whenShape(cells) === 'time');

  /** One row read back as the moment that will be stored. Read with the same parser the
   *  cell editor uses, so what is shown is what the column already means. */
  const example = $derived.by(() => {
    for (const cell of cells) {
      const read = parseWhen(String(cell), meta?.roles?.[whenColumn] ?? {});
      if (!read) continue;
      if (read.shape === 'time') {
        return day ? { cell, moment: `${day} ${read.text}` } : { cell, moment: '' };
      }
      return { cell, moment: read.text.replace('T', ' ') };
    }
    return null;
  });

  function choices() {
    return {
      when_column: byAnchor ? '' : whenColumn,
      estimate_column: byAnchor ? '' : estimateColumn,
      method_column: byAnchor ? '' : methodColumn,
      offset_column: byAnchor ? offsetColumn : '',
      place_column: placeColumn,
      link_column: linkColumn,
      day,
      zone,
      confidence,
      time_role: timeRole,
    };
  }

  $effect(() => onchoices(ready ? choices() : null));
</script>

<div class="date">
  {#if offsets.length}
    <div class="kinds">
      <button class="kind" class:on={!byAnchor} onclick={() => (from = 'columns')}>
        From hours
      </button>
      <button class="kind" class:on={byAnchor} onclick={() => (from = 'anchor')}>
        From a sync point
      </button>
    </div>
  {/if}

  {#if byAnchor}
    <label class="row">
      <span>Synced on</span>
      <select class="input" value={offsetColumn} aria-label="The offset column"
              onchange={(event) => (offsetColumn = event.currentTarget.value)}>
        {#each offsets as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    </label>
    <p class="note">
      {#if !anchor}
        No sync point on this column.
      {:else if anchorAt}
        <em>{anchor}</em> is dated {anchorAt.replace('T', ' ').slice(0, 19)}.
      {:else}
        <em>{anchor}</em> has no time yet, so nothing can be dated from it.
        <!-- The one thing these rows are missing, one press away instead of three screens
             back: they already carry their order, and the shot's own time is what turns
             that into hours. -->
        {#if onanchors}
          <button class="link" onclick={onanchors}>Date it</button>
        {/if}
      {/if}
    </p>
  {:else}
    <label class="row">
      <span>The hour</span>
      <select class="input" value={whenColumn} aria-label="The established hour"
              onchange={(event) => (whenColumn = event.currentTarget.value)}>
        <option value="">—</option>
        {#each columns as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    </label>

    {#if needsDay}
      <label class="row">
        <span>The day it belongs to</span>
        <input class="input" type="date" aria-label="The day these hours belong to"
               bind:value={day} />
      </label>
      <p class="note">These cells hold clocks with no day.</p>
    {/if}

    <label class="row">
      <span>How sure that hour is</span>
      <select class="input" value={confidence} aria-label="How sure the hour is"
              onchange={(event) => (confidence = event.currentTarget.value)}>
        {#each CONFIDENCE as entry (entry.id)}<option value={entry.id}>{entry.label}</option>{/each}
      </select>
    </label>

    {#if example}
      <p class="example">
        <code>{example.cell}</code>
        {#if example.moment}
          → <strong>{example.moment}</strong> {zone === 'Z' ? 'UTC' : 'local'}
        {:else}
          → <em>waiting for the day</em>
        {/if}
      </p>
    {/if}
  {/if}

  <button class="disclose" onclick={() => (more = !more)}>
    {more ? 'Fewer answers' : 'More answers'}
  </button>

  {#if more}
    <div class="folded">
      {#if !byAnchor}
        <label class="row">
          <span>If the hour is an estimate</span>
          <select class="input" value={estimateColumn} aria-label="The estimated hour"
                  onchange={(event) => (estimateColumn = event.currentTarget.value)}>
            <option value="">—</option>
            {#each columns as name (name)}<option value={name}>{name}</option>{/each}
          </select>
        </label>
        <label class="row">
          <span>How it was worked out</span>
          <select class="input" value={methodColumn} aria-label="How it was worked out"
                  onchange={(event) => (methodColumn = event.currentTarget.value)}>
            <option value="">—</option>
            {#each columns as name (name)}<option value={name}>{name}</option>{/each}
          </select>
        </label>
        <label class="row">
          <span>Written in</span>
          <select class="input" value={zone} aria-label="The time zone this column is in"
                  onchange={(event) => (zone = event.currentTarget.value)}>
            {#each ZONES as entry (entry.id)}<option value={entry.id}>{entry.label}</option>{/each}
          </select>
        </label>
      {/if}
      <label class="row">
        <span>What the time says</span>
        <select class="input" value={timeRole} aria-label="What the time says"
                onchange={(event) => (timeRole = event.currentTarget.value)}>
          {#each ROLES as entry (entry.id)}<option value={entry.id}>{entry.label}</option>{/each}
        </select>
      </label>
      <label class="row">
        <span>Where it places them</span>
        <select class="input" value={placeColumn} aria-label="The column holding the place"
                onchange={(event) => (placeColumn = event.currentTarget.value)}>
          <option value="">—</option>
          {#each columns as name (name)}<option value={name}>{name}</option>{/each}
        </select>
      </label>
      <label class="row">
        <span>What they rest on</span>
        <select class="input" value={linkColumn} aria-label="The column holding the sources"
                onchange={(event) => (linkColumn = event.currentTarget.value)}>
          <option value="">—</option>
          {#each columns as name (name)}<option value={name}>{name}</option>{/each}
        </select>
      </label>
    </div>
  {/if}
</div>

<style>
  .date { display: flex; flex-direction: column; }
  .note { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; padding: 2px 0; }
  .link { color: var(--accent); font-size: inherit; text-decoration: underline; }
  .row {
    display: grid; grid-template-columns: minmax(0, 1fr) 190px; align-items: center;
    gap: 8px; padding: 3px 0;
  }
  .row span { color: var(--text-2); font-size: var(--fs-sm); }
  .kinds { display: flex; flex-wrap: wrap; gap: 4px; padding-bottom: 4px; }
  .kind {
    padding: 3px 8px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs);
  }
  .kind:hover { border-color: var(--border-strong); color: var(--text-1); }
  .kind.on { border-color: var(--accent); color: var(--accent); }

  /* One row read back as what will be stored. A worked example beats a rule: nobody can
     check `01:57` against a stored timestamp in their head. */
  .example {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    padding: 5px 0 2px; color: var(--text-3); font-size: var(--fs-xs);
  }
  .example code { color: var(--text-2); }
  .example strong { color: var(--text-1); font-weight: 600; }

  .disclose {
    align-self: flex-start; padding: 5px 0 2px;
    color: var(--text-3); font-size: var(--fs-xs);
  }
  .disclose:hover { color: var(--accent); text-decoration: underline; }
  .folded { padding-bottom: 2px; }
</style>
