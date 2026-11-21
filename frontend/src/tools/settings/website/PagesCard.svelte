<script>
  /**
   * Pages every site should have: the Legal notice and the Privacy page. Each press makes a note of
   * that name in the open case, a page of the site that names the host and leaves the rest to the
   * analyst, and opens the Notebook on it; pressed again it opens the one made. Once the site is read,
   * a page it already holds says so. Nothing here reaches GitHub.
   */
  import Icon from '../../../components/Icon.svelte';
  import { caseState, reloadCase, toast } from '../../../lib/state.svelte.js';
  import { openNotebook } from '../../../lib/navigate.js';
  import { startLegalNotice, startPrivacyNotice } from '../../../lib/githubPages.js';
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import {
    LEGAL_NO_CASE, LEGAL_PRESS, LEGAL_SAID, LEGAL_SENTENCE, PAGES_NOTE, PAGES_TITLE, PAGE_ON_SITE, PRIVACY_PRESS, PRIVACY_SAID, WEBSITE_HELP as HELP,
  } from '../../../lib/websiteSetup.js';
  import HubCard from './HubCard.svelte';

  const caseId = $derived(caseState.current?.id ?? '');
  const read = $derived(siteRead.data);
  // which page is being made, so one press does not start two
  let busy = $state('');

  const PAGES = [
    { id: 'legal', name: 'Legal notice', press: LEGAL_PRESS, said: LEGAL_SAID, help: HELP.legalStart, start: startLegalNotice, guide: 'settings.legal' },
    { id: 'privacy', name: 'Privacy page', press: PRIVACY_PRESS, said: PRIVACY_SAID, help: HELP.privacyStart, start: startPrivacyNotice, guide: undefined },
  ];

  async function start(page) {
    if (!caseId || busy) return;
    busy = page.id;
    try {
      const note = await page.start(caseId);
      // the note is new to the case's list until it is read again
      await reloadCase().catch(() => {});
      openNotebook(note.id);
    } catch (error) {
      toast(`Could not start the ${page.name}: ${error.message}`, 'danger');
    } finally {
      busy = '';
    }
  }
</script>

<HubCard title={PAGES_TITLE}>
  <p>{LEGAL_SENTENCE}</p>
  <ul class="pages">
    {#each PAGES as page (page.id)}
      <li data-guide={page.guide}>
        <span class="what">
          <span class="name">{page.name}
            {#if read?.[page.id]}<span class="badge ok"><Icon name="check" size={11} /> {PAGE_ON_SITE}</span>{/if}</span>
          <small>{page.said}</small>
        </span>
        <button type="button" class="btn btn-sm" onclick={() => start(page)} disabled={!caseId || busy !== ''}
          title={caseId ? page.help : LEGAL_NO_CASE}>{busy === page.id ? 'Starting…' : page.press}</button>
      </li>
    {/each}
  </ul>
  <p class="hint">{PAGES_NOTE}</p>
</HubCard>

<style>
  .pages { list-style: none; margin: 8px 0 0; padding: 0; }
  .pages li { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid var(--border); font-size: var(--fs-sm); }
  .pages li:first-child { border-top: 0; }
  .what { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name { display: inline-flex; align-items: center; gap: 8px; flex-wrap: wrap; color: var(--text-1); }
  .what small { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; }
  .badge { gap: 3px; }
  p.hint { margin-top: 8px; }
</style>
