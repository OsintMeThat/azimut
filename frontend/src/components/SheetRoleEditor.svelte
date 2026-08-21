<script>
  /**
   * What one column of a sheet is, said in the analyst's words.
   *
   * A role is a **lens, never a validator**. Everything here reads cells and nothing
   * rewrites them, because the file keeps the words and the sidecar keeps what the app
   * knows about them. So a value outside a vocabulary is shown, a coordinate that says
   * `To be found` stays as it is, and this panel reports how much of the column its lens
   * can read rather than refusing the column that does not fit.
   *
   * The vocabulary is a **list of rows**, not a textarea. The textarea was smaller and it
   * hid three things the analyst has to see: which colour a value carries (typed as
   * `done #green`, which nothing on screen taught), how many rows actually hold it, and
   * which words the cells use that the list has never heard of. What the textarea had
   * going for it was that dragging a line reorders the column — the order *is* the
   * ranking the sort reads — so that survives as two buttons per row.
   *
   * Its own component because the column panel is already the busiest control in the app.
   */
  import Icon from './Icon.svelte';
  import { ID_COLUMN } from '../lib/sheet.js';
  import {
    BOOLEAN_DEFAULTS,
    COUNTING_NATURES,
    DEFAULT_SEPARATOR,
    LINKED_NATURES,
    MAX_COUNTED_COLUMNS,
    NUMBER_SUMMARIES,
    ROW_COLOURS,
    STATE_COLOURS,
    STATE_DEFAULTS,
    WHEN_SHAPES,
    detectRole,
    editVocabulary,
    normalizeRole,
    parseLatLon,
    readable,
    sortVocabulary,
    valueColour,
    vocabularyUse,
    whenShape,
  } from '../lib/sheetRoles.js';

  let { table, meta = null, column, role = null, onchange, onanchors = null } = $props();

  /**
   * The kinds, in **two families**, because they are two different promises.
   *
   * A lens changes how the grid reads a column the analyst writes: the file keeps the
   * words either way, and clearing the lens loses nothing. The other two are columns the
   * **app writes into the CSV** — a cell typed there is overwritten on the next save — and
   * offering them in one flat row of ten chips said nothing about which half you were in.
   */
  const READINGS = [
    { id: null, label: 'Text', hint: 'read as written' },
    { id: 'state', label: 'State', hint: 'where the row got to' },
    { id: 'choice', label: 'Values', hint: 'one chip per value' },
    { id: 'boolean', label: 'Yes / no', hint: 'two words, one click to flip' },
    { id: 'number', label: 'Number', hint: 'counted over the rows on screen' },
    { id: 'latlon', label: 'Point', hint: 'lat, lon' },
    { id: 'when', label: 'Date or time', hint: 'a date, a time, or both' },
    { id: 'picture', label: 'Picture', hint: 'a case file or an address, drawn in the cell' },
    { id: 'url', label: 'Source', hint: 'the pages the rows rest on' },
    { id: 'row', label: 'Another row', hint: 'names other rows of this sheet' },
    { id: 'offset', label: 'Offset', hint: 'a time either side of a shared sync point' },
  ];
  const WRITTEN = [
    { id: 'stamped', label: 'Added on', hint: 'the app dates every empty cell here' },
    { id: 'computed', label: 'Answered by the app', hint: 'on the map, or a count over other columns' },
    { id: 'locked', label: 'Held by the case', hint: 'the app writes it and keeps it level with the case' },
  ];
  const KINDS = [...READINGS, ...WRITTEN];

  /** What a computed column can answer. The first needs the graph; the other two are
   *  arithmetic over the row's own cells, which is the one number a comparison grid needs
   *  and the only kind of formula this tool has. */
  const NATURES = [
    { id: 'has_point', label: 'On the map', hint: 'YES when what the row points at has a place' },
    { id: 'filled_of', label: 'How complete', hint: 'how many of the chosen columns are answered' },
    { id: 'yes_of', label: 'Score', hint: 'how many of the chosen columns say yes' },
    { id: 'point', label: 'Its point', hint: 'where the case puts what a column points at' },
    { id: 'relations', label: 'What it is joined to', hint: 'the far end of that entity\'s edges' },
    { id: 'in_case', label: 'Still in the case', hint: 'NO once what the row was built from is deleted' },
  ];

  const SUMMARY_WORDS = {
    none: 'Nothing',
    count: 'How many',
    sum: 'Total',
    mean: 'Average',
    range: 'Lowest to highest',
  };

  const cells = $derived(
    (table?.rows ?? []).map((row) => String(row[column.index] ?? '').trim()).filter(Boolean),
  );
  const suggestion = $derived(detectRole(cells));
  const kind = $derived(role?.kind ?? null);
  const chipped = $derived(kind === 'state' || kind === 'choice' || kind === 'boolean');

  /** How much of the column the chosen lens can actually read. The same rule the filter
   *  menus follow — say how big an answer is before it is acted on — applied to a role:
   *  sending a date column to the Timeline when it can read a third of it is worth
   *  knowing before, not after. */
  const reads = $derived(
    role && !['stamped', 'computed', 'locked'].includes(kind)
      ? readable(table, column.index, role)
      : null,
  );

  /** What the vocabulary is worth against the cells: a count per value, the values
   *  nothing uses, and the words the column holds that the list has never heard of. */
  const use = $derived(chipped ? vocabularyUse(table, column.index, role) : null);

  const dubious = $derived.by(() => {
    if (kind !== 'latlon') return null;
    let coarse = 0;
    for (const value of cells) {
      const point = parseLatLon(value);
      if (point && !point.outOfBounds && point.decimals <= 2) coarse += 1;
    }
    return coarse ? { coarse } : null;
  });

  /** The columns a counting nature may read: every other column the analyst writes. Not
   *  this one — a score counting itself is a number that answers about itself — and not
   *  the row's handle, which is always filled and would add one to every row. */
  const countable = $derived(
    (table?.columns ?? []).filter(
      (name) => name !== column.name && String(name).toLowerCase() !== ID_COLUMN,
    ),
  );
  const counted = $derived(new Set(role?.columns ?? []));
  const counting = $derived(kind === 'computed' && COUNTING_NATURES.includes(role?.of));
  /** A linked nature follows one named column's link, so it needs to be told which — and
   *  "whichever the row points at" would answer about a place column when the analyst
   *  meant the subject one. */
  const linked = $derived(kind === 'computed' && LINKED_NATURES.includes(role?.of));
  /** The anchors this sheet has named, for an offset column to count from. Named here
   *  rather than typed, because an anchor misspelt is an anchor that dates nothing. */
  const anchors = $derived(Object.keys(meta?.anchors ?? {}));

  /** Which value's palette is open, by index. One at a time: seven swatches on forty
   *  rows is a wall, and the colour is looked at far less often than the word. */
  let painting = $state(-1);
  /** The value being typed into the box at the bottom. */
  let adding = $state('');

  function pick(next) {
    if (next === kind) return;
    if (!next) return onchange(null);
    const seed = { kind: next };
    // The four words and the four colours together: a state column is worth having
    // because the grid reads at a glance, and that starts painted rather than paintable.
    if (next === 'state') {
      seed.values = [...STATE_DEFAULTS];
      seed.colours = { ...STATE_COLOURS };
    }
    if (next === 'boolean') seed.values = [...BOOLEAN_DEFAULTS];
    if (next === 'choice') seed.multi = null;
    // The shape is seeded from what the column already holds and then it is the
    // analyst's: a column of bare clocks should not have to be told twice, and an empty
    // one has to be tellable at all.
    if (next === 'when') seed.shape = whenShape(cells);
    // The nature the column had before there were three of them, so an existing sheet
    // reads the same and a new one starts on the answer that needs no setting up.
    if (next === 'computed') seed.of = 'has_point';
    // A cell holding several unit names is what an order of battle looks like, so the
    // separator is on rather than off: the other way round, the first cell read as one
    // name nobody could match.
    if (next === 'row') seed.multi = DEFAULT_SEPARATOR;
    // The sheet's only anchor when there is one, because a column declared against no
    // anchor counts from nothing.
    if (next === 'offset') seed.anchor = anchors.length === 1 ? anchors[0] : '';
    onchange(normalizeRole(seed));
  }

  function patch(fields) {
    onchange(normalizeRole({ ...role, ...fields }));
  }

  /** Every vocabulary edit goes through one call, because they are all the same edit:
   *  a list and a colour map out the other side. */
  function edit(change) {
    patch(editVocabulary(role, change));
  }

  function add() {
    const value = adding.trim();
    if (!value) return;
    adding = '';
    edit({ value });
  }

  /** Take the words the column already uses. The bridge that makes a state column light
   *  up on an imported binder: the file's own eight words — `To be found`, `pass`,
   *  `OK en cours` — become the vocabulary instead of sitting outside a list of four
   *  that were never in this file. */
  function seedFromColumn() {
    const seen = [];
    for (const value of cells) if (!seen.includes(value)) seen.push(value);
    patch({ values: seen.slice(0, 40), colours: role?.colours ?? {} });
  }

  /** Keep what is declared and add what the cells say beside it, so an order already
   *  arranged by hand is not thrown away to catch one stray word. */
  function adoptOutside() {
    patch({
      values: [...(role?.values ?? []), ...use.outside.map((entry) => entry.value)].slice(0, 40),
      colours: role?.colours ?? {},
    });
  }
</script>

<div class="role">
  <p class="what">Type</p>
  {#if suggestion && suggestion !== kind}
    <button class="suggest" onclick={() => pick(suggestion)}>
      <Icon name="wand" size={11} />
      Looks like {KINDS.find((entry) => entry.id === suggestion)?.label.toLowerCase()}
    </button>
  {/if}

  <!-- How to read what the analyst writes. The file keeps the words, so nothing here is
       ever lost by changing the lens or clearing it. -->
  <div class="kinds">
    {#each READINGS as entry (entry.label)}
      <button class="kind" class:on={kind === entry.id} title={entry.hint}
              onclick={() => pick(entry.id)}>{entry.label}</button>
    {/each}
  </div>
  <!-- And the other family: columns the app writes into the CSV. Apart, because a cell
       typed into one of these is overwritten by the next save. -->
  <p class="what">Or let the app write it</p>
  <div class="kinds">
    {#each WRITTEN as entry (entry.label)}
      <button class="kind" class:on={kind === entry.id} title={entry.hint}
              onclick={() => pick(entry.id)}>{entry.label}</button>
    {/each}
  </div>

  {#if reads && reads.unreadable}
    <p class="reads">
      <strong>{reads.unreadable}</strong> of {reads.total} filled
      {reads.unreadable === 1 ? 'cell is' : 'cells are'} not read as
      {KINDS.find((entry) => entry.id === kind)?.label.toLowerCase()}.
    </p>
  {/if}
  {#if dubious}
    <p class="reads">{dubious.coarse} written to 2 decimals, which is about a kilometre.</p>
  {/if}

  {#if chipped}
    <p class="what">
      {kind === 'state' ? 'Values, least done first' : kind === 'boolean' ? 'Yes, then no' : 'Values'}
    </p>
    <div class="vocab">
      {#each role.values ?? [] as value, at (value)}
        <div class="entry">
          <button class="dot c-{valueColour(role, value) ?? 'none'}"
                  class:painted={valueColour(role, value)}
                  title="Paint {value}" aria-label="Paint {value}"
                  onclick={() => (painting = painting === at ? -1 : at)}></button>
          <input class="input word" value={value} aria-label="Value {at + 1}"
                 onkeydown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
                 onblur={(event) => edit({ value: event.currentTarget.value, at })} />
          <small class="held" title="rows holding it">{use?.counts?.[value] ?? 0}</small>
          {#if kind !== 'boolean'}
            <button class="move" title="Move up" aria-label="Move {value} up"
                    disabled={at === 0} onclick={() => edit({ value, at, to: at - 1 })}>
              <Icon name="chevronUp" size={11} />
            </button>
            <button class="move" title="Move down" aria-label="Move {value} down"
                    disabled={at === (role.values?.length ?? 0) - 1}
                    onclick={() => edit({ value, at, to: at + 1 })}>
              <Icon name="chevronDown" size={11} />
            </button>
            <button class="move drop" title="Remove" aria-label="Remove {value}"
                    onclick={() => edit({ value, at, to: -1 })}>
              <Icon name="x" size={11} />
            </button>
          {/if}
        </div>
        {#if painting === at}
          <div class="palette">
            {#each ROW_COLOURS as colour (colour)}
              <button class="dot c-{colour} painted" title={colour} aria-label="Paint {value} {colour}"
                      onclick={() => { edit({ value, at, colour }); painting = -1; }}></button>
            {/each}
            <button class="dot c-none" title="No colour" aria-label="Clear the colour on {value}"
                    onclick={() => { edit({ value, at, colour: null }); painting = -1; }}></button>
          </div>
        {/if}
      {/each}
    </div>

    {#if kind !== 'boolean'}
      <div class="add">
        <input class="input" placeholder="add a value" bind:value={adding} aria-label="Add a value"
               onkeydown={(event) => event.key === 'Enter' && add()} />
        <button class="btn btn-sm" disabled={!adding.trim()} onclick={add}>Add</button>
      </div>
      <div class="vocab-actions">
        <button class="menu-row" onclick={() => patch(sortVocabulary(role))}>
          <Icon name="chevronDown" size={11} /> A → Z
        </button>
        <button class="menu-row" onclick={() => patch(sortVocabulary(role, { desc: true }))}>
          <Icon name="chevronUp" size={11} /> Z → A
        </button>
      </div>
      <button class="menu-row" onclick={seedFromColumn}>
        <Icon name="download" size={12} /> Use the column's own words
      </button>
      {#if use?.outside?.length}
        <button class="menu-row" onclick={adoptOutside}>
          <Icon name="plus" size={12} />
          Add the {use.outside.length}
          {use.outside.length === 1 ? 'word' : 'words'} the cells use and this list does not
        </button>
      {/if}
      {#if use?.unused?.length}
        <p class="menu-note">
          {use.unused.length} declared {use.unused.length === 1 ? 'value is' : 'values are'}
          in no row: {use.unused.join(', ')}.
        </p>
      {/if}
    {/if}
  {/if}

  {#if kind === 'boolean'}
    <!-- A drawing choice, offered where the two words are: the column is the same
         yes/no column either way, and the file holds the same pair. -->
    <label class="check">
      <input type="checkbox" checked={role.tick}
             onchange={(event) => patch({ tick: event.currentTarget.checked })} />
      <span>Draw the cells as a tick box</span>
    </label>
    {#if role.tick}
      <p class="menu-note">
        Ticking writes <code>{role.values?.[0]}</code>, unticking writes
        <code>{role.values?.[1]}</code>, a third click empties the cell.
      </p>
    {/if}
  {/if}

  {#if kind === 'choice'}
    <!-- A yes/no question, then the answer it needs. It used to be one box whose
         placeholder was the word "no", which said neither what a separator was for nor
         that leaving it empty meant one value per cell. -->
    <label class="check">
      <input type="checkbox" checked={Boolean(role.multi)}
             onchange={(event) =>
               patch({ multi: event.currentTarget.checked ? DEFAULT_SEPARATOR : null })} />
      <span>One cell can hold several values</span>
    </label>
    {#if role.multi}
      <label class="field inline">
        <span>Written between them</span>
        <input class="input narrow" aria-label="What separates them" value={role.multi}
               onchange={(event) => patch({ multi: event.currentTarget.value || DEFAULT_SEPARATOR })} />
      </label>
    {/if}
  {/if}

  {#if kind === 'number'}
    <label class="field inline">
      <span>Unit</span>
      <input class="input narrow" aria-label="Unit" value={role.unit ?? ''}
             placeholder="%, €, km"
             onchange={(event) => patch({ unit: event.currentTarget.value })} />
    </label>
    <!-- Where it is written. The heading carries it either way; this says whether every
         cell repeats it, which a column of shares wants and a column of distances
         mostly does not. Offered only once there is a unit to place. -->
    {#if role.unit}
      <label class="check">
        <input type="checkbox" checked={role.unitInCells}
               onchange={(event) => patch({ unitInCells: event.currentTarget.checked })} />
        <span>Write <code>{role.unit}</code> after every cell too</span>
      </label>
    {/if}
    <p class="what">What the footer says about the rows on screen</p>
    <div class="kinds">
      {#each NUMBER_SUMMARIES as entry (entry)}
        <button class="kind" class:on={(role.summary ?? 'sum') === entry}
                onclick={() => patch({ summary: entry })}>{SUMMARY_WORDS[entry]}</button>
      {/each}
    </div>
  {/if}

  {#if kind === 'when'}
    <p class="what">What it holds</p>
    <div class="kinds">
      {#each WHEN_SHAPES as entry (entry)}
        <button class="kind" class:on={role.shape === entry} onclick={() => patch({ shape: entry })}>
          {entry === 'date' ? 'A date' : entry === 'time' ? 'A time' : 'Both'}
        </button>
      {/each}
    </div>
    {#if role.shape !== 'time'}
      <div class="kinds">
        <button class="kind" class:on={role.dayFirst} onclick={() => patch({ dayFirst: true })}>
          03/01 = 3 Jan
        </button>
        <button class="kind" class:on={!role.dayFirst} onclick={() => patch({ dayFirst: false })}>
          03/01 = 1 Mar
        </button>
      </div>
    {/if}
  {/if}

  {#if kind === 'picture'}
    <!-- The one role that reaches the network, so it says so. Nothing is fetched until a
         column is declared one of these, which is the analyst's own action — the rule the
         whole app runs on. -->
    <p class="menu-note">
      Each cell is drawn as its picture. A web address is fetched from its host, which then
      knows this case looked; a case file stays local.
    </p>
  {/if}

  {#if kind === 'url'}
    <!-- Links are already live in any cell without a role. What declaring one buys is a
         promotion that knows which column the sources are in. -->
    <p class="menu-note">
      Promoting files each address as a bookmark that mentions the row's entity.
    </p>
  {/if}

  {#if kind === 'row'}
    <!-- Names and not keys. A file whose links read `r7f3a` is a file the collaborator
         opening it cannot follow, and names are what the binders wrote. -->
    <label class="field inline">
      <span>Which column names them</span>
      <select class="input narrow" aria-label="The column that names the other rows"
              value={role.of ?? ''}
              onchange={(event) => patch({ of: event.currentTarget.value || null })}>
        <option value="">The first column</option>
        {#each countable as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    </label>
    <label class="check">
      <input type="checkbox" checked={Boolean(role.multi)}
             onchange={(event) =>
               patch({ multi: event.currentTarget.checked ? DEFAULT_SEPARATOR : null })} />
      <span>One cell can name several rows</span>
    </label>
    {#if role.multi}
      <label class="field inline">
        <span>Written between them</span>
        <input class="input narrow" aria-label="What separates them" value={role.multi}
               onchange={(event) => patch({ multi: event.currentTarget.value || DEFAULT_SEPARATOR })} />
      </label>
    {/if}
    <p class="menu-note">
      A name that reaches no single row is left as written. Sending the rows to the case
      draws real <code>part-of</code> edges from this column.
    </p>
  {/if}

  {#if kind === 'offset'}
    <label class="field inline">
      <span>Synced on</span>
      <select class="input narrow" aria-label="The sync point this column is synced on"
              value={role.anchor ?? ''}
              onchange={(event) => patch({ anchor: event.currentTarget.value })}>
        <option value="">—</option>
        {#each anchors as name (name)}<option value={name}>{name}</option>{/each}
      </select>
    </label>
    {#if onanchors}
      <button class="menu-row" onclick={onanchors}>
        <Icon name="clock" size={12} /> Sync points…
      </button>
    {/if}
    <p class="menu-note">
      A moment visible in several rows, used to line them up. <code>-00:01:50</code> is before
      it, <code>00:04:04</code> after. Dating the sync point dates every row.
    </p>
  {/if}

  {#if kind === 'stamped'}
    <p class="menu-note">
      Every empty cell is dated on the next save, including rows already in the sheet, and never
      rewritten after that. It goes into the file.
    </p>
  {/if}
  {#if kind === 'locked'}
    <p class="menu-note">
      The case holds this column. Refresh rewrites it, so typing here would be overwritten. The
      cell still opens what it points at.
    </p>
  {/if}
  {#if kind === 'computed'}
    <p class="what">What it answers</p>
    <div class="kinds">
      {#each NATURES as entry (entry.id)}
        <button class="kind" class:on={(role.of ?? 'has_point') === entry.id} title={entry.hint}
                onclick={() => patch({ of: entry.id })}>{entry.label}</button>
      {/each}
    </div>
    {#if counting}
      <!-- The comparison grid's own question: eleven candidates down, six criteria across,
           and the number that says which rows are done or which ones pass. Chosen column by
           column rather than "all of them", because a worklist's private notes column is
           not a criterion. -->
      <p class="what">
        Counted over {counted.size}
        {counted.size === 1 ? 'column' : 'columns'}
      </p>
      <div class="counted">
        {#each countable as name (name)}
          <label class="check tight">
            <input type="checkbox" checked={counted.has(name)}
                   disabled={!counted.has(name) && counted.size >= MAX_COUNTED_COLUMNS}
                   onchange={() =>
                     patch({
                       columns: counted.has(name)
                         ? [...counted].filter((held) => held !== name)
                         : [...counted, name],
                     })} />
            <span>{name}</span>
          </label>
        {/each}
      </div>
      <p class="menu-note">
        {#if !counted.size}
          Nothing is written until a column is ticked.
        {:else if role.of === 'yes_of'}
          A yes/no column answers with its own first word; anywhere else
          <code>yes</code>, <code>x</code>, <code>ok</code> and <code>1</code> count.
        {:else}
          Every ticked column that holds something counts, whatever it holds.
        {/if}
        The bare number goes in the file, so a spreadsheet can sort and total it.
      </p>
    {:else if linked}
      <!-- Where `On the map` answers *whether* the case knows, these answer **what** it
           knows — which is the number that was being copied by hand into the column
           along. The column is named because a sheet can point at the case from more
           than one. -->
      <label class="field inline">
        <span>Following the link in</span>
        <select class="input narrow" aria-label="The column whose link it follows"
                value={role.from ?? ''}
                onchange={(event) => patch({ from: event.currentTarget.value || null })}>
          <option value="">—</option>
          {#each countable as name (name)}<option value={name}>{name}</option>{/each}
        </select>
      </label>
      {#if role.of === 'relations'}
        <label class="field inline">
          <span>Written between them</span>
          <input class="input narrow" aria-label="What separates them" value={role.multi ?? DEFAULT_SEPARATOR}
                 onchange={(event) => patch({ multi: event.currentTarget.value || DEFAULT_SEPARATOR })} />
        </label>
      {/if}
      <p class="menu-note">
        {#if !role.from}
          Nothing is written until a column is chosen.
        {:else if role.of === 'point'}
          The point the case holds for what <code>{role.from}</code> points at. Blank when
          it has none, or when two different points reach it.
        {:else}
          What the case has joined <code>{role.from}</code>'s entity to, one hop out.
        {/if}
      </p>
    {:else if role.of === 'in_case'}
      <p class="menu-note">
        NO once the case stops holding what the row was built from. Rows you typed yourself
        stay blank: they were never built from anything.
      </p>
    {:else}
      <p class="menu-note">YES when the row points at something with a place.</p>
    {/if}
    <p class="menu-note">Read-only in the grid, and written into the file on every save.</p>
  {/if}
</div>

<style>
  .role { border-top: 1px solid var(--border); padding-top: 5px; margin-top: 4px; }
  .what { padding: 6px 7px 4px; color: var(--text-3); font-size: var(--fs-xs); }
  .suggest {
    display: flex; align-items: center; gap: 6px; width: 100%; padding: 5px 7px;
    margin-bottom: 4px; border-radius: var(--r-sm);
    background: var(--accent-soft); color: var(--accent); font-size: var(--fs-xs);
  }
  .kinds { display: flex; flex-wrap: wrap; gap: 3px; padding: 0 3px; }
  .kind {
    padding: 3px 7px; border: 1px solid var(--border); border-radius: var(--r-sm);
    color: var(--text-2); font-size: var(--fs-xs);
  }
  .kind:hover { border-color: var(--border-strong); color: var(--text-1); }
  .kind.on { border-color: var(--accent); color: var(--accent); }
  .reads {
    padding: 5px 7px 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5;
  }
  .reads strong { color: var(--text-1); font-weight: 600; }

  /* One row per value: the word, what it is painted, how many rows hold it, and where it
     sits in the order — which is the ranking the sort reads. */
  .vocab { max-height: 260px; overflow: auto; padding: 0 3px; }
  .entry { display: flex; align-items: center; gap: 4px; padding: 1px 0; }
  .word { flex: 1; min-width: 0; font-size: var(--fs-xs); padding: 2px 5px; }
  .held { flex: none; width: 22px; text-align: right; color: var(--text-3); font-size: var(--fs-xs); }
  .dot {
    flex: none; width: 13px; height: 13px; border-radius: 50%;
    border: 1px solid var(--border-strong); background: var(--bg-2);
  }
  .dot.painted { border-color: var(--mark); background: var(--mark); }
  .move { flex: none; display: flex; color: var(--text-3); padding: 1px; }
  .move:hover:not(:disabled) { color: var(--text-1); }
  .move:disabled { opacity: 0.3; }
  .move.drop:hover { color: var(--danger); }
  .palette {
    display: flex; gap: 4px; padding: 3px 0 5px 17px;
  }
  .add { display: flex; gap: 4px; padding: 6px 3px 2px; }
  .add .input { flex: 1; min-width: 0; font-size: var(--fs-xs); }
  .vocab-actions { display: flex; gap: 4px; }
  .vocab-actions .menu-row { width: auto; flex: 1; }

  .field { display: block; padding: 6px 4px 2px; }
  .field span { display: block; color: var(--text-3); font-size: var(--fs-xs); margin-bottom: 3px; }
  .field.inline { display: flex; align-items: center; gap: 6px; }
  .field.inline span { margin: 0; }
  .narrow { width: 62px; text-align: center; font-family: var(--font-mono); }
  .check {
    display: flex; align-items: center; gap: 7px; padding: 5px 5px 2px;
    color: var(--text-2); font-size: var(--fs-xs);
  }
  .check code { font-family: var(--font-mono); }
  .check.tight { padding: 2px 5px; }
  .check.tight span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* A column per line, scrolled: a sheet may hold sixty and a wrapping row of sixty
     checkboxes is not a list anybody reads. */
  .counted { max-height: 170px; overflow: auto; padding: 0 2px; }
  .menu-row {
    display: flex; align-items: center; gap: 7px; width: 100%; padding: 5px 7px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left; font-size: var(--fs-xs);
  }
  .menu-row:hover { background: var(--bg-2); color: var(--text-1); }
  .menu-note { padding: 6px 7px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
</style>
