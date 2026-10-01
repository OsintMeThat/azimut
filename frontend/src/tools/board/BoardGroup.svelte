<script>
  /**
   * One group of the Board: its heading, its rows, and its own "Show more".
   *
   * A subject row reads by what the case says about it: how many events name it, when
   * they fall, and the span they cover. A material row (a file, a Claim, a piece of
   * work) keeps the columns the flat table has always had, since what matters about a
   * capture is where it was filed and when. Each group pages on its own, so a case of
   * three hundred people still shows its places without scrolling past all of them.
   *
   * The Board owns every state here (the question, the ticks, the open row); this only
   * draws one group of the answer and says what was pressed.
   */
  import Icon from '../../components/Icon.svelte';
  import Sparkline from '../../components/Sparkline.svelte';
  import { entityIcon } from '../../lib/entityIcon.js';
  import { entityHint, entityLabel } from '../../lib/entityTypes.svelte.js';
  import { eventWords, spanWords } from '../../lib/boardGroups.js';
  import { formatTemporalValue } from '../../lib/timeline.js';

  let {
    group,
    count = 0,
    open = false,
    rows = [],
    types = [],
    loading = false,
    hasMore = false,
    events = {},
    currentId = null,
    ticked = new Set(),
    busyId = null,
    readOnly = false,
    query = '',
    creatable = [],
    matchReasons,
    thumbUrl,
    folderName,
    created,
    ontoggle,
    onopen,
    ontick,
    onconfirm,
    ondismiss,
    ongraph,
    oncreate,
    onreads,
    onmore,
  } = $props();

  const subject = $derived(group.kind === 'subject');
  /** A group of one type says the type once, in its heading; a column repeating
   *  "Place" nine times is a column that says nothing. */
  const mixed = $derived(types.length > 1);
  const typeWords = $derived(types.map((type) => entityLabel(type)).join(', '));
  const isSuggested = (entity) => entity.provenance?.status === 'suggested';
  const headId = $derived(`board-group-${group.id}`);
  /** The family's colour, the one its nodes wear in the Graph. */
  const tone = $derived(`var(--graph-${group.families[0] ?? 'document'}, var(--text-3))`);
  /** Events are Claims and nothing else: their heading lists no types, and their row
   *  says when the event happened rather than where it was filed. */
  const eventsGroup = $derived(group.id === 'claim');
  const listsTypes = $derived(!eventsGroup);
  const typeColumn = $derived(!eventsGroup && (mixed || !subject));
  /** Why a row answered the search, when it is not its own name: a vehicle found by
   *  its plate says so, and a name that matched needs no saying twice. */
  const reasonOf = (entity) =>
    (matchReasons(entity) ?? []).find((match) => match.key !== 'label') ?? null;
</script>

<section
  class="group"
  class:subject
  class:folded={!open}
  style="--tone: {tone}"
  aria-labelledby={headId}
>
  <div class="head">
    <button
      id={headId}
      class="fold"
      aria-expanded={open}
      title={open ? `Fold ${group.label}` : `Show ${group.label}`}
      onclick={() => ontoggle?.()}
    >
      <span class="chevron" class:open><Icon name="chevronRight" size={12} /></span>
      <span class="dot"></span>
      <span class="title">{group.label}</span>
      <span class="count">{count}</span>
      {#if !open && listsTypes}
        <!-- Folded, the heading says what is inside it. -->
        <span class="types" title={typeWords}>{typeWords}</span>
      {/if}
    </button>
    {#if group.reads}
      <button class="as-link reads" onclick={() => onreads?.(group.reads.tool)}>
        {group.reads.label} <Icon name="chevronRight" size={11} />
      </button>
    {/if}
    {#if subject && creatable.length && !readOnly}
      <button
        class="btn btn-ghost btn-sm new"
        title="New {creatable.map((entry) => entry.label.toLowerCase()).join(' or ')}"
        onclick={() => oncreate?.(creatable[0].type)}
      >
        <Icon name="plus" size={12} /> New
      </button>
    {/if}
  </div>

  {#if open}
    {#if !rows.length}
      <p class="waiting">{loading ? 'Loading…' : 'Nothing here yet.'}</p>
    {:else}
      <table class="rows">
        <colgroup>
          {#if !readOnly}<col class="c-pick" />{/if}
          <col />
          {#if typeColumn}<col class="c-type" />{/if}
          {#if subject}
            <col class="c-n" /><col class="c-spark" /><col class="c-span" />
          {:else}
            <col class={eventsGroup ? 'c-when' : 'c-folder'} /><col class="c-created" />
          {/if}
          <col class="c-go" />
        </colgroup>
        <tbody>
          {#each rows as entity (entity.id)}
            {@const said = events[entity.id]}
            <tr
              data-row-id={entity.id}
              class:current={currentId === entity.id}
              class:suggested={isSuggested(entity)}
              class:busy={busyId === entity.id}
              tabindex="0"
              aria-selected={currentId === entity.id}
              onclick={() => onopen?.(entity)}
              onkeydown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onopen?.(entity);
                }
              }}
            >
              {#if !readOnly}
                <td class="pick">
                  <input
                    type="checkbox"
                    aria-label="Select {entity.label}"
                    checked={ticked.has(entity.id)}
                    onclick={(e) => {
                      e.stopPropagation();
                      ontick?.(entity, e.shiftKey);
                    }}
                  />
                </td>
              {/if}
              <td class="who">
                <span class="lead">
                  {#if entity.thumb}
                    <img class="thumb" src={thumbUrl(entity.thumb)} alt="" loading="lazy" />
                  {:else}
                    <span class="icon"><Icon name={entityIcon(entity)} size={13} /></span>
                  {/if}
                  <span class="name" dir="auto">{entity.label}</span>
                  {#if isSuggested(entity)}
                    <span class="tag" title="a tool proposed this, and nobody has confirmed it">suggested</span>
                    {#if !readOnly}
                      <span class="review">
                        <button
                          class="btn btn-ghost btn-sm act ok"
                          title="Confirm this item"
                          disabled={busyId === entity.id}
                          onclick={(e) => { e.stopPropagation(); onconfirm?.(entity); }}
                        ><Icon name="check" size={12} /></button>
                        <button
                          class="btn btn-ghost btn-sm act no"
                          title="Dismiss this item, recoverable from the trash"
                          disabled={busyId === entity.id}
                          onclick={(e) => { e.stopPropagation(); ondismiss?.(entity); }}
                        ><Icon name="x" size={12} /></button>
                      </span>
                    {/if}
                  {/if}
                </span>
                {#if query.trim() && reasonOf(entity)}
                  {@const match = reasonOf(entity)}
                  <span class="match-reason" title={match.value} dir="auto">
                    {match.label}: {match.value}
                  </span>
                {/if}
              </td>
              {#if typeColumn}
                <td class="type" title={entityHint(entity.type)}>{entityLabel(entity.type)}</td>
              {/if}
              {#if subject}
                <td class="n" title={said ? eventWords(said.events) : ''}>
                  {#if said?.events}{said.events}{:else}<span class="none">—</span>{/if}
                </td>
                <td class="spark">
                  {#if said?.events && said.first}
                    <Sparkline buckets={said.buckets} label="When its events fall across the case" />
                  {/if}
                </td>
                <td class="span">{said ? spanWords(said.first, said.last) : ''}</td>
              {:else if eventsGroup}
                {@const when = formatTemporalValue(entity.attrs?.when ?? '', entity.attrs?.when_zone)}
                <td class="when" class:none={!entity.attrs?.when} title="When it happened, as written">
                  {when.label}
                </td>
                <td class="created" title="When it was noted">{created(entity)}</td>
              {:else}
                <td class="folder">{folderName(entity)}</td>
                <td class="created">{created(entity)}</td>
              {/if}
              <td class="go">
                {#if !readOnly}
                  <button
                    class="btn btn-ghost btn-sm act"
                    aria-label="Show {entity.label} in the graph"
                    title="Show it in the graph, with what it is connected to"
                    onclick={(e) => { e.stopPropagation(); ongraph?.(entity); }}
                  ><Icon name="graph" size={13} /></button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if hasMore}
        <div class="more">
          <span>Showing {rows.length} of {count}</span>
          <button class="btn btn-ghost btn-sm" disabled={loading} onclick={() => onmore?.()}>
            {loading ? 'Loading…' : 'Show more'}
          </button>
        </div>
      {/if}
    {/if}
  {/if}
</section>

<style>
  .group {
    margin-bottom: 6px;
  }
  /* The heading stays put while its rows scroll under it, so a long group still says
     which group it is. */
  .head {
    position: sticky;
    top: 0;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 0 2px;
    background: var(--bg-1);
    border-bottom: 1px solid var(--border);
  }
  .fold {
    display: flex;
    flex: 1;
    align-items: center;
    gap: 8px;
    min-width: 0;
    padding: 6px 0;
    border: 0;
    background: none;
    color: var(--text-1);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .chevron {
    display: inline-flex;
    color: var(--text-3);
    transition: transform 120ms var(--ease);
  }
  .chevron.open {
    transform: rotate(90deg);
  }
  .dot {
    width: 8px;
    height: 8px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--tone);
  }
  .title {
    color: var(--text-2);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .subject .title {
    color: var(--text-1);
  }
  .count {
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-variant-numeric: tabular-nums;
  }
  .types {
    overflow: hidden;
    min-width: 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .types::before {
    content: '·';
    margin-right: 8px;
  }
  /* The material reads quieter than the subjects, folded or not: it is what the case
     is built from, not what it is about. */
  .fold:hover .title,
  .fold:focus-visible .title {
    color: var(--text-1);
  }
  .as-link {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-3);
    font: inherit;
    font-size: var(--fs-xs);
    white-space: nowrap;
    cursor: pointer;
  }
  .as-link:hover {
    color: var(--accent);
  }
  .new {
    color: var(--text-3);
  }
  .new:hover {
    color: var(--text-1);
  }
  .waiting {
    margin: 0;
    padding: 10px 28px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .rows {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: var(--fs-sm);
  }
  .c-pick { width: 28px; }
  .c-type { width: 130px; }
  .c-n { width: 40px; }
  .c-spark { width: 72px; }
  .c-span { width: 150px; }
  .c-folder { width: 150px; }
  .c-when { width: 190px; }
  .c-created { width: 96px; }
  .c-go { width: 36px; }
  td {
    height: 38px;
    padding: 4px 8px 4px 0;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: middle;
  }
  tr {
    cursor: pointer;
    box-shadow: inset 2px 0 0 transparent;
  }
  tr.suggested {
    box-shadow: inset 2px 0 0 color-mix(in srgb, var(--accent) 55%, transparent);
  }
  tr:hover td,
  tr:focus-visible td {
    background: var(--bg-2);
    color: var(--text-1);
  }
  tr:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  /* The row whose Details are open beside the list. */
  tr.current td {
    background: var(--accent-soft);
    color: var(--text-1);
  }
  tr.current {
    box-shadow: inset 2px 0 0 var(--accent);
  }
  tr.busy {
    opacity: 0.5;
  }
  .pick {
    padding-left: 4px;
  }
  .pick input {
    display: block;
    margin: 0;
    cursor: pointer;
    accent-color: var(--accent);
  }
  .lead {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .thumb {
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    object-fit: cover;
    background: var(--bg-2);
  }
  .icon {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex-shrink: 0;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-3);
  }
  /* A subject wears its family's colour, as its node does in the Graph. */
  .subject .icon {
    border-radius: 50%;
    background: color-mix(in srgb, var(--tone) 16%, transparent);
    color: var(--tone);
  }
  .name {
    overflow: hidden;
    color: var(--text-1);
    text-overflow: ellipsis;
  }
  .group:not(.subject) .name {
    color: var(--text-2);
  }
  tr:hover .name,
  tr.current .name {
    color: var(--text-1);
  }
  .match-reason {
    display: block;
    margin: 1px 0 0 34px;
    overflow: hidden;
    color: var(--accent);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
  }
  .tag {
    flex-shrink: 0;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--bg-3);
    color: var(--text-3);
    font-size: 10px;
  }
  .review {
    display: inline-flex;
    flex-shrink: 0;
    gap: 1px;
    opacity: 0.55;
  }
  tr:hover .review,
  tr:focus-within .review {
    opacity: 1;
  }
  .act {
    padding-inline: 5px;
  }
  .act.ok:hover {
    color: var(--ok);
  }
  .act.no:hover {
    color: var(--danger);
  }
  .type,
  .folder,
  .created,
  .span,
  .when {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .created {
    font-family: var(--font-mono);
  }
  td.when {
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  td.when.none {
    color: var(--text-3);
  }
  .n {
    color: var(--text-1);
    font-variant-numeric: tabular-nums;
    text-align: right;
    padding-right: 12px;
  }
  .none {
    color: var(--text-3);
  }
  .span {
    font-variant-numeric: tabular-nums;
  }
  .go {
    padding-right: 0;
    text-align: right;
  }
  .go .act {
    opacity: 0;
    color: var(--text-3);
  }
  tr:hover .go .act,
  tr:focus-within .go .act,
  tr:focus-visible .go .act,
  tr.current .go .act {
    opacity: 1;
  }
  .go .act:hover {
    color: var(--accent);
  }
  .more {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 2px 4px 28px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
</style>
