<script>
  /**
   * The files a note was exported as, PDFs, HTML pages and web folders, newest first:
   * the day, the format, the edition, a PDF's pages and the file's name, a web folder's
   * address. Show opens the folder it was written to (a web folder itself); Check
   * hashes the file again (a web folder's page) and says whether it is still the one
   * Azimut wrote. Nothing is fetched.
   */
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import { siteHost } from '../../lib/wordpressSetup.js';
  import {
    CHECK_SAID, PUBLIC, checkEdition, editionDay, listEditions, showEdition,
  } from '../../lib/notes/editions.svelte.js';

  let { caseId, noteId, title = '', onclose = () => {} } = $props();

  const FORMAT_BADGES = { pdf: 'PDF', html: 'HTML', web: 'Web' };

  let editions = $state(null);
  let failed = $state('');
  /** What Check said, by edition: `checking`, or the state the server answered. */
  let checked = $state({});
  let showing = $state('');

  const keyOf = (edition) => `${edition.at}|${edition.file}|${edition.post ?? ''}`;

  $effect(() => {
    const id = caseId;
    const note = noteId;
    let live = true;
    untrack(() => {
      editions = null;
      failed = '';
      checked = {};
    });
    listEditions(id, note)
      .then((list) => { if (live) editions = list; })
      .catch((error) => { if (live) { editions = []; failed = error.message; } });
    return () => { live = false; };
  });

  async function check(edition) {
    const key = keyOf(edition);
    checked[key] = 'checking';
    try {
      checked[key] = await checkEdition(caseId, noteId, edition);
    } catch (error) {
      checked[key] = { error: error.message };
    }
  }

  async function show(edition) {
    showing = keyOf(edition);
    try {
      await showEdition(caseId, noteId, edition);
    } catch (error) {
      checked[keyOf(edition)] = { error: error.message };
    } finally {
      showing = '';
    }
  }
</script>

<Modal title="Editions" {onclose} width="620px">
  <p class="lead">{title ? `Every PDF, HTML page, web folder and WordPress draft of “${title}”, newest first.` : 'Every PDF, HTML page, web folder and WordPress draft of this note, newest first.'} Each one stays where it was written.</p>
  {#if editions === null}
    <p class="quiet" role="status">Reading…</p>
  {:else if failed}
    <p class="quiet error" role="alert"><Icon name="alert" size={12} /> Could not read the editions: {failed}</p>
  {:else if !editions.length}
    <p class="quiet">Nothing exported yet. Each export is listed here.</p>
  {:else}
    <ul class="list" aria-label="Editions">
      {#each editions as edition (keyOf(edition))}
        {@const state = checked[keyOf(edition)]}
        <li class="row">
          {#if edition.format === 'wordpress'}
            <!-- a WordPress draft is no file: its site, and Open in WordPress in place of Show and Check -->
            <div class="what">
              <div class="head">
                <span class="day">{editionDay(edition.at)}</span>
                <span class="badge format" data-format="wordpress">WordPress</span>
                <span class="badge edition">Public</span>
              </div>
              <span class="file">Draft on {siteHost(edition.site)}</span>
            </div>
            <a class="btn btn-ghost btn-xs" href={edition.edit} target="_blank" rel="noopener noreferrer"
              title="The draft in WordPress's editor; it may have been published since">Open in WordPress</a>
          {:else}
          <div class="what">
            <div class="head">
              <span class="day">{editionDay(edition.at)}</span>
              <span class="badge format" data-format={edition.format}>{FORMAT_BADGES[edition.format] ?? 'PDF'}</span>
              <span class="badge edition" class:internal={edition.edition !== PUBLIC}>{edition.edition === PUBLIC ? 'Public' : 'Internal'}</span>
              {#if edition.format !== 'html'}<span class="pages">{edition.pages} page{edition.pages === 1 ? '' : 's'}</span>{/if}
            </div>
            <span class="file mono" title={edition.pdf_sha256 ? `SHA-256 ${edition.pdf_sha256}` : edition.file}>{edition.file}</span>
            {#if edition.address}<span class="file mono" title="The address it was made for">{edition.address}</span>{/if}
            {#if state === 'checking'}
              <span class="said" role="status">Checking…</span>
            {:else if typeof state === 'string'}
              <span class="said" data-state={state} role="status">
                <Icon name={state === 'unchanged' ? 'check' : 'alert'} size={12} /> {CHECK_SAID[state]}</span>
            {:else if state?.error}
              <span class="said" data-state="error" role="status"><Icon name="alert" size={12} /> {state.error}</span>
            {/if}
          </div>
          <button type="button" class="btn btn-ghost btn-xs" title="Open the folder it was written to" disabled={showing === keyOf(edition)}
            onclick={() => show(edition)}>Show</button>
          <button type="button" class="btn btn-ghost btn-xs" title="Read the file again and compare it with what Azimut wrote"
            disabled={state === 'checking'} onclick={() => check(edition)}>Check</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
  <div class="actions">
    <button type="button" class="btn" onclick={onclose}>Close</button>
  </div>
</Modal>

<style>
  .lead { margin: 0 0 10px; color: var(--text-2); font-size: var(--fs-sm); }
  .quiet { margin: 6px 0; color: var(--text-3); font-size: var(--fs-sm); display: flex; align-items: center; gap: 6px; }
  .quiet.error { color: var(--danger); }
  .list { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow: auto; border: 1px solid var(--border); border-radius: var(--r-md); }
  .row { display: flex; align-items: center; gap: 6px; padding: 7px 8px 7px 10px; border-top: 1px solid var(--border); }
  .row:first-child { border-top: none; }
  .what { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .head { display: flex; align-items: center; gap: 8px; font-size: var(--fs-sm); color: var(--text-1); }
  .pages { color: var(--text-3); font-size: var(--fs-xs); }
  .edition { color: var(--text-2); }
  .format { color: var(--text-2); font-family: var(--font-mono); letter-spacing: .02em; }
  .format[data-format='html'], .format[data-format='web'] { color: var(--accent); }
  .edition.internal { background: color-mix(in srgb, var(--internal) 16%, transparent); color: var(--internal); }
  .file { color: var(--text-3); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .said { display: inline-flex; align-items: center; gap: 4px; font-size: var(--fs-xs); color: var(--text-2); }
  .said[data-state='unchanged'] { color: var(--ok); }
  .said[data-state='changed'], .said[data-state='error'] { color: var(--danger); }
  .said[data-state='missing'] { color: var(--warn); }
  .mono { font-family: var(--font-mono); }
  .actions { display: flex; justify-content: flex-end; margin-top: 14px; }
  .format[data-format='wordpress'] { color: var(--accent); }
</style>
