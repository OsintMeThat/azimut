<script>
  /**
   * Hosting: where the site lives. The GitHub Pages settings (`GitHubPagesSettings.svelte`) beside the
   * address the site has, how to point a domain of one's own at it, and the limits GitHub Pages holds it
   * to, with two bars of how much of them the site and its repository use once the site is read.
   */
  import GitHubPagesSettings from '../GitHubPagesSettings.svelte';
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import { formatBytes, levelOf, ownDomain, percentOf, shareOf } from '../../../lib/websiteHub.js';
  import {
    ADDRESS_GITHUB, ADDRESS_NONE, ADDRESS_NOTE, ADDRESS_OWN, DOMAIN_LINK, DOMAIN_SAID, DOMAIN_TITLE, HOSTING_DOMAIN_GUIDE, HUB_LEADS, LIMITS_LINES,
    LIMITS_LINK, LIMITS_LINK_TEXT, LIMITS_TITLE, LIMITS_UNREAD, SIZE_UNKNOWN, WEBSITE_HELP as HELP,
  } from '../../../lib/websiteSetup.js';
  import Icon from '../../../components/Icon.svelte';
  import HubCard from './HubCard.svelte';
  import HubPanel from './HubPanel.svelte';
  import ReadSiteButton from './ReadSiteButton.svelte';

  let {
    active = false,
    /** The GitHub settings as read, for the address and for what the read press names. */
    github = null,
    ready = false,
    address = '',
    readKey = '',
    onchange = () => {},
  } = $props();

  const [title, sub] = HUB_LEADS.hosting;
  const read = $derived(siteRead.data);
  // the two bars once the site is read: what the site weighs and what the repository weighs with its history, each of a gigabyte.
  // A weight the server gave none for has no bar; a site GitHub cut short says its size is unknown rather than draw one.
  const bars = $derived(read ? [
    { id: 'site', label: 'Site', of: '1 GB', bytes: read.size.site, help: HELP.siteSize },
    { id: 'repository', label: 'Repository with its history', of: '1 GB recommended', bytes: read.size.repository, help: HELP.repoSize },
  ].filter((bar) => bar.bytes !== null) : []);
</script>

<HubPanel id="hosting" {active} {title} {sub}>
  <div class="grid">
    <GitHubPagesSettings {onchange} />
    <div class="side">
      <HubCard>
        {#snippet heading()}The address{#if address}<span class="badge" class:ok={ownDomain(address)}>{ownDomain(address) ? ADDRESS_OWN : ADDRESS_GITHUB}</span>{/if}{/snippet}
        {#if address}
          <p><a href={address} target="_blank" rel="noopener noreferrer" title={HELP.siteOpen}>{address}</a></p>
          <p class="hint">{ADDRESS_NOTE}</p>
        {:else}
          <p>{ADDRESS_NONE}</p>
        {/if}
      </HubCard>
      <HubCard title={DOMAIN_TITLE}>
        <p>{DOMAIN_SAID}</p>
        <p><a href={HOSTING_DOMAIN_GUIDE} target="_blank" rel="noopener noreferrer" title={HELP.siteOwnGuide}>{DOMAIN_LINK} <Icon name="external" size={11} /></a></p>
      </HubCard>
      <HubCard title={LIMITS_TITLE} label={LIMITS_TITLE}>
        {#each bars as bar (bar.id)}
          {@const share = shareOf(bar.bytes)}
          <div class="usage" title={bar.help}>
            <span class="name">{bar.label}: {formatBytes(bar.bytes)} of {bar.of}</span>
            <div class="bar" role="meter" aria-label={bar.label} aria-valuemin="0" aria-valuemax="100" aria-valuenow={percentOf(share)}
              data-level={levelOf(share)}><i style="width: {Math.min(100, share * 100)}%"></i></div>
          </div>
        {/each}
        {#if !read}
          <p class="unread"><span>{LIMITS_UNREAD}</span> <ReadSiteButton {ready} repository={github ? `${github.account}/${github.repo}` : ''} key={readKey} /></p>
        {:else if read.size.site === null}
          <p class="unread" role="status">{SIZE_UNKNOWN}</p>
        {/if}
        <ul class="limits">
          {#each LIMITS_LINES as line (line)}<li>{line}</li>{/each}
        </ul>
        <p><a href={LIMITS_LINK} target="_blank" rel="noopener noreferrer" title={HELP.githubLimits}>{LIMITS_LINK_TEXT} <Icon name="external" size={11} /></a></p>
      </HubCard>
    </div>
  </div>
</HubPanel>

<style>
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
  /* the GitHub Pages group is a settings group; here it stands as a card of the hub */
  .grid > :global(.github) { min-width: 0; border: 1px solid var(--border); background: var(--bg-1); border-radius: 8px; padding: 14px 16px; }
  .grid :global(.github h3) { text-transform: none; letter-spacing: 0; font-size: var(--fs-md); font-weight: 600; color: var(--text-1); margin-bottom: 4px; }
  .side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .badge { text-transform: none; letter-spacing: 0; font-weight: 500; }
  .usage { margin-top: 10px; }
  .usage:first-of-type { margin-top: 6px; }
  .name { display: block; margin-bottom: 4px; color: var(--text-1); font-size: var(--fs-xs); }
  .bar { height: 6px; border-radius: 3px; background: var(--bg-3); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--ok); border-radius: 3px; }
  .bar[data-level='warn'] i { background: var(--warn); }
  .bar[data-level='danger'] i { background: var(--danger); }
  .unread { margin-top: 10px; display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; }
  .limits { margin: 12px 0 8px; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
