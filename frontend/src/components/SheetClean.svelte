<script>
  /**
   * The passes that fix a column that came from somewhere else.
   *
   * Six of them, in one screen, because they are one job: the import arrived with the city
   * and the country in one cell, a trailing space that makes two values out of one, four
   * hundred rows saying a word the analyst has stopped using, and the sources buried in
   * prose. Doing that by hand is where an afternoon goes; doing it in six separate dialogs
   * is where the analyst goes.
   *
   * Every pass **says what it would do before it does it** — how many cells, and the first
   * few as they would come out. That is the whole safety of the screen: a separator chosen
   * wrong turns a column into confetti, and a replace with the case wrong rewrites nothing
   * or everything. There is no regular expression box, deliberately: a pattern with no
   * preview is how a sheet loses a column, and the passes here cover what the binders
   * actually need.
   *
   * It reads the rows **on screen**, filter and all. An analyst who filtered to the twelve
   * rows left to check and then pressed a pass over four hundred would not call that a
   * feature, so the count says which twelve, every time.
   *
   * No rules here: `lib/sheetClean.js` builds every edit and this screen shows them.
   */
  import { untrack } from 'svelte';
  import Icon from './Icon.svelte';
  import {
    CASINGS,
    caseEdits,
    extractTable,
    mergeTable,
    replaceEdits,
    splitPreview,
    splitTable,
    tidyEdits,
  } from '../lib/sheetClean.js';
  import { DEFAULT_SEPARATOR } from '../lib/sheetRoles.js';

  let {
    table,
    meta,
    column,
    /** The columns a pass may write, as `{ name, index }` — the caller has already left
     *  out the handle and the two the app fills. */
    writable = [],
    /** The rows on screen, as table indices. Every cell pass is bounded by this. */
    rows = [],
    mode: opened = 'replace',
    onedits,
    ontable,
    onclose,
  } = $props();

  const PASSES = [
    { id: 'replace', label: 'Find and replace', icon: 'search' },
    { id: 'tidy', label: 'Take the spacing out', icon: 'wand' },
    { id: 'case', label: 'Change the casing', icon: 'text' },
    { id: 'split', label: 'Split into columns', icon: 'layers' },
    { id: 'merge', label: 'Merge with another', icon: 'stack' },
    { id: 'extract', label: 'Lift the links out', icon: 'link' },
  ];

  /** Which pass is on screen. Seeded from the caller and the analyst's from then on: the
   *  heading menu opens this on the pass it named, and the tabs are here to change it.
   *  Read once on purpose — the dialog is built afresh every time it opens. */
  let mode = $state(untrack(() => opened));
  let find = $state('');
  let replace = $state('');
  let matchCase = $state(false);
  let wholeCell = $state(false);
  let everyColumn = $state(false);
  let casing = $state('title');
  let separator = $state(',');
  let keepOriginal = $state(true);
  let mergeWith = $state([]);
  let joiner = $state(' ');
  let what = $state('url');

  const CASE_WORDS = { upper: 'UPPER CASE', lower: 'lower case', title: 'Title Case' };

  /** Which columns a cell pass writes. One column unless the analyst says the sheet, which
   *  is what a replace wants when a word to drop is spread across five of them. */
  const columns = $derived(
    everyColumn && mode === 'replace' ? writable.map((entry) => entry.index) : [column.index],
  );

  const edits = $derived.by(() => {
    if (mode === 'replace') {
      return replaceEdits(table, { columns, rows, find, replace, matchCase, wholeCell });
    }
    if (mode === 'tidy') return tidyEdits(table, columns, rows);
    if (mode === 'case') return caseEdits(table, columns, rows, casing);
    return [];
  });

  const split = $derived(mode === 'split' ? splitPreview(table, column.index, separator) : null);
  const extract = $derived(
    mode === 'extract' ? extractTable(table, meta, column.index, { what }) : null,
  );
  const merged = $derived(
    mode === 'merge' && mergeWith.length
      ? mergeTable(table, meta, [column.index, ...mergeWith], { joiner, keep: keepOriginal })
      : null,
  );

  /** What the press would change, as one line. Said as cells for a pass that rewrites
   *  them and as columns for a pass that grows the table, because those are two different
   *  kinds of consequence. */
  const says = $derived.by(() => {
    if (mode === 'split') {
      if (!(split?.parts >= 2)) return 'Nothing in this column splits on that.';
      const rest = split.over
        ? `, and ${split.over === 1 ? 'one cell keeps' : `${split.over} cells keep`} the rest in the last one`
        : '';
      return `${split.parts} new columns, out of ${split.rows} ${split.rows === 1 ? 'row' : 'rows'}${rest}`;
    }
    if (mode === 'merge') {
      return mergeWith.length ? `One new column: ${merged?.name}` : 'Pick a column to merge with.';
    }
    if (mode === 'extract') {
      return extract?.filled
        ? `One new column, filled on ${extract.filled} ${extract.filled === 1 ? 'row' : 'rows'}`
        : 'No link in this column.';
    }
    return edits.length
      ? `${edits.length} ${edits.length === 1 ? 'cell' : 'cells'} would change`
      : 'Nothing would change.';
  });

  /** Three of them, as they would come out. A count is what to expect; a sample is what
   *  it actually did to the words. */
  const samples = $derived.by(() => {
    if (mode === 'split') return (split?.samples ?? []).map((parts) => parts.join('  ·  '));
    // Read by name rather than by arithmetic: a merge lands after the *last* column it
    // was given, and dropping the originals moves it again.
    if (mode === 'merge') {
      const at = merged?.table.columns.indexOf(merged?.name) ?? -1;
      if (at === -1) return [];
      return (merged?.table.rows ?? []).slice(0, 3).map((row) => row[at]).filter(Boolean);
    }
    if (mode === 'extract') {
      const at = extract?.table.columns.indexOf(extract?.name) ?? -1;
      if (at === -1) return [];
      return (extract?.table.rows ?? []).slice(0, 3).map((row) => row[at]).filter(Boolean);
    }
    return edits.slice(0, 3).map((edit) => `${edit.before || '—'}  →  ${edit.after || '—'}`);
  });

  const ready = $derived.by(() => {
    if (mode === 'split') return (split?.parts ?? 0) >= 2;
    if (mode === 'merge') return Boolean(mergeWith.length);
    if (mode === 'extract') return Boolean(extract?.filled);
    return edits.length > 0;
  });

  const others = $derived(writable.filter((entry) => entry.index !== column.index));

  function toggleMerge(index) {
    mergeWith = mergeWith.includes(index)
      ? mergeWith.filter((entry) => entry !== index)
      : [...mergeWith, index];
  }

  function apply() {
    if (!ready) return;
    if (mode === 'split') {
      const done = splitTable(table, meta, column.index, { separator, keep: keepOriginal });
      ontable(done, `${done.names.length} columns out of “${column.name}”`);
    } else if (mode === 'merge') {
      ontable(merged, `“${merged.name}” written`);
    } else if (mode === 'extract') {
      ontable(extract, `“${extract.name}” written`);
    } else {
      onedits(edits, `${edits.length} ${edits.length === 1 ? 'cell' : 'cells'} rewritten`);
    }
    onclose();
  }
</script>

<div class="clean">
  <div class="passes">
    {#each PASSES as pass (pass.id)}
      <button class="pass" class:on={mode === pass.id} onclick={() => (mode = pass.id)}>
        <Icon name={pass.icon} size={12} />
        <span>{pass.label}</span>
      </button>
    {/each}
  </div>

  <div class="body">
    <p class="subject">
      <strong>{column.name}</strong>
      <span>· {rows.length} {rows.length === 1 ? 'row' : 'rows'} on screen</span>
    </p>

    {#if mode === 'replace'}
      <label class="field">
        <span>Find</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input" autofocus bind:value={find} placeholder="OK en cours" />
      </label>
      <label class="field">
        <span>Write instead</span>
        <input class="input" bind:value={replace} placeholder="in progress" />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={wholeCell} />
        <span>Only where it is the whole cell</span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={matchCase} />
        <span>Match the case</span>
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={everyColumn} />
        <span>In every column, not just this one</span>
      </label>
    {:else if mode === 'tidy'}
      <p class="note">
        Trims the ends and collapses the runs inside to one space, so <code>Kherson&nbsp;</code>
        and <code>Kherson</code> stop being two values. Line breaks stay.
      </p>
    {:else if mode === 'case'}
      <div class="chips">
        {#each CASINGS as entry (entry)}
          <button class="chip" class:on={casing === entry} onclick={() => (casing = entry)}>
            {CASE_WORDS[entry]}
          </button>
        {/each}
      </div>
    {:else if mode === 'split'}
      <label class="field inline">
        <span>Split on</span>
        <input class="input narrow" bind:value={separator} placeholder="," />
      </label>
      <div class="chips">
        {#each [',', ';', '|', DEFAULT_SEPARATOR, ' - ', '/'] as entry (entry)}
          <button class="chip" class:on={separator === entry} onclick={() => (separator = entry)}>
            {entry === ' ' ? 'space' : entry}
          </button>
        {/each}
      </div>
      <label class="check">
        <input type="checkbox" bind:checked={keepOriginal} />
        <span>Keep this column too</span>
      </label>
    {:else if mode === 'merge'}
      <p class="what">And which others</p>
      <div class="chips">
        {#each others as entry (entry.index)}
          <button class="chip" class:on={mergeWith.includes(entry.index)}
                  onclick={() => toggleMerge(entry.index)}>{entry.name}</button>
        {/each}
      </div>
      <label class="field inline">
        <span>Written between them</span>
        <input class="input narrow" bind:value={joiner} placeholder=" " />
      </label>
      <label class="check">
        <input type="checkbox" bind:checked={keepOriginal} />
        <span>Keep the columns it was made from</span>
      </label>
    {:else}
      <div class="chips">
        <button class="chip" class:on={what === 'url'} onclick={() => (what = 'url')}>
          The addresses
        </button>
        <button class="chip" class:on={what === 'host'} onclick={() => (what = 'host')}>
          Just the hosts
        </button>
      </div>
      <p class="note">
        A column of hosts shows how many rows come from the same channel.
      </p>
    {/if}

    <p class="says" class:none={!ready}>{says}</p>
    {#if samples.length}
      <div class="samples">
        {#each samples as sample, index (index)}
          <p class="sample">{sample}</p>
        {/each}
      </div>
    {/if}
  </div>

  <div class="modal-row">
    <div class="spacer"></div>
    <button class="btn" onclick={onclose}>Cancel</button>
    <button class="btn btn-primary" disabled={!ready} onclick={apply}>
      {mode === 'replace' ? 'Replace' : mode === 'split' ? 'Split' : mode === 'merge' ? 'Merge' : 'Apply'}
    </button>
  </div>
</div>

<style>
  .clean { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 14px; }
  .passes {
    display: flex; flex-direction: column; gap: 2px;
    border-right: 1px solid var(--border); padding-right: 10px;
  }
  .pass {
    display: flex; align-items: center; gap: 7px; width: 100%; padding: 6px 7px;
    border-radius: var(--r-sm); color: var(--text-2); text-align: left; font-size: var(--fs-sm);
  }
  .pass:hover { background: var(--bg-2); color: var(--text-1); }
  .pass.on { background: var(--accent-soft); color: var(--accent); }
  .pass span { flex: 1; min-width: 0; }
  .body { min-width: 0; }
  .subject { color: var(--text-1); font-size: var(--fs-sm); margin-bottom: 8px; }
  .subject span { color: var(--text-3); }
  .field { display: block; padding: 4px 0; }
  .field span { display: block; color: var(--text-3); font-size: var(--fs-xs); margin-bottom: 3px; }
  .field .input { width: 100%; }
  .field.inline { display: flex; align-items: center; gap: 8px; }
  .field.inline span { margin: 0; }
  .narrow { width: 80px; text-align: center; font-family: var(--font-mono); }
  .check {
    display: flex; align-items: center; gap: 7px; padding: 4px 1px;
    color: var(--text-2); font-size: var(--fs-xs);
  }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 0; }
  .chip {
    padding: 3px 8px; border: 1px solid var(--border); border-radius: var(--r-sm);
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs);
    font-family: var(--font-mono);
  }
  .chip:hover { border-color: var(--border-strong); color: var(--text-1); }
  .chip.on { border-color: var(--accent); color: var(--accent); }
  .what { color: var(--text-3); font-size: var(--fs-xs); padding-top: 4px; }
  .note { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; padding: 4px 0; }
  .note code { font-family: var(--font-mono); }

  /* What the press would do, in the accent when it would do something. */
  .says {
    margin-top: 12px; padding: 6px 8px; border-radius: var(--r-sm);
    background: var(--accent-soft); color: var(--accent); font-size: var(--fs-xs);
  }
  .says.none { background: var(--bg-2); color: var(--text-3); }
  .samples {
    margin-top: 6px; border: 1px solid var(--border); border-radius: var(--r-sm);
    overflow: hidden;
  }
  .sample {
    padding: 4px 8px; border-bottom: 1px solid var(--border);
    color: var(--text-2); font-size: var(--fs-xs); font-family: var(--font-mono);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sample:last-child { border-bottom: 0; }
  .modal-row { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .spacer { flex: 1; }
</style>
