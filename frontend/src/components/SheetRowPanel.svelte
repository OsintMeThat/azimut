<script>
  /**
   * One row of a sheet, read down instead of across.
   *
   * The field binders this tool replaces run to fourteen columns and more — a type, a
   * local time, an estimated local time, an upload time, an hour note, a code, a
   * city, coordinates, two links, two synchro offsets — and a grid thirty pixels tall
   * cannot show one row of that. Scrolling sideways to read one case loses the case.
   *
   * So the same row, one field per line, every cell editable, and the links live. It
   * is a second view of the table and not a second store: every change goes back
   * through the same cell edit the grid uses.
   *
   * Two things live here and nowhere else, because both belong to the **row** rather than
   * to any of its cells. The **pieces it carries**: the screenshot of the message giving
   * the hour, the emailed reply — which the binders kept in two whole tabs of pasted
   * images, floating beside the work they were the proof of. They are *referenced*, never
   * copied, because the file is already the case's. And **who points at this row**, when a
   * column names other rows: the other half of an order of battle, derived from the words
   * rather than kept by hand in a second column that drifts.
   */
  import Icon from './Icon.svelte';
  import { ID_COLUMN, linkLabel, urlsIn } from '../lib/sheet.js';
  import {
    DEFAULT_SEPARATOR,
    cycleTick,
    dateSpelling,
    flipBoolean,
    pickerType,
    spellWhen,
    valueColour,
  } from '../lib/sheetRoles.js';

  let {
    table,
    rowIndex,
    rowKey,
    linkOf,
    roles = {},
    attached = [],
    pointedBy = [],
    changes = [],
    onedit,
    onlink,
    onattach,
    ondetach,
    onfindmedia,
    onopenentity,
    onstep,
    onclose,
  } = $props();

  /** Whether the row holds an address at all, since "find what was downloaded from these"
   *  is a question about pages and reads as noise on a row that names none. */
  const holdsLinks = $derived(
    (table.rows[rowIndex] ?? []).some((cell) => urlsIn(cell).length),
  );

  const row = $derived(table.rows[rowIndex] ?? []);
  const fields = $derived(
    (table.columns ?? []).map((name, index) => ({
      name,
      index,
      value: row[index] ?? '',
      isKey: String(name).toLowerCase() === ID_COLUMN,
    })),
  );
  const filled = $derived(fields.filter((field) => !field.isKey && String(field.value).trim()).length);
  const total = $derived(fields.length - 1);

  /**
   * What a column knows, offered here too.
   *
   * The grid gives a status column its four words, a yes/no column a box and a date column
   * a calendar; read down a panel, the same fourteen columns were fourteen bare boxes. So
   * the panel is a worse place to work than the row it is showing, on exactly the columns
   * that were set up carefully. Same helpers as the cell editor, so a word written here and
   * a word written in the grid are the same word.
   */
  const vocabulary = (name) => {
    const role = roles[name];
    return role?.kind === 'state' || role?.kind === 'choice' ? (role.values ?? []) : [];
  };
  /** Whether the app writes this column rather than the analyst. Typing into one of those
   *  is typing into a value the next save overwrites, which the grid already refuses. */
  const appFilled = (name) => ['stamped', 'computed', 'locked'].includes(roles[name]?.kind);
  const held = (field) => {
    const separator = roles[field.name]?.multi;
    return new Set(
      separator
        ? String(field.value).split(separator).map((part) => part.trim()).filter(Boolean)
        : [String(field.value).trim()],
    );
  };

  /** Click a word: put it in, or take it back out. A toggle, because a list is unbuilt as
   *  often as it is built — the same gesture the cell editor's own list answers to. */
  function takeValue(field, word) {
    const separator = roles[field.name]?.multi;
    if (!separator) {
      onedit(rowIndex, field.index, String(field.value).trim() === word ? '' : word);
      return;
    }
    const values = String(field.value)
      .split(separator)
      .map((part) => part.trim())
      .filter(Boolean);
    const at = values.indexOf(word);
    if (at === -1) values.push(word);
    else values.splice(at, 1);
    onedit(rowIndex, field.index, values.join(separator || DEFAULT_SEPARATOR));
  }

  function flip(field) {
    const role = roles[field.name];
    const next = role?.tick ? cycleTick(role, field.value) : flipBoolean(role, field.value);
    onedit(rowIndex, field.index, next);
  }

  /** What the calendar should open on, in the spelling the column already uses. */
  function pickWhen(field, picked) {
    const role = roles[field.name];
    const cells = table.rows.map((line) => line[field.index]);
    onedit(
      rowIndex,
      field.index,
      spellWhen(picked, {
        shape: role?.shape ?? 'date',
        spelling: dateSpelling(cells),
        keep: field.value,
      }),
    );
  }
</script>

<aside class="panel" aria-label="This row, field by field">
  <header>
    <button class="btn btn-ghost btn-sm" title="The row above" onclick={() => onstep(-1)}>
      <Icon name="chevronUp" size={13} />
    </button>
    <button class="btn btn-ghost btn-sm" title="The row below" onclick={() => onstep(1)}>
      <Icon name="chevronDown" size={13} />
    </button>
    <span class="progress">{filled} of {total} filled</span>
    <div class="spacer"></div>
    <button class="btn btn-ghost btn-sm" title="Close" aria-label="Close this row" onclick={onclose}>
      <Icon name="x" size={14} />
    </button>
  </header>

  <div class="fields">
    {#each fields as field (field.name)}
      {@const linked = linkOf(rowIndex, field.name)}
      {@const links = urlsIn(field.value)}
      <div class="field" class:key={field.isKey}>
        <div class="label">
          <span>{field.name}</span>
          {#if linked}
            <button class="mark" title="Open this entity" onclick={() => onopenentity(linked)}>
              <Icon name="link" size={11} />
            </button>
          {/if}
          {#if !field.isKey}
            <button class="mark at" title="Link to an entity" aria-label="Link {field.name} to an entity"
                    onclick={() => onlink(rowIndex, field.index)}>@</button>
          {/if}
        </div>
        {#if field.isKey}
          <p class="handle">{field.value}</p>
        {:else if appFilled(field.name)}
          <!-- Written by the app on every save, so a box here would be a box whose value
               is gone by the next one. The grid refuses the same keystroke. -->
          <p class="written">{field.value || '—'}<small>written by the app</small></p>
        {:else}
          {@const role = roles[field.name]}
          {@const words = vocabulary(field.name)}
          {@const taken = held(field)}
          {#if role?.kind === 'boolean'}
            <!-- Two words is a toggle, in the panel as in the grid. -->
            <button class="answer" class:on={taken.has(role.values?.[0])} onclick={() => flip(field)}>
              <Icon name={taken.has(role.values?.[0]) ? 'check' : 'x'} size={12} />
              <span>{field.value || 'not answered'}</span>
            </button>
          {:else}
            <textarea class="input" rows={String(field.value).includes('\n') ? 3 : 1}
                      aria-label={field.name} value={field.value}
                      onchange={(event) => onedit(rowIndex, field.index, event.currentTarget.value)}
            ></textarea>
          {/if}
          {#if words.length}
            <!-- The column's own words, under the box rather than instead of it: the
                 binders write outside their vocabulary on every page. -->
            <div class="words">
              {#each words as word (word)}
                <button class="word c-{valueColour(role, word) ?? 'none'}"
                        class:tinted={valueColour(role, word)} class:on={taken.has(word)}
                        onclick={() => takeValue(field, word)}>{word}</button>
              {/each}
            </div>
          {/if}
          {#if role?.kind === 'when'}
            <label class="calendar">
              <Icon name="clock" size={12} />
              <input type={pickerType(role.shape ?? 'date')}
                     aria-label="Pick a value for {field.name}"
                     onchange={(event) => pickWhen(field, event.currentTarget.value)} />
            </label>
          {/if}
          {#if links.length}
            <p class="links">
              {#each links as url (url)}
                <a href={url} target="_blank" rel="noreferrer noopener">
                  <Icon name="external" size={11} /> {linkLabel(url)}
                </a>
              {/each}
            </p>
          {/if}
        {/if}
      </div>
    {/each}

    <!-- The pieces the row carries, which is the tab of pasted screenshots the binders
         could not attach to anything. A reference and not a copy: the case already holds
         the file, so nothing new is filed and the bundle does not drift. -->
    <div class="carried">
      <p class="carried-head">
        <Icon name="file" size={11} />
        <span>What this row carries</span>
      </p>
      {#each attached as piece (piece.id)}
        <div class="piece">
          <button class="piece-name" title="Open it" onclick={() => onopenentity(piece.id)}>
            {piece.label || piece.id}
          </button>
          <small>{piece.type}</small>
          <button class="drop" title="Take it off this row"
                  aria-label="Take {piece.label} off this row" onclick={() => ondetach(piece.id)}>
            <Icon name="x" size={11} />
          </button>
        </div>
      {/each}
      <div class="carry-actions">
        <button class="menu-row" onclick={() => onattach(rowKey)}>
          <Icon name="plus" size={11} /> Attach a case file
        </button>
        {#if holdsLinks}
          <!-- The library's imports and this row's links are the same pages twice, and
               nothing joined them: the analyst had the video and the row could not say so. -->
          <button class="menu-row" onclick={() => onfindmedia(rowKey)}>
            <Icon name="download" size={11} /> Find library files from these links
          </button>
        {/if}
      </div>
    </div>

    {#if pointedBy.length}
      <!-- Derived from the words every time rather than kept in a second column: that is
           the column the binders kept by hand, and it had already decayed to `#REF!`. -->
      <div class="carried">
        <p class="carried-head">
          <Icon name="link" size={11} />
          <span>Pointed at by</span>
        </p>
        <p class="pointed">{pointedBy.join(', ')}</p>
      </div>
    {/if}

    {#if changes.length}
      <!-- This session only. A durable log would be a new file beside the CSV, which
           means deciding what the Trash and the bundle do with it — so this says what
           it is rather than pretending to be a history. -->
      <div class="log">
        <p class="log-head">Changed here, this session</p>
        {#each changes.slice().reverse() as change, index (index)}
          <p class="change">
            <span class="log-column">{change.column}</span>
            <s>{change.before || '—'}</s>
            <Icon name="arrowRight" size={10} />
            <b>{change.after || '—'}</b>
          </p>
        {/each}
      </div>
    {/if}
  </div>
</aside>

<style>
  .panel {
    width: 340px; flex: none; display: flex; flex-direction: column; min-height: 0;
    border-left: 1px solid var(--border); background: var(--bg-1);
  }
  header {
    display: flex; align-items: center; gap: 4px; padding: 5px 8px;
    border-bottom: 1px solid var(--border);
  }
  .spacer { flex: 1; }
  .progress { color: var(--text-3); font-size: var(--fs-xs); }
  .fields { flex: 1; min-height: 0; overflow: auto; padding: 4px 10px 14px; }
  .field { padding: 7px 0; border-bottom: 1px solid var(--border); }
  .field:last-child { border-bottom: 0; }
  .label { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
  .label span {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--text-3); font-size: var(--fs-xs);
  }
  .mark { display: flex; color: var(--accent); }
  .mark.at { color: var(--text-3); font-family: var(--font-mono); font-weight: 600; }
  .mark.at:hover { color: var(--accent); }
  .field.key .handle {
    color: var(--text-3); font-family: var(--font-mono); font-size: var(--fs-xs);
  }
  .field textarea { width: 100%; resize: vertical; line-height: 1.45; }
  /* A column the app writes. Shown, never editable: the next save would take the typing
     back without a word. */
  .written {
    display: flex; align-items: baseline; gap: 8px;
    color: var(--text-2); font-size: var(--fs-sm);
  }
  .written small { color: var(--text-3); font-size: var(--fs-xs); }
  /* A yes/no column, answered the way the grid answers it. */
  .answer {
    display: flex; align-items: center; gap: 6px; padding: 4px 8px;
    border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-sm);
  }
  .answer:hover { border-color: var(--border-strong); color: var(--text-1); }
  .answer.on { border-color: var(--ok); color: var(--ok); }
  /* The column's own words. The `.c-*` classes are global and set `--mark`, so a word
     wears here the colour it wears in the cells. */
  .words { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 5px; }
  .word {
    padding: 2px 7px; border-radius: 9px; border: 1px solid var(--border);
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs);
  }
  .word:hover { border-color: var(--border-strong); color: var(--text-1); }
  .word.tinted { color: var(--mark); }
  .word.on {
    border-color: var(--mark, var(--accent)); color: var(--mark, var(--accent));
    background: color-mix(in srgb, var(--mark, var(--accent)) 14%, transparent);
  }
  .calendar {
    display: inline-flex; align-items: center; gap: 5px; margin-top: 5px; padding: 1px 6px;
    border: 1px solid var(--border); border-radius: var(--r-sm); color: var(--text-3);
  }
  .calendar input {
    border: 0; background: none; color: var(--text-1); font-size: var(--fs-xs);
    font-family: inherit;
  }
  .links { display: flex; flex-wrap: wrap; gap: 4px 10px; margin-top: 4px; }
  .links a {
    display: inline-flex; align-items: center; gap: 4px;
    color: var(--accent); font-size: var(--fs-xs);
  }
  .log { margin-top: 14px; padding-top: 8px; border-top: 1px solid var(--border-strong); }
  .log-head { color: var(--text-3); font-size: var(--fs-xs); margin-bottom: 5px; }
  .change {
    display: flex; align-items: center; gap: 5px; padding: 2px 0;
    color: var(--text-2); font-size: var(--fs-xs);
  }
  .change s { color: var(--text-3); }
  .log-column { color: var(--text-3); min-width: 70px; }
  .carried { margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border-strong); }
  .carried-head {
    display: flex; align-items: center; gap: 5px; margin-bottom: 5px;
    color: var(--text-3); font-size: var(--fs-xs);
  }
  .piece { display: flex; align-items: center; gap: 6px; padding: 2px 0; font-size: var(--fs-xs); }
  .piece-name {
    flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--accent); text-align: left;
  }
  .piece small { flex: none; color: var(--text-3); }
  .piece .drop { flex: none; color: var(--text-3); }
  .piece .drop:hover { color: var(--danger); }
  .carry-actions { padding-top: 3px; }
  .menu-row { display: flex; align-items: center; gap: 6px; width: 100%; padding: 4px 2px;
    color: var(--text-2); text-align: left; font-size: var(--fs-xs); border-radius: var(--r-sm); }
  .menu-row:hover { background: var(--bg-2); color: var(--text-1); }
  .pointed { color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
</style>
