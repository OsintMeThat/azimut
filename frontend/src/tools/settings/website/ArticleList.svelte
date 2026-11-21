<script>
  /**
   * The cards of the site as the last read found them: the Read the site press, a chip per category
   * and kind, and a row each with its picture, title, address, category, kind, date and weight, an
   * Open link and a Delete press. Nothing is asked of GitHub until Read the site, and a delete
   * reaches it on its confirmation only: the dialog says what goes, and the row leaves the list once
   * GitHub has the commit. Only a folder the server says it would delete has the press; the others were
   * made outside Azimut and say so. What the server refuses a delete with is the result line.
   */
  import Icon from '../../../components/Icon.svelte';
  import ConfirmDialog from '../../../components/ConfirmDialog.svelte';
  import GitHubSetupPress from '../../../components/GitHubSetupPress.svelte';
  import { deleteFromSite } from '../../../lib/githubPages.js';
  import { dropFolder, siteRead } from '../../../lib/siteRead.svelte.js';
  import { chipsOf, formatBytes, itemsFor, kindOf, pathOf } from '../../../lib/websiteHub.js';
  import {
    DELETE_CONFIRM, DELETE_TITLE, OUTSIDE_AZIMUT, READ_FIRST, READ_NONE, TOO_MANY, WEBSITE_HELP as HELP, deleteSaid, deletedSaid,
  } from '../../../lib/websiteSetup.js';
  import KindBadge from './KindBadge.svelte';
  import ReadSiteButton from './ReadSiteButton.svelte';

  let { ready = false, github = null, readKey = '' } = $props();

  let filter = $state('all');
  // the row asked to be deleted, until answered
  let confirming = $state(null);
  let deleting = $state(false);
  // what the last delete did: { text, warnings }, or { error } with what the server refused it with
  let deleted = $state(null);
  let setUp = $state('');

  const read = $derived(siteRead.data);
  const repository = $derived(github ? `${github.account}/${github.repo}` : '');
  const chips = $derived(chipsOf(read));
  // a chip that went away with its last article leaves the list whole
  const shown = $derived(itemsFor(read, chips.some((chip) => chip.id === filter) ? filter : 'all'));
  const current = $derived(chips.some((chip) => chip.id === filter) ? filter : 'all');

  function ask(item) {
    confirming = item;
  }

  async function confirm() {
    const item = confirming;
    if (!item || deleting) return;
    deleting = true;
    try {
      const answer = await deleteFromSite(item.folder);
      dropFolder(item.folder);
      deleted = { text: deletedSaid(item.folder, answer), warnings: Array.isArray(answer?.warnings) ? answer.warnings : [] };
    } catch (error) {
      // a branch that moved on, a folder that is gone or one Azimut did not make: said, and the row stays
      deleted = { error: error.message, warnings: [] };
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
  <ReadSiteButton {ready} {repository} key={readKey} />
  {#if chips.length}
    <span class="chips" role="group" aria-label="Show">
      {#each chips as chip (chip.id)}
        <button type="button" class="chip" class:on={current === chip.id} aria-pressed={current === chip.id} title={HELP.siteFilter}
          onclick={() => (filter = chip.id)}>{chip.label}<span class="c">{chip.count}</span></button>
      {/each}
    </span>
  {/if}
</div>

{#if siteRead.needs}
  <GitHubSetupPress needs={siteRead.needs.needs} {github} detail={siteRead.needs.detail} ondone={after} />
{/if}
{#if setUp && !siteRead.needs}<p class="line ok" role="status"><Icon name="check" size={12} /> {setUp}</p>{/if}
{#if deleted}
  {#if deleted.error}
    <p class="line bad" role="alert"><Icon name="alert" size={12} /> {deleted.error}</p>
  {:else}
    <p class="line ok" role="status"><Icon name="check" size={12} /> {deleted.text}</p>
  {/if}
  {#if deleted.warnings.length}
    <ul class="warnings" aria-label="To mind">
      {#each deleted.warnings as warning, index (index)}<li><Icon name="alert" size={12} /> {warning}</li>{/each}
    </ul>
  {/if}
{/if}
{#if read?.warnings.length}
  <ul class="warnings" aria-label="To mind">
    {#each read.warnings as warning, index (index)}<li><Icon name="alert" size={12} /> {warning}</li>{/each}
  </ul>
{/if}

{#if !read}
  <p class="none">{READ_FIRST}</p>
{:else if read.truncated}
  <p class="none">{TOO_MANY}</p>
{:else if !read.items.length}
  <p class="none">{READ_NONE}</p>
{:else}
  <div class="scroll">
    <div class="rows" role="table" aria-label="What the site lists">
      <div class="item head" role="row">
        <span role="columnheader"><span class="sr">Picture</span></span><span role="columnheader">Title</span><span role="columnheader">Category</span>
        <span role="columnheader">Kind</span><span role="columnheader">Published</span><span role="columnheader" class="end">Size</span><span role="columnheader"><span class="sr">Actions</span></span>
      </div>
      {#each shown as item (item.folder)}
        <div class="item" role="row" data-folder={item.folder} title={item.deletable ? undefined : HELP.siteDeleteOutside}>
          <span role="cell">{#if item.image}<img class="th" src={item.image} alt="" loading="lazy" referrerpolicy="no-referrer" />{:else}<span class="th"></span>{/if}</span>
          <span class="t" role="cell"><b title={item.title}>{item.title}</b><small>{pathOf(item)}</small></span>
          <span class="cat" class:none={!item.category || item.role !== 'article'} role="cell">{item.role === 'article' && item.category ? item.category : 'no category'}</span>
          <span role="cell"><KindBadge kind={kindOf(item)} /></span>
          <span class="d" role="cell">{item.dateLabel || item.date}</span>
          <span class="d end" role="cell">{item.bytes === null ? '' : formatBytes(item.bytes)}</span>
          <span class="act" role="cell">
            {#if item.address}<a href={item.address} target="_blank" rel="noopener noreferrer" title={HELP.siteOpenItem}>Open <Icon name="external" size={11} /></a>{/if}
            {#if item.deletable}
              <button type="button" class="btn btn-ghost btn-sm del" onclick={() => ask(item)} title={HELP.siteDelete}>Delete</button>
            {:else}
              <span class="outside">{OUTSIDE_AZIMUT}</span>
            {/if}
          </span>
        </div>
      {/each}
    </div>
  </div>
{/if}

{#if confirming}
  <ConfirmDialog title={DELETE_TITLE} message={deleteSaid(confirming.folder, repository)} confirmLabel={DELETE_CONFIRM}
    tone="danger" busy={deleting} onconfirm={confirm} oncancel={() => { if (!deleting) confirming = null; }} />
{/if}

<style>
  .toolbar { display: flex; gap: 10px 14px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-left: auto; }
  .chip { border: 1px solid var(--border-strong); background: var(--bg-2); border-radius: 99px; padding: 2px 10px; font: inherit; font-size: var(--fs-xs);
    color: var(--text-2); cursor: pointer; }
  .chip:hover { color: var(--text-1); }
  .chip.on { border-color: var(--accent); background: var(--accent-soft); color: var(--text-1); }
  .c { color: var(--text-3); margin-left: 4px; }
  .line { display: flex; align-items: center; gap: 5px; margin: 0 0 10px; color: var(--text-2); font-size: var(--fs-xs); }
  .line.ok { color: var(--ok); }
  .line.bad { color: var(--danger); overflow-wrap: anywhere; }
  .warnings { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-direction: column; gap: 3px; color: var(--warn); font-size: var(--fs-xs); }
  .warnings li { display: flex; align-items: center; gap: 5px; }
  .none { margin: 0; padding: 22px 16px; border: 1px dashed var(--border-strong); border-radius: 8px; color: var(--text-3); font-size: var(--fs-sm); text-align: center; }
  .scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-1); }
  .rows { min-width: 760px; }
  .item { display: grid; grid-template-columns: 84px minmax(0, 1fr) 130px 84px 120px 64px 120px; gap: 14px; align-items: center; padding: 9px 14px;
    border-top: 1px solid var(--border); font-size: var(--fs-sm); }
  .item:first-child { border-top: 0; }
  .item.head { background: var(--bg-2); color: var(--text-3); font-size: var(--fs-xs); padding-top: 6px; padding-bottom: 6px; }
  .th { display: block; width: 84px; height: 46px; border-radius: 4px; object-fit: cover; background: var(--bg-3); }
  .t { min-width: 0; }
  .t b { display: block; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t small { display: block; color: var(--text-3); font-family: var(--font-mono); font-size: 0.68rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .cat { font-size: var(--fs-xs); color: var(--text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cat.none { color: var(--text-3); font-style: italic; }
  .d { color: var(--text-2); font-size: var(--fs-xs); }
  .end { text-align: right; }
  .act { display: flex; align-items: center; justify-content: flex-end; gap: 8px; font-size: var(--fs-xs); }
  .act a { display: inline-flex; align-items: center; gap: 3px; color: var(--accent); }
  .del { color: var(--danger); padding: 2px 6px; }
  .outside { color: var(--text-3); font-size: 0.68rem; text-align: right; line-height: 1.3; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  .toolbar + :global(.needs), .toolbar ~ :global(.needs) { margin: 0 0 10px; }
</style>
