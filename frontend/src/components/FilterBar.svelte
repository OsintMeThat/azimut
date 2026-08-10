<script>
  /**
   * The question the Board is asking, as a bar that never changes shape.
   *
   * What it replaces: seven selects in a row, four of which appeared and disappeared
   * as the others were set. Every fault of that bar came from the same place —
   * nothing said which terms were live, and a control that vanished took its own way
   * back with it, so the most useful filter in the app (`kind`) was invisible until
   * you happened to narrow by type first.
   *
   * Here the bar is three fixed parts: the search, one **+ Filter** menu, and the
   * chips the question is made of. An axis that cannot be asked yet stays in the menu
   * **with its reason written next to it** rather than disappearing, because a
   * control you can see and cannot use teaches something, and one that is not there
   * teaches nothing.
   *
   * The menu opens on four **Questions** — the ones every case is asked — and picking
   * one drops its terms in as ordinary chips. That is the whole of the onboarding:
   * the answer arrives, and the sentence that produced it is sitting there to edit.
   *
   * Every menu is built from what the case holds and counted, so a term says how much
   * of an answer it is before it is chosen (`lib/entityFilter.js`).
   */
  import {
    ADDED,
    AXES,
    QUESTIONS,
    STATUSES,
    chipsOf,
    clearAxis,
    emptyFilter,
    hasTerm,
    isFiltering,
    toggleValue,
  } from '../lib/entityFilter.js';
  import Icon from './Icon.svelte';

  let {
    filter = $bindable(),
    /** `{ total, by_type, by_status, by_folder, by_source, unlinked }`, or null. */
    summary = null,
    /** The fields the narrowed types hold, as `/catalog/attributes` answers. */
    facets = [],
    /** Whether those facets are for the whole case or still being fetched. */
    facetState = 'ready', // 'ready' | 'loading' | 'narrow-first'
    /** Types the case actually holds, in menu order: `[{ type, label, family }]`. */
    types = [],
    families = [],
    /** Every folder the case declares, including the ones holding nothing yet. The
     *  summary can only report the folders that hold rows, so a parent whose contents
     *  all sit in its children is missing from it. */
    caseFolders = [],
    familyName = (family) => family,
    typeName = (type) => type,
    /** The registry's own clause for a family and for a type. The vocabulary explains
     *  itself where the word appears (UI.md), and these are the two menus that offer
     *  words an analyst never types. */
    familyHint = () => '',
    typeHint = () => '',
    /** Snapshots keep the captured answer immutable. The bar stays visible so the
     *  analyst can read the question, but none of its terms can be changed. */
    disabled = false,
    /** Called the first time the Field axis is opened, so nothing is scanned on
     *  mount for a menu nobody asked for. */
    onfields = () => {},
  } = $props();

  /** Which axis has its popover open, or '' for none. The menu itself is `'+'`. */
  let open = $state('');

  $effect(() => {
    if (disabled) open = '';
  });

  const chips = $derived(chipsOf(filter, { type: typeName, family: familyName }));
  const filtering = $derived(isFiltering(filter));

  /**
   * The folder tree, every level of it.
   *
   * Built from three sources on purpose, because each one alone leaves a hole. The
   * summary counts only folders that hold rows **directly**, so a parent whose whole
   * contents sit in its children — `Sources` over `Sources/Accounts` — never appeared
   * at all, and "include subfolders" had nothing to be ticked on. The case's own list
   * adds the folders that exist and hold nothing yet. And every path implies its
   * ancestors, which covers a folder neither list happens to name.
   *
   * `direct` is what the folder holds itself, `under` what it holds with everything
   * below it. The two are genuinely different numbers and the menu shows whichever
   * the chip is currently reading.
   */
  const folders = $derived.by(() => {
    const direct = new Map(Object.entries(summary?.by_folder ?? {}));
    const paths = new Set([...direct.keys(), ...caseFolders]);
    for (const path of [...paths]) {
      const parts = path.split('/');
      for (let cut = 1; cut < parts.length; cut += 1) paths.add(parts.slice(0, cut).join('/'));
    }
    const rows = [...paths].filter(Boolean).sort((a, b) => a.localeCompare(b));
    return rows.map((path) => {
      const parts = path.split('/');
      return {
        path,
        name: parts.at(-1),
        depth: parts.length - 1,
        direct: direct.get(path) ?? 0,
        under: rows
          .filter((other) => other === path || other.startsWith(`${path}/`))
          .reduce((sum, other) => sum + (direct.get(other) ?? 0), 0),
      };
    });
  });
  const unfiledCount = $derived(
    Math.max(
      (summary?.total ?? 0) -
        Object.values(summary?.by_folder ?? {}).reduce((sum, count) => sum + count, 0),
      0
    )
  );
  const filers = $derived(
    Object.entries(summary?.by_source ?? {}).sort((a, b) => b[1] - a[1])
  );
  /** Only the types the case holds: offering "type: vessel" in a case with no vessel
   *  is offering an empty answer. */
  const held = $derived(types.filter((entry) => summary?.by_type?.[entry.type]));
  /**
   * The types something is actually **joined to**, with how many rows join them.
   *
   * A different question from what the case holds, and the counts differ by a lot:
   * four media pointing at one place is one place and four linked rows. The filter
   * asks the second, so the menu prices the second — and a type nothing links to is
   * left out, since asking it could only answer nothing.
   */
  const reachable = $derived(
    types
      .filter((entry) => summary?.linked_to?.[entry.type])
      .map((entry) => ({ ...entry, count: summary.linked_to[entry.type] }))
  );
  /** How many rows each family covers, summed off the per-type counts rather than
   *  asked for again: a family is its types, and the summary already holds them. */
  const familyCount = $derived((family) =>
    types
      .filter((entry) => entry.family === family)
      .reduce((sum, entry) => sum + (summary?.by_type?.[entry.type] ?? 0), 0)
  );
  const fields = $derived(facets.filter((row) => row.values.length));
  const values = $derived(fields.find((row) => row.key === filter.attrKey)?.values ?? []);

  /** What each axis is worth right now, or the reason it cannot be asked yet. Said
   *  in the menu rather than by leaving the row out. */
  function axisState(axis) {
    if (axis === 'field') {
      // Only a case too large for the menu to be readable asks for a type first.
      // Everything else opens: the fields are read on this click, which is the whole
      // point of the change — gated behind a type, `kind` was invisible.
      if (facetState === 'narrow-first') return { off: true, note: 'pick a type first' };
      if (facetState === 'loading') return { off: false, note: 'reading…' };
      if (facetState === 'unasked') return { off: false, note: '' };
      return fields.length
        ? { off: false, note: `${fields.length} fields` }
        : { off: true, note: 'no stored fields here' };
    }
    if (axis === 'linked') {
      return reachable.length
        ? { off: false, note: `${reachable.length} types` }
        : { off: true, note: 'nothing is linked yet' };
    }
    if (axis === 'connections') {
      const loose = summary?.unlinked ?? 0;
      return loose ? { off: false, note: String(loose) } : { off: true, note: 'all connected' };
    }
    if (axis === 'folder') {
      return folders.length || unfiledCount
        ? { off: false, note: folders.length ? `${folders.length} folders` : '' }
        : { off: true, note: 'nothing filed yet' };
    }
    if (axis === 'by') {
      return filers.length > 1
        ? { off: false, note: `${filers.length} filers` }
        : { off: true, note: 'all filed the same way' };
    }
    if (axis === 'type') return { off: !held.length, note: `${held.length} in this case` };
    if (axis === 'family') return { off: !families.length, note: `${families.length}` };
    return { off: false, note: '' };
  }

  /** How many the case holds under one Question, where the summary can answer
   *  honestly. A range needs a query, so it says nothing rather than a wrong number. */
  function questionCount(id) {
    if (id === 'review') return summary?.by_status?.suggested ?? 0;
    if (id === 'loose') return summary?.unlinked ?? 0;
    if (id === 'unfiled') return unfiledCount;
    return null;
  }

  /**
   * Open an axis, or act on it directly when there is nothing to pick.
   *
   * A toggle has no menu — its whole act is being chosen — so opening a popover for
   * it would be a click that asks a question with one answer.
   */
  function chose(axis) {
    if (axis === 'connections') {
      filter = { ...filter, connections: filter.connections === 'none' ? '' : 'none' };
      open = '';
      return;
    }
    if (axis === 'field') onfields();
    open = axis;
  }

  /**
   * Pick a folder, and read a parent as the subtree it stands for.
   *
   * A folder holding nothing itself can only mean everything under it — `Sources` over
   * its four children is a heading, not a bucket — so choosing one turns the subfolder
   * reach on rather than answering with an empty table. The tick stays on screen and
   * still switches, because the analyst may have meant the empty folder itself.
   */
  function pickFolder(row) {
    const same = filter.folder === row.path;
    filter = {
      ...filter,
      folder: same ? '' : row.path,
      unfiled: false,
      recursive: same ? false : filter.recursive || (!row.direct && row.under > 0),
    };
  }

  function ask(id) {
    const question = QUESTIONS.find((entry) => entry.id === id);
    filter = { ...filter, ...question.terms };
    open = '';
  }

  function clearAll() {
    filter = emptyFilter();
    open = '';
  }

  /**
   * A press anywhere but inside what is open closes it.
   *
   * Scoped to the **open** control rather than to the bar, which is the difference
   * between a menu that closes and one that seems stuck: pressing the search box, or
   * another chip, is as much "somewhere else" as pressing the table. Bound on the
   * window rather than on a backdrop element, so nothing invisible sits over the rest
   * of the screen swallowing the first click.
   */
  function onWindowPointerDown(event) {
    if (!open) return;
    if (event.target.closest?.('.anchor.live')) return;
    open = '';
  }
</script>

<svelte:window
  onpointerdown={onWindowPointerDown}
  onkeydown={(event) => event.key === 'Escape' && (open = '')}
/>

<div class="filter-bar">
  <div class="line">
    <div class="search-box">
      <Icon name="search" size={13} />
      <input
        class="search-input"
        type="search"
        placeholder="Search the case…"
        aria-label="Search the case"
        {disabled}
        bind:value={filter.q}
      />
    </div>

    <div class="anchor" class:live={open === '+'}>
      <button
        class="btn btn-sm add"
        aria-expanded={open === '+'}
        {disabled}
        title="Narrow the case: a stored field such as kind = video, a type, a folder, a date"
        onclick={() => (open = open === '+' ? '' : '+')}
      >
        <Icon name="plus" size={12} /> Filter
      </button>
      {#if open === '+'}
        <div class="pop wide">
          <p class="heading">Questions</p>
          <ul>
            {#each QUESTIONS as question (question.id)}
              {@const count = questionCount(question.id)}
              <li>
                <button title={question.hint} onclick={() => ask(question.id)}>
                  <span class="what">
                    {question.label}
                    {#if count != null}<em>{count}</em>{/if}
                  </span>
                  <span class="why">{question.hint}</span>
                </button>
              </li>
            {/each}
          </ul>
          <p class="heading">Narrow by</p>
          <ul>
            {#each AXES as axis (axis.key)}
              {@const state = axisState(axis.key)}
              <li>
                <!-- Present and disabled, never absent: an axis that vanishes when it
                     cannot be asked takes its own explanation with it. Two lines,
                     because a name and a count do not say what a term does — and not
                     knowing what to click is the fault this menu exists to fix. -->
                <button
                  disabled={state.off}
                  title={state.off ? `${axis.hint} — ${state.note}` : axis.hint}
                  onclick={() => chose(axis.key)}
                >
                  <span class="what">
                    {axis.label}
                    {#if state.note}<em>{state.note}</em>{/if}
                  </span>
                  <span class="why">{axis.hint}</span>
                </button>
              </li>
            {/each}
          </ul>
        </div>
      {/if}
    </div>

    {#if filtering}
      <button
        class="btn btn-ghost btn-sm"
        title="Drop every term and the search with them"
        {disabled}
        onclick={clearAll}
      >
        Clear all
      </button>
    {/if}
  </div>

  {#if chips.length}
    <div class="line chips">
      {#each chips as chip (chip.axis)}
        {@const axis = AXES.find((entry) => entry.key === chip.axis)}
        <div class="anchor" class:live={open === chip.axis}>
          <span class="chip" class:open={open === chip.axis}>
            <button
              class="chip-open"
              aria-expanded={open === chip.axis}
              {disabled}
              title="{axis?.hint ?? ''} — click to change it"
              onclick={() => chose(chip.axis)}
            >
              {chip.text}
            </button>
            <button
              class="chip-drop"
              aria-label="Remove this filter"
              {disabled}
              title="Drop this term"
              onclick={() => (filter = clearAxis(filter, chip.axis))}
            >
              <Icon name="x" size={11} />
            </button>
          </span>
          {#if open === chip.axis}
            {@render popover(chip.axis)}
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <!-- An axis picked from the menu that carries no chip yet: the popover has to open
       somewhere, and the menu it was picked from has closed. -->
  {#if open && open !== '+' && !hasTerm(filter, open)}
    <div class="line">
      <div class="anchor live">{@render popover(open)}</div>
    </div>
  {/if}
</div>

{#snippet popover(axis)}
  {@const entry = AXES.find((row) => row.key === axis)}
  <div class="pop">
    <!-- Every popover says what it is and what it narrows. It can be opened from the
         menu, where the chip that would explain it does not exist yet, and a bare list
         of values is exactly the "what am I clicking" this bar was built to answer. -->
    <p class="heading titled">
      {entry?.label ?? axis}
      <span>{entry?.hint ?? ''}</span>
    </p>
    {#if axis === 'family'}
      <ul>
        {#each families as family (family)}
          <li>
            <button
              class:on={filter.families.includes(family)}
              title={familyHint(family)}
              onclick={() => (filter = { ...filter, families: toggleValue(filter.families, family) })}
            >
              <span>{familyName(family)}</span>
              <em>{familyCount(family)}</em>
              {#if filter.families.includes(family)}<Icon name="check" size={12} />{/if}
            </button>
          </li>
        {/each}
      </ul>
    {:else if axis === 'type'}
      <ul class="scroll">
        {#each held as entry (entry.type)}
          <li>
            <button
              class:on={filter.types.includes(entry.type)}
              title={typeHint(entry.type)}
              onclick={() => (filter = { ...filter, types: toggleValue(filter.types, entry.type) })}
            >
              <span>{entry.label}</span>
              <em>{summary?.by_type?.[entry.type] ?? 0}</em>
            </button>
          </li>
        {/each}
      </ul>
    {:else if axis === 'folder'}
      <ul class="scroll">
        <li>
          <button
            class:on={filter.unfiled}
            onclick={() =>
              (filter = { ...filter, unfiled: !filter.unfiled, folder: '', recursive: false })}
          >
            <span>Unfiled</span>
            <em>{unfiledCount}</em>
          </button>
        </li>
        {#each folders as row (row.path)}
          <li>
            <!-- Nested as it is nested: these paths run three deep on a worked case,
                 and a flat column of `Sources/Cut short` is a column nobody reads. -->
            <button
              class:on={filter.folder === row.path}
              style="padding-left: {8 + row.depth * 12}px"
              title="{row.path} — {row.direct} here, {row.under} with everything under it"
              onclick={() => pickFolder(row)}
            >
              <span>{row.name}</span>
              <em>{filter.recursive ? row.under : row.direct}</em>
            </button>
          </li>
        {/each}
      </ul>
      {#if filter.folder}
        <label class="check">
          <input
            type="checkbox"
            checked={filter.recursive}
            onchange={(event) => (filter = { ...filter, recursive: event.currentTarget.checked })}
          />
          Include subfolders
        </label>
      {/if}
    {:else if axis === 'status'}
      <ul>
        {#each STATUSES as entry (entry.value)}
          <li>
            <button
              class:on={filter.status === entry.value}
              onclick={() =>
                (filter = {
                  ...filter,
                  status: filter.status === entry.value ? '' : entry.value,
                })}
            >
              <span>{entry.label}</span>
              <em>{summary?.by_status?.[entry.value] ?? 0}</em>
            </button>
          </li>
        {/each}
      </ul>
    {:else if axis === 'field'}
      <!-- Two steps, one term: the field, then one of the values the case holds for
           it. Nothing is asked of the table until the second is chosen, and each step
           says which it is — a list of bare words with no heading is where "I do not
           know what to click" comes from. -->
      {#if facetState === 'loading'}
        <p class="note">Reading what the case stores…</p>
      {:else if facetState === 'narrow-first'}
        <p class="note">Too much to scan. Pick a type first, then come back.</p>
      {:else if !fields.length}
        <p class="note">Nothing here stores a field a menu can offer.</p>
      {:else}
        <p class="heading">1 · which field</p>
        <ul class="scroll">
          {#each fields as row (row.key)}
            <li>
              <button
                class:on={filter.attrKey === row.key}
                title="{row.entities} carry {row.key}"
                onclick={() => (filter = { ...filter, attrKey: row.key, attrValue: '' })}
              >
                <span>{row.key}</span>
                <em>{row.entities}</em>
              </button>
            </li>
          {/each}
        </ul>
        {#if filter.attrKey}
          <p class="heading">2 · which value</p>
          <ul class="scroll">
            {#each values as row (row.value)}
              <li>
                <button
                  class:on={filter.attrValue === row.value}
                  onclick={() =>
                    (filter = {
                      ...filter,
                      attrValue: filter.attrValue === row.value ? '' : row.value,
                    })}
                >
                  <span>{row.value}</span>
                  <em>{row.count}</em>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}
    {:else if axis === 'linked'}
      <ul class="scroll">
        {#each reachable as entry (entry.type)}
          <li>
            <!-- The count is how many rows this term would answer with, not how many
                 of that type the case holds: four media pointing at one place is four
                 here. Pricing it the other way is a number that looks like an answer
                 and is not one. -->
            <button
              class:on={filter.linked === entry.type}
              title="{entry.count} in this case touch a {entry.label.toLowerCase()}"
              onclick={() =>
                (filter = {
                  ...filter,
                  linked: filter.linked === entry.type ? '' : entry.type,
                })}
            >
              <span>a {entry.label.toLowerCase()}</span>
              <em>{entry.count}</em>
            </button>
          </li>
        {/each}
      </ul>
    {:else if axis === 'added'}
      <ul>
        {#each ADDED as range (range.value)}
          <li>
            <button
              class:on={filter.added === range.value}
              onclick={() =>
                (filter = {
                  ...filter,
                  added: filter.added === range.value ? '' : range.value,
                  since: '',
                  until: '',
                })}
            >
              <span>{range.label}</span>
            </button>
          </li>
        {/each}
      </ul>
      <!-- A range typed by hand is absolute and stays where it is put, where a preset
           re-resolves against today on every request. Setting one drops the other. -->
      <div class="dates">
        <label>
          From
          <input
            type="date"
            value={filter.since}
            onchange={(event) =>
              (filter = { ...filter, since: event.currentTarget.value, added: '' })}
          />
        </label>
        <label>
          To
          <input
            type="date"
            value={filter.until}
            onchange={(event) =>
              (filter = { ...filter, until: event.currentTarget.value, added: '' })}
          />
        </label>
      </div>
    {:else if axis === 'by'}
      <ul class="scroll">
        {#each filers as [who, count] (who)}
          <li>
            <button
              class:on={filter.by.includes(who)}
              onclick={() => (filter = { ...filter, by: toggleValue(filter.by, who) })}
            >
              <span>{who}</span>
              <em>{count}</em>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
{/snippet}

<style>
  .filter-bar {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 9px 16px;
    border-bottom: 1px solid var(--border);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .chips {
    gap: 5px;
  }
  /* Every popover hangs off the control that opened it, so nothing has to measure
     the viewport to place a menu. */
  .anchor {
    position: relative;
    display: inline-flex;
  }
  .search-box {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-3);
  }
  .search-box:focus-within {
    border-color: var(--accent);
  }
  .search-input {
    width: 200px;
    border: none;
    background: none;
    outline: none;
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .add {
    gap: 4px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .chip.open {
    border-color: var(--accent);
  }
  .chip-open {
    padding: 3px 4px 3px 10px;
    border: 0;
    background: none;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .chip-drop {
    display: inline-flex;
    padding: 3px 8px 3px 4px;
    border: 0;
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  .chip-drop:hover {
    color: var(--danger);
  }
  .pop {
    position: absolute;
    z-index: 20;
    top: calc(100% + 5px);
    left: 0;
    min-width: 200px;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    box-shadow: var(--shadow-2);
  }
  .pop.wide {
    min-width: 250px;
  }
  .heading {
    margin: 4px 0 2px;
    padding: 0 8px;
    color: var(--text-3);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .pop ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .pop ul.scroll {
    max-height: 220px;
    overflow-y: auto;
  }
  .pop li button {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 4px 8px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-1);
    font: inherit;
    font-size: var(--fs-xs);
    text-align: left;
    cursor: pointer;
  }
  .pop li button > span {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pop li button em {
    color: var(--text-3);
    font-style: normal;
    font-size: 10px;
  }
  /* Two lines for the menu that has to teach: what the term is, then what it does. */
  .pop li button:has(.why) {
    flex-direction: column;
    align-items: stretch;
    gap: 1px;
    padding: 5px 8px;
  }
  .what {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .why {
    color: var(--text-3);
    font-size: 10px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .heading.titled {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin-bottom: 4px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border);
  }
  .heading.titled span {
    color: var(--text-3);
    font-weight: 400;
    letter-spacing: 0;
    text-transform: none;
  }
  .note {
    margin: 2px 0;
    padding: 4px 8px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .pop li button:hover:not(:disabled) {
    background: var(--bg-3);
  }
  .pop li button.on {
    color: var(--accent);
  }
  .pop li button:disabled {
    color: var(--text-3);
    cursor: default;
  }
  .check,
  .dates label {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .dates {
    display: flex;
    flex-direction: column;
  }
  .dates input {
    flex: 1;
    padding: 2px 5px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-1);
    color: var(--text-1);
    font: inherit;
    font-size: var(--fs-xs);
  }
</style>
