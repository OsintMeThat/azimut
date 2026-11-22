<script>
  /**
   * Pages every site should have: the Legal notice and the Privacy page. Each press makes a note of
   * that name in the open case, a page of the site that names the host and leaves the rest to the
   * analyst, and opens the Notebook on it; pressed again it opens the one made. Once the site is read,
   * a page it already holds says so, and a press says so with a spinner while the note is made. Nothing
   * here reaches GitHub.
   */
  import BusyLabel from '../../../components/BusyLabel.svelte';
  import Icon from '../../../components/Icon.svelte';
  import HubCard from './HubCard.svelte';
  import { caseState, reloadCase, toast } from '../../../lib/state.svelte.js';
  import { openNotebook } from '../../../lib/navigate.js';
  import { startLegalNotice, startPrivacyNotice } from '../../../lib/githubPages.js';
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import {
    BUSY, LEGAL_NO_CASE, LEGAL_PRESS, LEGAL_SAID, LEGAL_SENTENCE, PAGES_NOTE, PAGES_TITLE, PAGE_ON_SITE, PRIVACY_PRESS, PRIVACY_SAID,
    WEBSITE_HELP as HELP,
  } from '../../../lib/websiteSetup.js';

  const PAGES = [
    { id: 'legal', name: 'Legal notice', press: LEGAL_PRESS, said: LEGAL_SAID, help: HELP.legalStart, start: startLegalNotice, guide: 'settings.legal' },
    { id: 'privacy', name: 'Privacy', press: PRIVACY_PRESS, said: PRIVACY_SAID, help: HELP.privacyStart, start: startPrivacyNotice, guide: undefined },
  ];

  const caseId = $derived(caseState.current?.id ?? '');
  // a read cut short found no page, which says nothing of the site
  const read = $derived(siteRead.data && !siteRead.data.truncated ? siteRead.data : null);
  // which page is being made, so one press does not start two
  let busy = $state('');

  async function start(page) {
    if (!caseId || busy) return;
    busy = page.id;
    try {
      const note = await page.start(caseId);
      // the note is new to the case's list until it is read again
      await reloadCase().catch(() => {});
      openNotebook(note.id);
    } catch (error) {
      toast(`Could not start the ${page.name} page: ${error.message}`, 'danger');
    } finally {
      busy = '';
    }
  }
</script>

<HubCard title={PAGES_TITLE} label={PAGES_TITLE}>
  <p>{LEGAL_SENTENCE}</p>
  <ul class="pages">
    {#each PAGES as page (page.id)}
      <li data-guide={page.guide}>
        <span class="what">
          <span class="name">{page.name}{#if read?.[page.id]}<span class="hub-pill ok" title={read[page.id]}><Icon name="check" size={10} />{PAGE_ON_SITE}</span>{/if}</span>
          <small>{page.said}</small>
        </span>
        <button type="button" class="btn btn-sm" onclick={() => start(page)} disabled={!caseId || busy !== ''} aria-busy={busy === page.id}
          title={caseId ? page.help : LEGAL_NO_CASE}><BusyLabel busy={busy === page.id} text={BUSY.start}>{page.press}</BusyLabel></button>
      </li>
    {/each}
  </ul>
  <p class="hub-hint">{PAGES_NOTE}</p>
</HubCard>

<style>
  .pages { list-style: none; margin: 10px 0 0; padding: 0; }
  .pages li { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; padding: 9px 0; border-top: 1px solid var(--border); }
  .pages li:first-child { border-top: 0; }
  .what { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 180px; }
  .name { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 8px; color: var(--text-1); font-size: var(--fs-sm); }
  .what small { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  .pages .btn { flex: none; }
  .hub-hint { margin-top: 10px; }
</style>
