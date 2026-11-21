<script>
  /**
   * Settings › Website: the hub of the site Azimut makes of the notes published to GitHub Pages.
   *
   * A hero shows the site at a glance (its logo, name, address, size and last change, with Open the
   * site and Update the site) over a bar of panels: **Overview** (how it works, a checklist of what is
   * set), **Identity** (name, tagline, logo and credit with a live preview), **Hosting**
   * (GitHub Pages, the address, the limits), **Articles** (what the site holds, read on a press),
   * **Readers** (counting, the feed and the sitemap), **Upkeep** (Update the site, who writes what,
   * the chores), **Make it yours**, then **WordPress**, which stands apart. Every panel stays mounted
   * and the others are hidden, so what was typed or opened is still there on the way back.
   *
   * Everything here is optional: a site works with it all left empty. Settings save on change as
   * preferences, the server answering with the canonical value. Nothing here reaches GitHub but Test
   * connection, Update the site, Read the site, Delete and the setup presses (`lib/githubPages.js`),
   * each on its press, never on mount. The read is kept for the session (`lib/siteRead.svelte.js`) and
   * shared by the hero and the panels. The words are `lib/websiteSetup.js`'s, what is worked out of
   * them `lib/websiteHub.js`'s, and this file holds the hub's own small vocabulary of styles
   * (`hub-*`), which the panels share.
   */
  import WordPressSettings from './WordPressSettings.svelte';
  import ArticlesPanel from './website/ArticlesPanel.svelte';
  import HostingPanel from './website/HostingPanel.svelte';
  import HubPanel from './website/HubPanel.svelte';
  import IdentityPanel from './website/IdentityPanel.svelte';
  import MakeItYoursPanel from './website/MakeItYoursPanel.svelte';
  import OverviewPanel from './website/OverviewPanel.svelte';
  import ReadersPanel from './website/ReadersPanel.svelte';
  import SiteHero from './website/SiteHero.svelte';
  import UpkeepPanel from './website/UpkeepPanel.svelte';
  import { githubReady } from '../../lib/githubPagesSetup.js';
  import { updateSite } from '../../lib/githubPages.js';
  import { siteLogoUrl } from '../../lib/myLogo.js';
  import { forgetRead, siteRead } from '../../lib/siteRead.svelte.js';
  import { countingOf, siteName } from '../../lib/websiteHub.js';
  import { HUB_LEADS, HUB_TABS, WEBSITE_HELP as HELP, updateSaid } from '../../lib/websiteSetup.js';

  let {
    prefs,
    savePrefs,
    /** A panel asked for from elsewhere (`website:identity`): opened once, then cleared. */
    focus = $bindable(''),
  } = $props();

  const HOVER = {
    overview: HELP.tabOverview, identity: HELP.tabIdentity, hosting: HELP.tabHosting, articles: HELP.tabArticles,
    readers: HELP.tabReaders, upkeep: HELP.tabUpkeep, yours: HELP.tabYours, wordpress: HELP.tabWordpress,
  };
  const known = (id) => HUB_TABS.some((entry) => entry.id === id);

  let tab = $state('overview');
  let bar = $state(null);

  /** Open a panel; with the page scrolled past the bar, back to the top of the panel, the bar still in sight. */
  function show(id) {
    if (!known(id)) return;
    tab = id;
    const pane = bar?.closest('.settings-pane');
    if (pane && bar && pane.scrollTop > bar.offsetTop) pane.scrollTop = bar.offsetTop;
  }

  $effect(() => {
    if (focus && known(focus)) {
      tab = focus;
      focus = '';
    }
  });

  /** Arrow keys, Home and End move between the tabs as a tab bar does, opening each. */
  function arrows(event) {
    const at = HUB_TABS.findIndex((entry) => entry.id === tab);
    const last = HUB_TABS.length - 1;
    const next = { ArrowRight: at === last ? 0 : at + 1, ArrowLeft: at === 0 ? last : at - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    show(HUB_TABS[next].id);
    bar?.querySelector(`#hub-tab-${HUB_TABS[next].id}`)?.focus();
  }

  // the GitHub settings as the Hosting panel read them: the hero, the checklist and the presses need to know whether it is set up
  let github = $state(null);
  const ready = $derived(githubReady(github));
  const repository = $derived(ready ? `${github.account}/${github.repo}` : '');
  const readKey = $derived(github ? `${github.account}/${github.repo}@${github.branch}` : '');
  // a read of another repository is no read of this one
  $effect(() => {
    if (github && siteRead.key && siteRead.key !== readKey) forgetRead();
  });

  // what is typed in Identity's two fields, shown in the hero and the preview as it goes; the saved one again after
  let nameText = $state('');
  let taglineText = $state('');
  $effect(() => { nameText = prefs.siteTitle; });
  $effect(() => { taglineText = prefs.siteTagline; });

  const read = $derived(siteRead.data);
  const account = $derived(github?.account ?? '');
  const fallbackName = $derived(siteName({ report: prefs.reportName, account }));
  const shownName = $derived(siteName({ title: nameText, report: prefs.reportName, account }));
  const logoFrom = $derived(prefs.siteLogoSet ? 'site' : prefs.logoSet ? 'publishing' : '');
  const logoUrl = $derived(logoFrom ? siteLogoUrl() : '');
  const address = $derived(read?.address || github?.base || '');
  const counting = $derived(countingOf(prefs));

  // -- update the site ----------------------------------------------------------------------------

  // what the press found: null, 'working', or { text, at, warnings } / { error }
  let updated = $state(null);
  // what the press found missing: { needs, detail }, then what the setup press made of it
  let needs = $state(null);
  let setUp = $state('');

  async function update() {
    if (updated === 'working' || !ready) return;
    updated = 'working';
    needs = null;
    setUp = '';
    try {
      const answer = await updateSite();
      if (answer?.ok === false && answer.needs) {
        needs = { needs: answer.needs === 'repository' ? 'repository' : 'pages', detail: String(answer.detail ?? '') };
        updated = null;
        // the press that makes what is missing is Upkeep's
        show('upkeep');
        return;
      }
      updated = { text: updateSaid(answer), at: new Date(), warnings: Array.isArray(answer?.warnings) ? answer.warnings : [] };
    } catch (error) {
      updated = { error: error.message, at: new Date(), warnings: [] };
    }
  }

  /** A setup press worked: a new repository has Pages off still, then all is ready. */
  function after() {
    if (needs?.needs === 'repository') {
      needs = { needs: 'pages', detail: `The repository is made. Pages is off for ${repository}.` };
      return;
    }
    needs = null;
    setUp = 'Pages is on. Press Update the site.';
  }
</script>

<div class="hub">
  <SiteHero name={shownName} tagline={taglineText} {logoUrl} {address} {github} {ready} {read} {counting} {updated} onupdate={update} />

  <div class="tabs" role="tablist" aria-label="Website" data-guide="settings.website-hub" bind:this={bar}>
    {#each HUB_TABS as entry (entry.id)}
      {#if entry.id === 'wordpress'}<span class="sep" aria-hidden="true"></span>{/if}
      <button type="button" role="tab" id="hub-tab-{entry.id}" class="tab" class:on={tab === entry.id} aria-selected={tab === entry.id}
        aria-controls="hub-panel-{entry.id}" tabindex={tab === entry.id ? 0 : -1} title={HOVER[entry.id]} onclick={() => show(entry.id)}
        onkeydown={arrows}>
        {entry.label}{#if entry.id === 'articles' && read && !read.truncated}<span class="count" aria-label="{read.items.length} on the site">{read.items.length}</span>{/if}
      </button>
    {/each}
  </div>

  <OverviewPanel active={tab === 'overview'} {prefs} {github} {ready} {address} {counting} {logoFrom} {fallbackName} ongo={show} />
  <IdentityPanel active={tab === 'identity'} {prefs} {savePrefs} bind:name={nameText} bind:tagline={taglineText} {account} {fallbackName} {shownName}
    {logoFrom} {logoUrl} {address} />
  <HostingPanel active={tab === 'hosting'} {ready} {address} {readKey} onchange={(value) => (github = value)} />
  <ArticlesPanel active={tab === 'articles'} {ready} {github} {readKey} />
  <ReadersPanel active={tab === 'readers'} {prefs} {savePrefs} {address} />
  <UpkeepPanel active={tab === 'upkeep'} {ready} {github} {updated} {needs} {setUp} onupdate={update} onsetup={after} />
  <MakeItYoursPanel active={tab === 'yours'} />
  <HubPanel id="wordpress" active={tab === 'wordpress'} title={HUB_LEADS.wordpress[0]} sub={HUB_LEADS.wordpress[1]}>
    <div class="narrow"><WordPressSettings /></div>
  </HubPanel>
</div>

<style>
  /* The hub lays itself out by its own width, not the window's: the case sidebar takes a third of it or none. */
  .hub { container: hub / inline-size; padding: 14px 0 40px; }

  /* every tab in sight: on a narrow hub the bar takes a second line rather than hide some */
  .tabs { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: flex-end; gap: 0 2px; margin: 18px -18px 0; padding: 0 18px;
    background: var(--bg-0); border-bottom: 1px solid var(--border); }
  .tab { flex: none; display: inline-flex; align-items: center; gap: 7px; margin-bottom: -1px; padding: 10px 12px 9px; border-bottom: 2px solid transparent;
    color: var(--text-2); font-size: var(--fs-sm); white-space: nowrap; transition: color 0.12s var(--ease), border-color 0.12s var(--ease); }
  .tab:hover { color: var(--text-1); }
  .tab.on { color: var(--text-1); border-bottom-color: var(--accent); }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; border-radius: var(--r-md); }
  .count { min-width: 18px; padding: 0 5px; border: 1px solid var(--border-strong); border-radius: 99px; color: var(--text-3); font-size: 0.66rem;
    line-height: 15px; text-align: center; font-variant-numeric: tabular-nums; }
  .tab.on .count { color: var(--text-2); }
  .sep { flex: none; align-self: center; width: 1px; height: 18px; margin: 0 8px; background: var(--border-strong); }
  .narrow { max-width: 640px; }

  /* -- the hub's vocabulary, shared by its panels ------------------------------------------------ */

  /* two columns once the hub is wide enough for both to breathe, one before */
  .hub :global(.hub-grid) { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; align-items: start; }
  .hub :global(.hub-col) { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  @container hub (min-width: 700px) {
    .hub :global(.hub-grid) { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  .hub :global(.hub-gap) { margin-top: 22px; }

  .hub :global(.hub-hint) { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  .hub :global(.hub-mono) { font-family: var(--font-mono); font-size: 0.92em; }

  .hub :global(.hub-pill) { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border: 1px solid var(--border-strong); border-radius: 99px;
    color: var(--text-2); font-size: var(--fs-xs); font-weight: 500; line-height: 1.5; white-space: nowrap; }
  .hub :global(.hub-pill.ok) { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 38%, transparent); background: var(--ok-soft); }
  .hub :global(.hub-pill.info) { color: var(--info); border-color: color-mix(in srgb, var(--info) 38%, transparent); background: var(--info-soft); }

  /* what a press says it did: a line under it, coloured by how it went */
  .hub :global(.hub-line) { display: flex; align-items: center; gap: 6px; margin: 0; min-height: 1.5em; color: var(--text-3); font-size: var(--fs-xs);
    line-height: 1.5; overflow-wrap: anywhere; }
  .hub :global(.hub-line > svg) { flex: none; }
  .hub :global(.hub-line[data-state='ok']) { color: var(--ok); }
  .hub :global(.hub-line[data-state='error']) { color: var(--danger); }
  .hub :global(.hub-line .when) { color: var(--text-3); white-space: nowrap; }

  .hub :global(.hub-warnings) { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; color: var(--warn);
    font-size: var(--fs-xs); line-height: 1.5; }
  .hub :global(.hub-warnings li) { display: flex; align-items: flex-start; gap: 6px; }
  .hub :global(.hub-warnings li > svg) { flex: none; margin-top: 3px; }

  .hub :global(.hub-ext) { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); font-size: var(--fs-xs); }
  .hub :global(.hub-ext:hover) { color: var(--accent-hover); }

  .hub :global(.hub-how) { margin-top: 12px; border: 1px solid var(--border); border-radius: var(--r-md); padding: 6px 12px; background: var(--bg-0); }
  .hub :global(.hub-how[open]) { padding-bottom: 10px; }
  .hub :global(.hub-how summary) { cursor: pointer; color: var(--text-2); font-size: var(--fs-sm); padding: 2px 0; }
  .hub :global(.hub-how summary:hover) { color: var(--text-1); }
  .hub :global(.hub-how ol) { margin: 8px 0 2px; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; color: var(--text-2);
    font-size: var(--fs-xs); line-height: 1.5; }
  .hub :global(.hub-how strong) { color: var(--text-1); font-weight: 600; }

  /* a quiet press that opens another panel */
  .hub :global(.hub-go) { display: inline-flex; align-items: center; gap: 2px; color: var(--text-2); font-size: var(--fs-xs); white-space: nowrap;
    border-radius: var(--r-sm); transition: color 0.12s var(--ease); }
  .hub :global(.hub-go:hover) { color: var(--accent); }
  .hub :global(.hub-go:focus-visible),
  .hub :global(.hub-ext:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
