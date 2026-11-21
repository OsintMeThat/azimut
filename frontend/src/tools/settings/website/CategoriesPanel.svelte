<script>
  /**
   * Categories: the site's categories as the last read found them, each with its articles and the pages that
   * name it, and the presses that change them.
   *
   * - **Add** keeps a name on this computer (`keepAddedCategories`): the publish window and each article's line
   *   offer it, and it reaches the site with the first article that carries it, when it leaves this list. It
   *   shows with no article yet, and Rename or Remove change it here only.
   * - **Rename** and **Delete** a category the site carries go to GitHub on their confirmation only
   *   (`ConfirmDialog`, which names how many articles it touches and which of the analyst's pages name it), as
   *   one commit of those articles' cards and the lists; the read follows (`withCategories`) and the line under
   *   the list says what was done, or what GitHub refused in its words.
   * - On a site whose home page is the analyst's own, a standing line says that their menu and pages stay
   *   theirs, and each change says what it asks of them (`ownPagesSaid`). Azimut's own site shows none of it.
   *
   * Nothing is asked of GitHub until a press; the read is the session's (`lib/siteRead.svelte.js`).
   */
  import BusyLabel from '../../../components/BusyLabel.svelte';
  import ConfirmDialog from '../../../components/ConfirmDialog.svelte';
  import Icon from '../../../components/Icon.svelte';
  import GitHubSetupPress from '../../../components/GitHubSetupPress.svelte';
  import { deleteCategory, keepAddedCategories, renameCategory } from '../../../lib/githubPages.js';
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import { addProblem, carrying, categoryRows, withCategories } from '../../../lib/websiteHub.js';
  import {
    BUSY, CATEGORIES_NONE, CATEGORIES_NOTE, CATEGORIES_TITLE, CATEGORIES_OWN_PAGES, CATEGORIES_SAID, CATEGORIES_UNREAD, CATEGORY_ADD_LABEL, CATEGORY_ADD_OWN_PAGES,
    CATEGORY_ADD_PLACEHOLDER, CATEGORY_ADD_PRESS, CATEGORY_ADD_PROBLEM, CATEGORY_ADD_SAID, CATEGORY_CANCEL_PRESS, CATEGORY_DELETE_CONFIRM,
    CATEGORY_DELETE_PRESS, CATEGORY_DELETE_TITLE, CATEGORY_MAX, CATEGORY_REMOVE_PRESS, CATEGORY_RENAME_PRESS, CATEGORY_SAVE_PRESS, HUB_LEADS,
    RENAME_CONFIRM, RENAME_TITLE, WEBSITE_HELP as HELP, categoryAddedSaid, categoryCountSaid, categoryDeleteSaid, categoryDoneSaid, categoryPagesSaid,
    ownPagesSaid, renameSaid,
  } from '../../../lib/websiteSetup.js';
  import HubCard from './HubCard.svelte';
  import HubPanel from './HubPanel.svelte';
  import ReadSiteButton from './ReadSiteButton.svelte';

  let {
    active = false,
    ready = false,
    github = null,
    readKey = '',
    /** Called with what the server keeps now: `{ added, categories }`. */
    onchange = () => {},
  } = $props();

  const [title, sub] = HUB_LEADS.categories;
  const read = $derived(siteRead.data);
  const known = $derived(read && !read.truncated ? read : null);
  const added = $derived(github?.added ?? []);
  const rows = $derived(categoryRows(known, added));
  // a home page of the analyst's own: their menu and pages are theirs, and each change says what it asks of them
  const own = $derived(known?.home === 'yours');
  const repository = $derived(github ? `${github.account}/${github.repo}` : '');

  let typed = $state('');
  let adding = $state(false);
  // the row whose name is being changed, and what is typed for it
  let editing = $state('');
  let draft = $state('');
  // the change to confirm: { kind: 'rename' | 'delete', name, to, count, into, pages }
  let asking = $state(null);
  let working = $state(false);
  // what the last press did: { state, text, warnings, at }
  let said = $state(null);
  let setUp = $state('');

  const problem = $derived(typed.trim() ? addProblem(typed, known, added) : '');
  // a word is said until the next read
  const shown = $derived(said && (!siteRead.at || said.at >= siteRead.at) ? said : null);

  /** Keep the names added here, as the server reads them; what it said is the line under the list. */
  async function keep(names, text) {
    try {
      const answer = await keepAddedCategories(names);
      onchange(answer);
      said = { state: 'ok', text, warnings: [], at: new Date() };
      return true;
    } catch (error) {
      said = { state: 'error', text: error.message, warnings: [], at: new Date() };
      return false;
    }
  }

  async function add() {
    const name = typed.replace(/\s+/g, ' ').trim().slice(0, CATEGORY_MAX);
    if (!name || problem || adding) return;
    adding = true;
    const text = own ? `${categoryAddedSaid(name)} ${CATEGORY_ADD_OWN_PAGES}` : categoryAddedSaid(name);
    if (await keep([...added, name], text)) typed = '';
    adding = false;
  }

  function startRename(row) {
    editing = row.name;
    draft = row.name;
  }

  function stopRename() {
    editing = '';
    draft = '';
  }

  /** A new name typed: an added one changes here, one the site carries asks first. */
  async function saveRename(row) {
    const to = draft.replace(/\s+/g, ' ').trim().slice(0, CATEGORY_MAX);
    if (!to || to === row.name) {
      stopRename();
      return;
    }
    if (row.added) {
      if (await keep(added.map((name) => (name === row.name ? to : name)), `${row.name} is ${to} now.`)) stopRename();
      return;
    }
    const into = known?.categories.find((entry) => entry.name === to)?.count ?? 0;
    asking = { kind: 'rename', name: row.name, to, count: carrying(known, row.name), into, pages: row.pages };
  }

  function askDelete(row) {
    if (row.added) {
      void keep(added.filter((name) => name !== row.name), `${row.name} is no longer offered.`);
      return;
    }
    asking = { kind: 'delete', name: row.name, to: '', count: carrying(known, row.name), into: 0, pages: row.pages };
  }

  async function confirm() {
    const change = asking;
    if (!change || working) return;
    working = true;
    try {
      const answer = change.kind === 'rename' ? await renameCategory(change.name, change.to) : await deleteCategory(change.name);
      if (answer?.ok === false && answer.needs) {
        siteRead.needs = { needs: answer.needs === 'repository' ? 'repository' : 'pages', detail: String(answer.detail ?? '') };
        return;
      }
      siteRead.data = withCategories(siteRead.data, change);
      onchange({ added: answer?.added ?? added, categories: answer?.categories ?? github?.categories ?? [] });
      said = { state: 'ok', text: categoryDoneSaid(change.kind, change.name, change.to, Number(answer?.changed) || 0),
        warnings: Array.isArray(answer?.warnings) ? answer.warnings : [], at: new Date() };
      stopRename();
    } catch (error) {
      said = { state: 'error', text: error.message, warnings: [], at: new Date() };
    } finally {
      asking = null;
      working = false;
    }
  }

  function renameKeys(event, row) {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveRename(row);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      stopRename();
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

<HubPanel id="categories" {active} {title} {sub}>
  <div class="toolbar">
    <ReadSiteButton {ready} key={readKey} said={shown ? { state: shown.state, text: shown.text } : setUp && !siteRead.needs ? { state: 'ok', text: setUp } : null} />
  </div>
  {#if siteRead.needs}
    <div class="needs"><GitHubSetupPress needs={siteRead.needs.needs} {github} detail={siteRead.needs.detail} ondone={after} /></div>
  {/if}
  {#if own}<p class="own" role="note"><Icon name="info" size={13} />{CATEGORIES_OWN_PAGES}</p>{/if}
  {#if shown?.warnings.length}
    <ul class="hub-warnings" aria-label="To mind">
      {#each shown.warnings as warning, index (index)}<li><Icon name="alert" size={12} /> {warning}</li>{/each}
    </ul>
  {/if}

  <div class="hub-grid cols">
    <HubCard title={CATEGORIES_TITLE} label={CATEGORIES_TITLE}>
      <p>{CATEGORIES_SAID}</p>
      {#if !rows.length}
        <p class="none">{known ? CATEGORIES_NONE : CATEGORIES_UNREAD}</p>
      {:else}
        <ul class="cats">
          {#each rows as row (row.name)}
            <li data-category={row.name} class:quiet={!row.count}>
              {#if editing === row.name}
                <span class="rename">
                  <!-- svelte-ignore a11y_autofocus -->
                  <input class="input" bind:value={draft} maxlength={CATEGORY_MAX} aria-label="New name of {row.name}" title={HELP.categoryRenameField}
                    spellcheck="false" autocomplete="off" autofocus onkeydown={(event) => renameKeys(event, row)} />
                  <button type="button" class="btn btn-sm btn-primary" onclick={() => saveRename(row)} title={HELP.categorySave}>{CATEGORY_SAVE_PRESS}</button>
                  <button type="button" class="btn btn-sm btn-ghost" onclick={stopRename} title={HELP.categoryCancel}>{CATEGORY_CANCEL_PRESS}</button>
                </span>
              {:else}
                <span class="cat-name" title={row.name}>{row.name}</span>
                <span class="cat-count">{categoryCountSaid(row.count)}</span>
                <span class="cat-acts">
                  {#if row.added || row.count}
                    <button type="button" class="btn btn-xs btn-ghost" onclick={() => startRename(row)} disabled={working}
                      title={HELP.categoryRename}>{CATEGORY_RENAME_PRESS}</button>
                    <button type="button" class="btn btn-xs btn-ghost del" onclick={() => askDelete(row)} disabled={working}
                      title={row.added ? HELP.categoryRemove : HELP.categoryDelete}>{row.added ? CATEGORY_REMOVE_PRESS : CATEGORY_DELETE_PRESS}</button>
                  {/if}
                </span>
                <span class="cat-pages" class:none={!row.pages.length}>{row.added ? CATEGORY_ADD_SAID : categoryPagesSaid(row.pages)}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      <p class="hub-hint foot">{CATEGORIES_NOTE}</p>
    </HubCard>

    <HubCard title={CATEGORY_ADD_LABEL} label={CATEGORY_ADD_LABEL}>
      <form class="add" onsubmit={(event) => { event.preventDefault(); void add(); }}>
        <input class="input" bind:value={typed} maxlength={CATEGORY_MAX} placeholder={CATEGORY_ADD_PLACEHOLDER} aria-label={CATEGORY_ADD_LABEL}
          aria-describedby="category-add-said" title={HELP.categoryName} spellcheck="false" autocomplete="off" />
        <button type="submit" class="btn btn-sm" disabled={!typed.trim() || Boolean(problem) || adding} aria-busy={adding}
          title={HELP.categoryAdd}><Icon name="plus" size={12} />{CATEGORY_ADD_PRESS}</button>
      </form>
      <p id="category-add-said" class="add-said" class:bad={problem === 'site' || problem === 'added'} role="status">
        {problem === 'site' || problem === 'added' ? CATEGORY_ADD_PROBLEM[problem] : own ? CATEGORY_ADD_OWN_PAGES : CATEGORY_ADD_SAID}</p>
    </HubCard>
  </div>
</HubPanel>

{#if asking}
  <ConfirmDialog title={asking.kind === 'rename' ? RENAME_TITLE : CATEGORY_DELETE_TITLE}
    message={asking.kind === 'rename' ? renameSaid(asking.name, asking.to, asking.count, asking.into) : categoryDeleteSaid(asking.name, asking.count)}
    detail={ownPagesSaid(asking.pages, asking.kind, own)} confirmLabel={asking.kind === 'rename' ? RENAME_CONFIRM : CATEGORY_DELETE_CONFIRM}
    busyLabel={asking.kind === 'rename' ? BUSY.rename : BUSY.delete} tone={asking.kind === 'delete' ? 'danger' : 'default'}
    icon={asking.kind === 'rename' ? 'edit' : 'trash'} busy={working} onconfirm={confirm} oncancel={() => { if (!working) asking = null; }} />
{/if}

<style>
  .toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; margin-bottom: 12px; min-height: 26px; }
  .needs { margin: 0 0 12px; }
  .own { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 14px; padding: 9px 12px; border: 1px solid color-mix(in srgb, var(--info) 35%, transparent);
    border-radius: 8px; background: var(--info-soft); color: var(--text-1); font-size: var(--fs-sm); line-height: 1.5; }
  .own :global(svg) { flex: none; margin-top: 3px; color: var(--info); }
  .toolbar ~ :global(.hub-warnings) { margin: -4px 0 12px; }
  @container hub (min-width: 700px) { .cols { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); } }

  .cats { list-style: none; margin: 10px 0 0; padding: 0; }
  .cats li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; grid-template-areas: 'name count acts' 'pg pg pg'; gap: 1px 10px;
    align-items: center; padding: 7px 0; border-top: 1px solid var(--border); }
  .cats li:first-child { border-top: 0; }
  .cat-name { grid-area: name; overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); white-space: nowrap; text-overflow: ellipsis; }
  .quiet .cat-name { color: var(--text-2); }
  .cat-count { grid-area: count; color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap; }
  .quiet .cat-count { font-style: italic; }
  .cat-acts { grid-area: acts; display: flex; gap: 2px; }
  .cat-pages { grid-area: pg; color: var(--text-2); font-family: var(--font-mono); font-size: 0.68rem; overflow-wrap: anywhere; }
  .cat-pages.none { color: var(--text-3); font-family: inherit; font-size: var(--fs-xs); font-style: italic; }
  .del { color: var(--danger); }
  .del:hover:not(:disabled) { background: var(--danger-soft); color: var(--danger); }
  .rename { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; }
  .rename .input { flex: 1; min-width: 0; }
  .none { margin-top: 10px; color: var(--text-3); font-size: var(--fs-xs); }
  .foot { margin-top: 10px; }

  .add { display: flex; gap: 6px; margin-top: 8px; }
  .add .input { flex: 1; min-width: 0; }
  .add .btn { flex: none; display: inline-flex; align-items: center; gap: 4px; }
  .add-said { margin: 6px 0 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  .add-said.bad { color: var(--warn); }
</style>
