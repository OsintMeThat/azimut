<script>
  /**
   * The cards of the site as the last read found them: the Read the site press, a chip per category
   * and kind, and a row each with its picture, title, address, category, kind, date and weight, an
   * Open link and a Delete press. Nothing is asked of GitHub until Read the site, and a delete reaches
   * it on its confirmation only: the dialog says what goes, and the row leaves the list once GitHub
   * has the commit. Only a folder the server says it would delete has the press; the others were
   * made outside Azimut and say so on hover. What the server refuses a delete with is the result line.
   * The rows are a table when the hub is wide, and a list with the facts under each title when not.
   */
  import Icon from '../../../components/Icon.svelte';
  import ConfirmDialog from '../../../components/ConfirmDialog.svelte';
  import GitHubSetupPress from '../../../components/GitHubSetupPress.svelte';
  import { deleteFromSite } from '../../../lib/githubPages.js';
  import { dropFolder, siteRead } from '../../../lib/siteRead.svelte.js';
  import { chipsOf, formatBytes, itemsFor, kindOf, pathOf } from '../../../lib/websiteHub.js';
  import {
    COLUMNS, DELETE_CONFIRM, DELETE_PRESS, DELETE_TITLE, NO_CATEGORY, OPEN_ITEM, OUTSIDE_AZIMUT, READ_FIRST, READ_FIRST_TITLE, READ_NONE, READ_NONE_TITLE,
    TOO_MANY, WEBSITE_HELP as HELP, dayShort, deleteSaid, deletedSaid,
  } from '../../../lib/websiteSetup.js';
  import KindBadge from './KindBadge.svelte';
  import ReadSiteButton from './ReadSiteButton.svelte';

  let { ready = false, github = null, readKey = '' } = $props();

  const KIND_ICON = { article: 'note', map: 'globe', page: 'file', unlisted: 'eyeOff' };

  let filter = $state('all');
  // the row asked to be deleted, until answered
  let confirming = $state(null);
  let deleting = $state(false);
  // what the last delete did: { state, text, warnings, at }
  let deleted = $state(null);
  let setUp = $state('');
  // the pictures that did not load, shown as their kind's mark instead
  let broken = $state({});

  const read = $derived(siteRead.data);
  const repository = $derived(github ? `${github.account}/${github.repo}` : '');
  const chips = $derived(chipsOf(read));
  // a chip that went away with its last row leaves the whole list
  const current = $derived(chips.some((chip) => chip.id === filter) ? filter : 'all');
  const shown = $derived(itemsFor(read, current));
  // a delete is said until the next read
  const said = $derived(deleted && (!siteRead.at || deleted.at >= siteRead.at) ? deleted : null);
  const setUpSaid = $derived(setUp && !siteRead.needs && !said ? { state: 'ok', text: setUp } : null);

  async function confirm() {
    const item = confirming;
    if (!item || deleting) return;
    deleting = true;
    try {
      const answer = await deleteFromSite(item.folder);
      dropFolder(item.folder);
      deleted = { state: 'ok', text: deletedSaid(item.folder, answer), warnings: Array.isArray(answer?.warnings) ? answer.warnings : [], at: new Date() };
    } catch (error) {
      // a folder already gone is gone from the list too; anything else refused keeps its row
      if (error.status === 404) dropFolder(item.folder);
      deleted = { state: 'error', text: error.message, warnings: [], at: new Date() };
    } finally {
      confirming = null;
      deleting = false;
    }
  }

  /** A setup press worked: a new repository has Pages off still, then the site can be read. */
  function after() {
    if (siteRead.needs?.needs === 'repository') {
      siteRead.needs = { needs: 'pages', detail: `The repository is made. Pages is off for ${repository}.` };
      return;
    }
    siteRead.needs = null;
    setUp = 'Pages is on. Press Read the site.';
  }
</script>

<div class="toolbar">
  <ReadSiteButton {ready} {repository} key={readKey} said={said ?? setUpSaid} />
  {#if chips.length}
    <span class="chips" role="group" aria-label="Show">
      {#each chips as chip (chip.id)}
        <button type="button" class="chip" class:on={current === chip.id} aria-pressed={current === chip.id} title={HELP.siteFilter}
          onclick={() => (filter = chip.id)}>{chip.label}<span class="n">{chip.count}</span></button>
      {/each}
    </span>
  {/if}
</div>

{#if siteRead.needs}
  <div class="needs"><GitHubSetupPress needs={siteRead.needs.needs} {github} detail={siteRead.needs.detail} ondone={after} /></div>
{/if}
{#if said?.warnings.length || read?.warnings.length}
  <ul class="hub-warnings" aria-label="To mind">
    {#each [...(said?.warnings ?? []), ...(read?.warnings ?? [])] as warning, index (index)}<li><Icon name="alert" size={12} /> {warning}</li>{/each}
  </ul>
{/if}

{#if !read || read.truncated || !read.items.length}
  <div class="blank">
    <Icon name={read?.truncated ? 'alert' : 'globe'} size={22} />
    {#if !read}
      <b>{READ_FIRST_TITLE}</b><span>{READ_FIRST}</span>
    {:else if read.truncated}
      <b>{TOO_MANY}</b>
    {:else}
      <b>{READ_NONE_TITLE}</b><span>{READ_NONE}</span>
    {/if}
  </div>
{:else}
  <div class="list">
    <div class="item head" aria-hidden="true">
      <span></span><span>{COLUMNS[0]}</span><span>{COLUMNS[1]}</span><span>{COLUMNS[2]}</span><span>{COLUMNS[3]}</span><span class="end">{COLUMNS[4]}</span><span></span>
    </div>
    <ul class="rows" aria-label="What the site holds">
      {#each shown as item (item.folder)}
        {@const kind = kindOf(item)}
        <li class="item" data-folder={item.folder} title={item.deletable ? undefined : HELP.siteDeleteOutside}>
          <span class="th">
            {#if item.image && !broken[item.folder]}
              <img src={item.image} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={() => (broken[item.folder] = true)} />
            {:else}
              <Icon name={KIND_ICON[kind]} size={16} />
            {/if}
          </span>
          <span class="t"><b title={item.title}>{item.title}</b><small title={pathOf(item)}>{pathOf(item)}</small></span>
          <span class="meta">
            <span class="cat" class:muted={!item.category || item.role !== 'article'}>{item.role === 'article' && item.category ? item.category : NO_CATEGORY}</span>
            <span class="kind"><KindBadge {kind} /></span>
            <span class="d" title={item.dateLabel || undefined}>{dayShort(item.date) || item.dateLabel}</span>
            <span class="w">{formatBytes(item.bytes)}</span>
          </span>
          <span class="act">
            {#if item.address}
              <a class="open" href={item.address} target="_blank" rel="noopener noreferrer" title={HELP.siteOpenItem}>{OPEN_ITEM} <Icon name="external" size={11} /></a>
            {/if}
            {#if item.deletable}
              <button type="button" class="btn btn-sm btn-ghost del" onclick={() => (confirming = item)} title={HELP.siteDelete}>{DELETE_PRESS}</button>
            {:else}
              <span class="outside">{OUTSIDE_AZIMUT}</span>
            {/if}
          </span>
        </li>
      {/each}
    </ul>
  </div>
{/if}

{#if confirming}
  <ConfirmDialog title={DELETE_TITLE} message={deleteSaid(confirming.folder, repository)} confirmLabel={DELETE_CONFIRM}
    tone="danger" busy={deleting} onconfirm={confirm} oncancel={() => { if (!deleting) confirming = null; }} />
{/if}

<style>
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-bottom: 12px; min-height: 26px; }
  .toolbar > :global(.read-line) { flex: 1 1 260px; }
  .chips { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; margin-left: auto; }
  .chip { padding: 2px 10px; border: 1px solid var(--border-strong); border-radius: 99px; background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs);
    line-height: 1.5; white-space: nowrap; transition: color 0.12s var(--ease), border-color 0.12s var(--ease), background 0.12s var(--ease); }
  .chip:hover { color: var(--text-1); }
  .chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .n { margin-left: 5px; color: var(--text-3); font-variant-numeric: tabular-nums; }
  .needs { margin: 0 0 12px; }
  .toolbar ~ :global(.hub-warnings) { margin: -4px 0 12px; }

  .blank { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 30px 16px; border: 1px dashed var(--border-strong);
    border-radius: 8px; color: var(--text-3); text-align: center; }
  .blank b { margin-top: 2px; color: var(--text-2); font-size: var(--fs-md); font-weight: 600; }
  .blank span { max-width: 46ch; font-size: var(--fs-sm); }

  /* a list with the facts under each title, a table once the hub has room for its columns */
  .list { container: rows / inline-size; overflow: hidden; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-1); }
  .rows { list-style: none; margin: 0; padding: 0; }
  .item { display: grid; grid-template-columns: 72px minmax(0, 1fr) auto; grid-template-areas: 'th t act' 'th meta act'; gap: 3px 12px; align-items: center;
    padding: 9px 14px; border-top: 1px solid var(--border); font-size: var(--fs-sm); transition: background 0.12s var(--ease); }
  .rows .item:first-child { border-top: 0; }
  .rows .item:hover { background: color-mix(in srgb, var(--bg-2) 60%, transparent); }
  .head { display: none; }
  .th { grid-area: th; display: grid; place-items: center; width: 72px; height: 42px; overflow: hidden; border-radius: 4px;
    background: color-mix(in srgb, var(--text-3) 14%, transparent); color: var(--text-3); }
  .th img { width: 100%; height: 100%; object-fit: cover; }
  .t { grid-area: t; min-width: 0; align-self: end; }
  .t b, .t small { display: block; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .t b { color: var(--text-1); font-weight: 500; }
  .t small { color: var(--text-3); font-family: var(--font-mono); font-size: 0.68rem; }
  .meta { grid-area: meta; display: flex; flex-wrap: wrap; align-items: center; gap: 2px 10px; min-width: 0; align-self: start; color: var(--text-2);
    font-size: var(--fs-xs); }
  .cat { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .cat.muted { color: var(--text-3); font-style: italic; }
  .kind { order: -1; display: inline-flex; }
  .d, .w { color: var(--text-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
  .w { color: var(--text-3); }
  .act { grid-area: act; display: flex; align-items: center; justify-content: flex-end; gap: 6px; font-size: var(--fs-xs); }
  .open { display: inline-flex; align-items: center; gap: 3px; padding: 3px 4px; border-radius: var(--r-sm); color: var(--accent); white-space: nowrap; }
  .open:hover { color: var(--accent-hover); }
  .open:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .del { color: var(--danger); }
  .del:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }
  .del, .outside { min-width: 72px; justify-content: center; }
  .outside { padding: 0 4px; color: var(--text-3); font-size: 0.68rem; line-height: 1.25; text-align: center; white-space: nowrap; cursor: help; }

  /* too narrow for the presses beside the title: they go under the facts */
  @container rows (max-width: 440px) {
    .item { grid-template-columns: 56px minmax(0, 1fr); grid-template-areas: 'th t' 'th meta' 'th act'; }
    .th { width: 56px; height: 34px; align-self: start; }
    .act { justify-content: flex-start; margin-left: -4px; }
  }
  @container rows (min-width: 820px) {
    .item { grid-template-columns: 84px minmax(0, 1fr) 118px 74px 84px 60px 142px; grid-template-areas: none; gap: 14px; }
    .head { display: grid; padding-top: 7px; padding-bottom: 7px; border-top: 0; background: var(--bg-2); color: var(--text-3); font-size: var(--fs-xs); }
    .rows { border-top: 1px solid var(--border); }
    .th, .t, .act { grid-area: auto; }
    .th { width: 84px; height: 46px; }
    .t { align-self: center; }
    .meta { display: contents; }
    .kind { order: 0; }
    .w, .end { text-align: right; }
    .cat, .d { font-size: var(--fs-xs); }
  }
</style>
