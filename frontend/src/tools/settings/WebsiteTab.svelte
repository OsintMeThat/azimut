<script>
  /**
   * Settings › Website: the hub of the site Azimut makes of the notes published to GitHub Pages.
   *
   * A hero shows the site at a glance (its logo, name, address, size and last change, with Open the
   * site and Update the site), over a bar of panels: **Overview** (how it works, a checklist of what is
   * set, three tips), **Identity** (name, tagline, logo and credit with a live preview), **Hosting**
   * (GitHub Pages, the address, the limits), **Articles** (what the site lists, read on a press),
   * **Readers** (counting and the feed), **Upkeep** (Update the site, who writes what, chores),
   * **Make it yours**, then **WordPress**, which is apart. Every panel stays mounted, the others hidden.
   *
   * Everything here is optional: a site works with it all left empty. Settings save on change as
   * preferences, the server answering with the canonical value. Nothing here reaches GitHub but Test
   * connection, Update the site, Read the site, Delete and the setup presses (`lib/githubPages.js`),
   * each on its press, never on mount; the read the Articles panel makes is kept for the session
   * (`lib/siteRead.svelte.js`) and shared by the hero and the panels. The words are in
   * `lib/websiteSetup.js`, what is worked out of them in `lib/websiteHub.js`.
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
  import {
    COUNTER_NAME, checklist, countingOf, formatBytes, hostOf, percentOf, progressOf, shareOf, siteName,
  } from '../../lib/websiteHub.js';
  import {
    HUB_LEADS, HUB_TABS, LIMITS_AMBER, WEBSITE_HELP as HELP, nameFallbackSaid, updateSaid,
  } from '../../lib/websiteSetup.js';

  let {
    prefs,
    savePrefs,
    /** A panel asked for from elsewhere (`website:identity`): opened once, then cleared. */
    focus = $bindable(''),
  } = $props();

  let tab = $state('overview');
  let hub = $state(null);

  const hover = {
    overview: HELP.tabOverview, identity: HELP.tabIdentity, hosting: HELP.tabHosting, articles: HELP.tabArticles, readers: HELP.tabReaders,
    upkeep: HELP.tabUpkeep, yours: HELP.tabYours, wordpress: HELP.tabWordpress,
  };

  function show(id) {
    if (!HUB_TABS.some((entry) => entry.id === id)) return;
    tab = id;
    hub?.scrollIntoView?.({ block: 'start' });
  }

  $effect(() => {
    if (focus && HUB_TABS.some((entry) => entry.id === focus)) {
      tab = focus;
      focus = '';
    }
  });

  /** The arrow keys move between the panels' tabs, as a tab bar does. */
  function arrows(event) {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step && event.key !== 'Home' && event.key !== 'End') return;
    const at = HUB_TABS.findIndex((entry) => entry.id === tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? HUB_TABS.length - 1 : (at + step + HUB_TABS.length) % HUB_TABS.length;
    event.preventDefault();
    tab = HUB_TABS[next].id;
    document.getElementById(`hub-tab-${tab}`)?.focus();
  }

  // the GitHub section's own read, handed up: the hero, the checklist and the presses need to know whether it is set up
  let github = $state(null);
  const ready = $derived(githubReady(github));
  const readKey = $derived(github ? `${github.account}/${github.repo}@${github.branch}` : '');
  // a read of another repository is no read of this one
  $effect(() => {
    if (github && siteRead.key && siteRead.key !== readKey) forgetRead();
  });

  // what is typed in the two fields of Identity, shown in the hero and the preview as it goes; the saved one is shown again after
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

  const steps = $derived(checklist({
    ready, github, title: prefs.siteTitle.trim(), fallback: fallbackName, siteLogo: prefs.siteLogoSet, logoFrom, counting, stats: prefs.siteStats, read,
  }));
  const progress = $derived(progressOf(steps));
  // a site past four fifths of what GitHub Pages serves is said on the Overview
  const big = $derived.by(() => {
    const bytes = read?.size.site ?? null;
    return bytes !== null && shareOf(bytes) >= LIMITS_AMBER ? { weight: formatBytes(bytes), percent: percentOf(shareOf(bytes)) } : null;
  });

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
        // the press that makes what is missing is in Upkeep
        show('upkeep');
        return;
      }
      updated = { text: updateSaid(answer), at: new Date(), warnings: Array.isArray(answer?.warnings) ? answer.warnings : [] };
    } catch (error) {
      updated = { error: error.message, warnings: [] };
    }
  }

  /** A setup press worked: a new repository has Pages off still, then all is ready. */
  function after() {
    if (needs?.needs === 'repository') {
      needs = { needs: 'pages', detail: `The repository is made. Pages is off for ${github.account}/${github.repo}.` };
      return;
    }
    needs = null;
    setUp = 'Pages is on. Press Update the site.';
  }
</script>

<div class="hub" bind:this={hub}>
  <SiteHero name={shownName} tagline={taglineText} {logoUrl} {address} {github} {ready} {read} counting={COUNTER_NAME[counting] ?? ''}
    {updated} onupdate={update} />

  <div class="tabs" role="tablist" aria-label="Website" data-guide="settings.website-hub">
    {#each HUB_TABS as entry (entry.id)}
      {#if entry.id === 'wordpress'}<span class="sep" aria-hidden="true"></span>{/if}
      <button type="button" role="tab" id="hub-tab-{entry.id}" class="tab" class:on={tab === entry.id} aria-selected={tab === entry.id}
        aria-controls="hub-panel-{entry.id}" tabindex={tab === entry.id ? 0 : -1} title={hover[entry.id]} onclick={() => show(entry.id)}
        onkeydown={arrows}>
        {entry.label}{#if entry.id === 'articles' && read && !read.truncated}<span class="n" aria-label="{read.items.length} on the site">{read.items.length}</span>{/if}
      </button>
    {/each}
  </div>

  <OverviewPanel active={tab === 'overview'} repository={ready ? `${github.account}/${github.repo}` : ''} host={hostOf(address)} {steps} {progress} {big}
    ongo={show} />
  <IdentityPanel active={tab === 'identity'} {prefs} {savePrefs} bind:name={nameText} bind:tagline={taglineText}
    fallbackSaid={nameFallbackSaid({ report: prefs.reportName, account })} {fallbackName} {shownName} {logoFrom} {logoUrl} {read} {address} />
  <HostingPanel active={tab === 'hosting'} {github} {ready} {address} {readKey} onchange={(value) => (github = value)} />
  <ArticlesPanel active={tab === 'articles'} {ready} {github} {readKey} />
  <ReadersPanel active={tab === 'readers'} {prefs} {savePrefs} {address} />
  <UpkeepPanel active={tab === 'upkeep'} {ready} {github} {updated} {needs} {setUp} onupdate={update} onsetup={after} />
  <MakeItYoursPanel active={tab === 'yours'} />
  <HubPanel id="wordpress" active={tab === 'wordpress'} title={HUB_LEADS.wordpress[0]} sub={HUB_LEADS.wordpress[1]}>
    <div class="narrow"><WordPressSettings /></div>
  </HubPanel>
</div>

<style>
  .hub { padding-top: 16px; padding-bottom: 40px; }
  .tabs { position: sticky; top: 0; z-index: 5; margin: 18px -18px 0; padding: 0 18px; background: var(--bg-0); border-bottom: 1px solid var(--border);
    display: flex; flex-wrap: wrap; gap: 2px; align-items: flex-end; }
  .tab { border: 0; background: none; padding: 10px 12px 9px; font: inherit; font-size: var(--fs-sm); color: var(--text-2); cursor: pointer;
    border-bottom: 2px solid transparent; margin-bottom: -1px; display: inline-flex; gap: 7px; align-items: center; }
  .tab:hover { color: var(--text-1); }
  .tab.on { color: var(--text-1); border-bottom-color: var(--accent); }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .n { font-size: 0.66rem; color: var(--text-3); border: 1px solid var(--border-strong); border-radius: 99px; padding: 0 5px; }
  .sep { width: 1px; height: 18px; background: var(--border-strong); margin: 0 8px 10px; }
  .narrow { max-width: 620px; }
  .narrow :global(.wordpress) { border: 1px solid var(--border); background: var(--bg-1); border-radius: 8px; padding: 14px 16px; }
  .narrow :global(.wordpress h3) { text-transform: none; letter-spacing: 0; font-size: var(--fs-md); font-weight: 600; color: var(--text-1); margin-bottom: 4px; }
</style>
