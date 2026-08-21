<script>
  /**
   * A whole sheet into the case, in one declaration and one press.
   *
   * This replaces four screens that each promoted one thing and none of which could draw
   * an edge — because an edge needs *two* columns and each of them only ever saw one. A
   * binder's line says *this person, in that unit, seen at that point, at this hour*; the
   * case used to get the nodes and lose the sentence.
   *
   * So: **a mode per column**, and then the joins. The modes are the four old roads plus
   * the two halves of the fifth: what a row *is*, what a column's words *are*, the point,
   * the addresses, the hour, and a column naming other rows.
   *
   * **The joins are not drawn by hand.** For every ordered pair of columns that designates
   * something, the vocabulary is asked what it allows between their two types, and only
   * the pairs with an answer are offered. The select shows the *readings* — "is a member
   * of", "has member" — which is what settles the direction without a question about
   * direction. A person and a point have no verb between them, so that pair never appears.
   *
   * Nothing is decided here. The plan comes from the same code the press runs, and the one
   * decision this screen adds is the old one: **a name is not an identity**, so a word the
   * case already holds twice is offered and never merged on its own.
   */
  import Icon from './Icon.svelte';
  import SheetDate from './SheetDate.svelte';
  import { ID_COLUMN } from '../lib/sheet.js';
  import { columnKinds } from '../lib/sheetBuild.js';
  import {
    entityFields,
    entityLabel,
    loadEntityTypes,
    promotableTypes,
  } from '../lib/entityTypes.svelte.js';
  import { entityIcon } from '../lib/entityIcon.js';
  import { loadRelationTypes, relationOptions } from '../lib/relations.svelte.js';

  let {
    table, meta, count, scope = 'ticked', busy = false,
    onpreview, onpass, onanchors, onclose,
  } = $props();

  loadEntityTypes();
  loadRelationTypes();

  /** The modes a column may take, and when the sheet says a column can take one. A mode
   *  offered on a column whose role cannot carry it is a refusal waiting to happen, so the
   *  role decides what is in the select.
   *
   *  Three of them mint one type and only that type, so they are named after it — the
   *  vocabulary's own word, with what the column has to hold beside it. The other two make
   *  whatever type is picked next to them, so they are named after the grain instead. */
  const MODES = [
    { id: 'ignore', label: 'Ignore' },
    { id: 'row', label: 'One entity per row' },
    { id: 'value', label: 'One entity per value' },
    { id: 'point', label: 'Place (coordinates)', role: 'latlon' },
    { id: 'addresses', label: 'Bookmark (links)', role: 'url' },
    { id: 'statement', label: 'Claim (hours)', role: ['when', 'offset'] },
    { id: 'row-edges', label: 'Edges to other rows', role: 'row' },
  ];

  /** The two verbs a column of row names may become. Kept to two rather than the whole
   *  vocabulary: those are what an order of battle is made of. */
  const ROW_VERBS = [
    { id: 'part-of', label: 'is part of' },
    { id: 'member-of', label: 'is a member of' },
  ];

  const CONFIDENCE = [
    { id: '', label: 'Not stated' },
    { id: '3', label: 'Certain' },
    { id: '2', label: 'Probable' },
    { id: '1', label: 'Possible' },
  ];

  const columns = $derived(
    (table?.columns ?? []).filter((name) => String(name).toLowerCase() !== ID_COLUMN),
  );
  const types = $derived(promotableTypes());

  /** Column name -> mode. Everything starts ignored: only what was asked for travels. */
  let modes = $state({});
  /** Column name -> the entity type its mode makes. */
  let picked = $state({});
  /** Attr key -> the column filling it, for the subject's own type. */
  let mapping = $state({});
  let group = $state(false);
  let groupLabel = $state('');
  /** Column name -> the verb a row-names column draws. */
  let rowVerbs = $state({});
  /** `"from›to"` -> `"verb:direction"`, which is what the analyst picked in a pair select. */
  let verbs = $state({});
  let confidence = $state('');
  /** What the embedded hours form reports, or null while it is not ready. */
  let statement = $state(null);
  /** Column -> key -> the entity the analyst attached that row or word to. */
  let attach = $state({});
  /** Column -> Set of keys read in the plan and left alone. */
  let skipped = $state({});

  let plan = $state(null);
  let planning = $state(false);
  let failed = $state('');

  /**
   * What a column holds, declared or read off its cells.
   *
   * Declared wins. Read second, because a sheet imported five minutes ago has no roles on
   * it yet and a column of `48.5, 35.1` is a column of coordinates whether or not anybody
   * has said so — and offering *Place (coordinates)* only once the role is set means the
   * mode is missing exactly when the analyst first wants it.
   *
   * Shared with the build screen (`lib/sheetBuild.js`), because the two would otherwise
   * disagree about the same column the first time either reading was touched.
   */
  const holds = $derived(columnKinds(table, meta));

  /** Which modes this column may take. A role gates the four that need one; `row` and
   *  `value` are always available, because any column of words can name something. */
  function modesFor(name) {
    const kind = holds[name] ?? '';
    return MODES.filter((mode) => {
      if (!mode.role) return true;
      return Array.isArray(mode.role) ? mode.role.includes(kind) : mode.role === kind;
    });
  }

  /** Which types a mode may make. A `place` is the one type a column of words cannot
   *  become: a point is the only identity in this app that is a number, so it is read off
   *  coordinates and never off a name. The server refuses it; this is why it is not there
   *  to be picked in the first place. */
  function typesFor(mode) {
    return mode === 'value' ? types.filter((entry) => entry.type !== 'place') : types;
  }

  const subjectColumn = $derived(
    columns.find((name) => modes[name] === 'row') ?? '',
  );
  const subjectType = $derived(subjectColumn ? picked[subjectColumn] ?? '' : '');
  const valueColumns = $derived(columns.filter((name) => modes[name] === 'value'));
  const pointColumn = $derived(columns.find((name) => modes[name] === 'point') ?? '');
  const addressColumn = $derived(columns.find((name) => modes[name] === 'addresses') ?? '');
  const statementColumn = $derived(columns.find((name) => modes[name] === 'statement') ?? '');
  const edgeColumns = $derived(columns.filter((name) => modes[name] === 'row-edges'));

  /** Every column that ends up designating something, with the type it designates. The
   *  point is a `place` whichever type the subject is, which is what lets a second column
   *  be joined to the ground a row was located on. */
  const pointing = $derived([
    ...(subjectColumn && subjectType ? [{ column: subjectColumn, type: subjectType }] : []),
    ...valueColumns.filter((name) => picked[name]).map((name) => ({ column: name, type: picked[name] })),
    ...(pointColumn && subjectType ? [{ column: pointColumn, type: 'place' }] : []),
  ]);

  /** The ordered pairs the vocabulary has a verb for, each with its readings. A pair with
   *  none is absent rather than shown empty: an empty select is a question with no answer. */
  const pairs = $derived(
    pointing.flatMap((start, at) =>
      pointing.slice(at + 1).map((end) => {
        const options = relationOptions(start.type, end.type);
        return { start, end, options };
      }),
    ).filter((pair) => pair.options.length),
  );

  /** What a pair is joined by, which is the analyst's answer or the vocabulary's when it
   *  leaves no choice. A pair with one legal reading arrives filled in and takes one click
   *  to undo; asking for a confirmation of the only possible answer is asking nothing. */
  function chosen(pair) {
    const key = `${pair.start.column}\u203a${pair.end.column}`;
    if (key in verbs) return verbs[key];
    return pair.options.length === 1
      ? `${pair.options[0].type}:${pair.options[0].direction}`
      : '';
  }

  const fields = $derived(
    subjectType ? entityFields(subjectType).filter((field) => field.kind !== 'geojson') : [],
  );

  function setMode(name, mode) {
    // One subject and one of each row-scoped mode: the second declaration wins and the
    // first goes back to being ignored, rather than a refusal the analyst has to read.
    const single = ['row', 'point', 'addresses', 'statement'];
    const next = { ...modes, [name]: mode };
    if (single.includes(mode)) {
      for (const other of columns) {
        if (other !== name && next[other] === mode) next[other] = 'ignore';
      }
    }
    modes = next;
    if ((mode === 'row' || mode === 'value') && !picked[name]) {
      picked = { ...picked, [name]: types[0]?.type ?? '' };
    }
    if (mode === 'row-edges' && !rowVerbs[name]) {
      rowVerbs = { ...rowVerbs, [name]: ROW_VERBS[0].id };
    }
  }

  // A stale plan is worse than none: one that describes the previous declaration reads as
  // an answer about this one. Attachments go with it, since they are answers to *its*
  // questions.
  $effect(() => {
    void [modes, picked, mapping, group, groupLabel, rowVerbs, verbs, confidence, statement];
    plan = null;
    attach = {};
    skipped = {};
  });

  /**
   * What the declaration is still short of, in one line, or nothing when it is whole.
   *
   * The modes that are *about* something are refused at the door by the server, and a press
   * greyed out with no reason on it is that refusal with the reason taken off. The point is
   * the one worth spelling out: *Place (coordinates)* puts a subject on its ground, so an
   * analyst who wants the points themselves has declared the right column under the wrong
   * mode and nothing on screen says which one is right.
   */
  const missing = $derived.by(() => {
    if (!subjectColumn) {
      if (pointColumn && !addressColumn && !statementColumn) {
        return `Place (coordinates) puts a subject on its ground. For the points themselves, set ${pointColumn} to “One entity per row” and pick Place.`;
      }
      if (pointColumn || addressColumn || statementColumn) {
        return 'A place, a bookmark and a claim are each about something, so one column has to be the subject.';
      }
      return '';
    }
    if (subjectType === 'place' && !pointColumn && holds[subjectColumn] !== 'latlon') {
      return `A place is its coordinates: set the column holding them to “Place (coordinates)”.`;
    }
    return '';
  });

  /** Where a subject that is a place gets its point, when it is its own column. Said rather
   *  than asked for — and it is also where the answer to "how do I name these" belongs,
   *  because the name of a place is whatever column is the subject. */
  const pointFromItself = $derived(
    subjectType === 'place' && !pointColumn && holds[subjectColumn] === 'latlon'
      ? subjectColumn
      : '',
  );

  const ready = $derived(
    Boolean(
      count &&
        !missing &&
        (subjectColumn ? subjectType : true) &&
        (subjectColumn || valueColumns.length) &&
        valueColumns.every((name) => picked[name]),
    ),
  );

  function declaration() {
    return {
      subject: subjectColumn
        ? {
            column: subjectColumn,
            type: subjectType,
            fields: Object.fromEntries(
              Object.entries(mapping)
                .filter(([, column]) => column)
                .map(([attr, column]) => [column, attr]),
            ),
            attach: attach[subjectColumn] ?? {},
            skip: [...(skipped[subjectColumn] ?? [])],
            group,
            group_label: groupLabel.trim() || null,
          }
        : null,
      point: pointColumn,
      addresses: addressColumn,
      values: valueColumns.map((name) => ({
        column: name,
        type: picked[name],
        attach: attach[name] ?? {},
        skip: [...(skipped[name] ?? [])],
      })),
      statement: statementColumn && statement
        ? { ...statement, skip: [...(skipped[statementColumn] ?? [])] }
        : null,
      row_edges: edgeColumns.map((name) => ({ column: name, verb: rowVerbs[name] })),
      joins: pairs.flatMap((pair) => {
        const answer = chosen(pair);
        if (!answer) return [];
        const [verb, direction] = answer.split(':');
        return [
          direction === 'in'
            ? { from: pair.end.column, to: pair.start.column, verb }
            : { from: pair.start.column, to: pair.end.column, verb },
        ];
      }),
      confidence: confidence ? Number(confidence) : null,
    };
  }

  async function look() {
    if (!ready || planning) return;
    planning = true;
    failed = '';
    try {
      plan = await onpreview(declaration());
    } catch (error) {
      failed = error?.message || 'This pass could not be read.';
      plan = null;
    } finally {
      planning = false;
    }
  }

  /** Attach one row or word to something the case already holds, or take that back. Read
   *  again afterwards: attaching changes what the plan says about it. */
  async function attachTo(column, key, entityId) {
    const held = { ...(attach[column] ?? {}) };
    if (entityId) held[key] = entityId;
    else delete held[key];
    attach = { ...attach, [column]: held };
    await lookAgain();
  }

  async function leaveOut(column, key) {
    const held = new Set(skipped[column] ?? []);
    if (!held.delete(key)) held.add(key);
    skipped = { ...skipped, [column]: held };
    await lookAgain();
  }

  /** The plan again, without the effect above wiping it first — an attachment is an answer
   *  to the plan on screen, not a new declaration. */
  async function lookAgain() {
    planning = true;
    try {
      plan = await onpreview(declaration());
    } catch (error) {
      failed = error?.message || 'This pass could not be read.';
    } finally {
      planning = false;
    }
  }

  const WORDS = {
    make: 'New',
    join: 'Attach',
    update: 'Update',
    skip: 'Left out',
    error: 'Cannot read',
  };
  const LAYERS = {
    row: 'Rows',
    value: 'Words',
    statement: 'Statements',
    'row-edges': 'Row edges',
  };

  /** How much the press would write, counted over both layers so the button is not a leap. */
  const willWrite = $derived(
    plan
      ? (plan.entities ?? []).reduce(
          (total, layer) =>
            total + (layer.counts?.make ?? 0) + (layer.counts?.join ?? 0) + (layer.counts?.update ?? 0),
          0,
        ) + (plan.joins ?? []).reduce((total, join) => total + (join.rows ?? 0), 0)
      : 0,
  );
</script>

<div class="to-case">
  <p class="lead">
    <strong>{count}</strong> {scope} {count === 1 ? 'row' : 'rows'}. A row already sent is
    updated; a name the case holds twice is offered, never merged.
  </p>

  <p class="label">What each column is</p>
  <div class="columns">
    {#each columns as name (name)}
      <div class="column">
        <span class="name" title={name}>{name}</span>
        <select class="input" value={modes[name] ?? 'ignore'} aria-label="What {name} is"
                onchange={(event) => setMode(name, event.currentTarget.value)}>
          {#each modesFor(name) as mode (mode.id)}
            <option value={mode.id}>{mode.label}</option>
          {/each}
        </select>
        {#if modes[name] === 'row' || modes[name] === 'value'}
          <select class="input" value={picked[name] ?? ''} aria-label="What {name} becomes"
                  onchange={(event) => (picked = { ...picked, [name]: event.currentTarget.value })}>
            {#each typesFor(modes[name]) as entry (entry.type)}
              <option value={entry.type}>{entry.label}</option>
            {/each}
          </select>
        {:else if modes[name] === 'row-edges'}
          <select class="input" value={rowVerbs[name] ?? ''} aria-label="What {name} draws"
                  onchange={(event) => (rowVerbs = { ...rowVerbs, [name]: event.currentTarget.value })}>
            {#each ROW_VERBS as verb (verb.id)}
              <option value={verb.id}>{verb.label}</option>
            {/each}
          </select>
        {:else}
          <span class="filler"></span>
        {/if}
      </div>
    {/each}
  </div>

  {#if subjectColumn && count > 1}
    <label class="check">
      <input type="checkbox" checked={group}
             onchange={(event) => (group = event.currentTarget.checked)} />
      <span>These rows are one thing, not {count}</span>
    </label>
    {#if group}
      <label class="row">
        <span>Call it</span>
        <input class="input" placeholder="the first row's name" bind:value={groupLabel}
               aria-label="What to call the one entity" />
      </label>
    {/if}
  {/if}

  {#if pointFromItself}
    <p class="note">
      Each place is read from <em>{pointFromItself}</em> and named by what its cell says. To
      name them from another column, make that one the subject and set this one to
      “Place (coordinates)”.
    </p>
  {/if}

  {#if fields.length}
    <p class="label">Which columns fill {entityLabel(subjectType).toLowerCase()} fields</p>
    <div class="fields">
      {#each fields as field (field.key)}
        <label class="row">
          <span title={field.hint ?? ''}>{field.label}</span>
          <select class="input" aria-label={field.label} value={mapping[field.key] ?? ''}
                  onchange={(event) => (mapping = { ...mapping, [field.key]: event.currentTarget.value })}>
            <option value="">—</option>
            {#each columns as name (name)}<option value={name}>{name}</option>{/each}
          </select>
        </label>
      {/each}
    </div>
  {/if}

  {#if statementColumn}
    <p class="label">What <em>{statementColumn}</em> states</p>
    <div class="nested">
      <SheetDate {table} {meta} {count} subject={subjectColumn} {onanchors}
                 onchoices={(answer) => (statement = answer)} />
    </div>
  {/if}

  {#if pairs.length}
    <p class="label">And what joins what. Only the pairs the vocabulary allows.</p>
    <div class="joins">
      {#each pairs as pair (pair.start.column + '›' + pair.end.column)}
        <div class="join">
          <span class="ends">
            <Icon name={entityIcon({ type: pair.start.type })} size={11} />
            {pair.start.column}
            <span class="dash">·</span>
            <Icon name={entityIcon({ type: pair.end.type })} size={11} />
            {pair.end.column}
          </span>
          <select class="input" aria-label="How {pair.start.column} and {pair.end.column} are joined"
                  value={chosen(pair)}
                  onchange={(event) =>
                    (verbs = { ...verbs, [`${pair.start.column}›${pair.end.column}`]: event.currentTarget.value })}>
            <option value="">Not joined</option>
            <!-- Always read from the first column's side, because that is how the registry
                 writes both halves: `member-of` reads "is a member of" and its inverse
                 reads "has member", so one sentence per option and the arrow follows. -->
            {#each pair.options as option (option.type + option.direction)}
              <option value="{option.type}:{option.direction}"
                >{pair.start.column} {option.label} {pair.end.column}</option>
            {/each}
          </select>
        </div>
      {/each}
    </div>

    <label class="row">
      <span>How sure these joins are</span>
      <select class="input" value={confidence} aria-label="How sure these joins are"
              onchange={(event) => (confidence = event.currentTarget.value)}>
        {#each CONFIDENCE as entry (entry.id)}<option value={entry.id}>{entry.label}</option>{/each}
      </select>
    </label>
  {/if}

  {#if missing}
    <p class="note short">{missing}</p>
  {/if}

  {#if failed}
    <p class="failed" role="alert">{failed}</p>
  {/if}

  {#if plan}
    {#each plan.entities ?? [] as layer (layer.mode + layer.column)}
      <div class="layer">
        <p class="layer-head">
          {LAYERS[layer.mode] ?? layer.mode}
          {#if layer.column}<em>{layer.column}</em>{/if}
          {#each ['make', 'join', 'update', 'skip', 'error'] as action (action)}
            {#if layer.counts?.[action]}
              <span class="tally-part {action}">
                <strong>{layer.counts[action]}</strong> {WORDS[action].toLowerCase()}
              </span>
            {/if}
          {/each}
        </p>
        {#if layer.mode === 'row' || layer.mode === 'value' || layer.mode === 'statement'}
          <div class="plan">
            {#each layer.rows as row (row.key)}
              <div class="plan-row {row.action}">
                <span class="mark">{WORDS[row.action]}</span>
                <span class="who">{row.label || row.value || row.subject_label || row.key}</span>
                {#if row.when}
                  <small class="when">{row.when}</small>
                  <small class="why">{row.confidence}</small>
                {:else if row.action === 'update' || row.action === 'join'}
                  <small class="why">{row.entity_label}</small>
                {:else if row.reason}
                  <small class="why">{row.reason}</small>
                {/if}
                <div class="spacer"></div>
                {#if row.candidates?.length}
                  <select class="input tiny" aria-label="Attach {row.label || row.value} to something the case holds"
                          value={attach[layer.column]?.[row.key] ?? ''}
                          onchange={(event) => attachTo(layer.column, row.key, event.currentTarget.value)}>
                    <option value="">Create it</option>
                    {#each row.candidates as candidate (candidate.id)}
                      <option value={candidate.id}>Attach to {candidate.label}</option>
                    {/each}
                  </select>
                {/if}
                <button class="undo" onclick={() => leaveOut(layer.column, row.key)}>
                  {skipped[layer.column]?.has(row.key) ? 'Put back' : 'Leave out'}
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}

    {#each plan.joins ?? [] as join (join.from + join.verb + join.to)}
      <p class="join-plan">
        <span class="who">{join.from} {join.label} {join.to}</span>
        <strong>{join.rows}</strong> {join.rows === 1 ? 'row' : 'rows'}
        {#if join.blocked?.length}
          <small class="why warn">
            {join.blocked.length} without an end: {join.blocked[0].reason}
          </small>
        {/if}
      </p>
    {/each}
  {/if}

  <div class="modal-row">
    <div class="spacer"></div>
    <button class="btn" onclick={onclose}>Cancel</button>
    {#if !plan}
      <button class="btn btn-primary" disabled={!ready || planning} onclick={look}>
        {planning ? 'Reading…' : 'Preview'}
      </button>
    {:else}
      <button class="btn" disabled={planning} onclick={look}>Preview again</button>
      <button class="btn btn-primary" disabled={busy || !willWrite}
              onclick={() => onpass(declaration())}>
        {busy ? 'Sending' : `Send ${willWrite}`}
      </button>
    {/if}
  </div>
</div>

<style>
  .to-case { display: flex; flex-direction: column; min-height: 0; }
  .lead { color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .lead strong { color: var(--text-1); }
  .label { color: var(--text-3); font-size: var(--fs-xs); margin: 12px 0 5px; line-height: 1.5; }
  .note { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; padding: 4px 0; }
  /* What is still missing, apart from what merely happens: one of the two stands between
     the analyst and the button. */
  .short { color: var(--anno-6); }

  .columns { max-height: 210px; overflow: auto; }
  .column {
    display: grid; grid-template-columns: minmax(0, 1fr) 165px 150px;
    align-items: center; gap: 8px; padding: 2px 0;
  }
  .column .name {
    color: var(--text-1); font-size: var(--fs-sm);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .filler { display: block; }

  .row {
    display: grid; grid-template-columns: minmax(0, 1fr) 190px; align-items: center;
    gap: 8px; padding: 3px 0;
  }
  .row span { color: var(--text-2); font-size: var(--fs-sm); }
  .fields { max-height: 170px; overflow: auto; }
  .check { display: flex; align-items: center; gap: 7px; padding: 8px 0 2px; }
  .check span { color: var(--text-2); font-size: var(--fs-sm); }

  /* The hours form, kept whole rather than copied: it is one mode of this press. */
  .nested {
    border-left: 2px solid var(--border); padding-left: 10px; margin: 2px 0 6px;
  }

  .joins { display: flex; flex-direction: column; gap: 3px; }
  .join {
    display: grid; grid-template-columns: minmax(0, 1fr) 250px; align-items: center; gap: 8px;
  }
  .ends {
    display: inline-flex; align-items: center; gap: 4px;
    color: var(--text-2); font-size: var(--fs-sm);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .dash { color: var(--text-3); }

  .failed { color: var(--danger); font-size: var(--fs-sm); margin-top: 10px; }

  /* What the press would do, layer by layer: the counts are read first and the list when
     one of them is surprising. */
  .layer { margin-top: 12px; }
  .layer-head {
    display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
    color: var(--text-3); font-size: var(--fs-xs); margin-bottom: 4px;
  }
  .layer-head em { color: var(--text-2); font-style: normal; }
  .tally-part { color: var(--text-3); }
  .tally-part strong { color: var(--text-1); font-weight: 600; }
  .tally-part.error, .tally-part.error strong { color: var(--danger); }
  .plan {
    max-height: 200px; overflow: auto;
    border: 1px solid var(--border); border-radius: var(--r-sm);
  }
  .plan-row {
    display: flex; align-items: center; gap: 8px; padding: 4px 7px;
    border-bottom: 1px solid var(--border); font-size: var(--fs-xs);
  }
  .plan-row:last-child { border-bottom: 0; }
  .mark {
    flex: none; width: 74px; color: var(--text-3);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .plan-row.make .mark { color: var(--ok); }
  .plan-row.join .mark, .plan-row.update .mark { color: var(--accent); }
  .plan-row.error .mark { color: var(--danger); }
  .who { color: var(--text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .why { color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .why.warn { color: var(--anno-6); }
  .when { color: var(--text-2); white-space: nowrap; }
  .join-plan {
    display: flex; align-items: center; gap: 8px; padding: 3px 0;
    color: var(--text-3); font-size: var(--fs-xs);
  }
  .join-plan strong { color: var(--text-1); }
  .spacer { flex: 1; }
  .tiny { max-width: 190px; font-size: var(--fs-xs); padding: 1px 4px; }
  .undo { flex: none; color: var(--text-3); font-size: var(--fs-xs); }
  .undo:hover { color: var(--accent); text-decoration: underline; }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
</style>
