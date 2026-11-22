<script>
  /**
   * Hosting: where the site lives. The GitHub Pages settings (`GitHubPagesSettings.svelte`) beside the
   * address the site has, how to point a domain of one's own at it, and the limits GitHub Pages holds
   * it to, with two bars of how much of them the site and its repository use once the site is read.
   */
  import Icon from '../../../components/Icon.svelte';
  import GitHubPagesSettings from '../GitHubPagesSettings.svelte';
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import { formatBytes, levelOf, ownDomain, percentOf, shareOf } from '../../../lib/websiteHub.js';
  import {
    ADDRESS_GITHUB, ADDRESS_NONE, ADDRESS_NOTE, ADDRESS_OWN, ADDRESS_TITLE, DOMAIN_LINK, DOMAIN_SAID, DOMAIN_TITLE, HOSTING_DOMAIN_GUIDE, HUB_LEADS,
    BARS, LIMITS_LINES, LIMITS_LINK, LIMITS_LINK_TEXT, LIMITS_TITLE, LIMITS_UNREAD, REPOSITORY_UNKNOWN, SIZE_UNKNOWN, WEBSITE_HELP as HELP, barSaid,
  } from '../../../lib/websiteSetup.js';
  import HubCard from './HubCard.svelte';
  import HubPanel from './HubPanel.svelte';
  import ReadSiteButton from './ReadSiteButton.svelte';

  let {
    active = false,
    ready = false,
    address = '',
    readKey = '',
    onchange = () => {},
  } = $props();

  const [title, sub] = HUB_LEADS.hosting;
  const read = $derived(siteRead.data);
  const own = $derived(ownDomain(address));
  // once read, a bar for each weight GitHub gave, and a line for one it could not
  const bars = $derived(read ? [
    { id: 'site', bytes: read.size.site, help: HELP.siteSize, unknown: SIZE_UNKNOWN },
    { id: 'repository', bytes: read.size.repository, help: HELP.repoSize, unknown: REPOSITORY_UNKNOWN },
  ] : []);
</script>

<HubPanel id="hosting" {active} {title} {sub}>
  <div class="hub-grid">
    <GitHubPagesSettings {onchange} />

    <div class="hub-col">
      <HubCard title={ADDRESS_TITLE} label={ADDRESS_TITLE}>
        {#snippet aside()}{#if address}<span class="hub-pill" class:ok={own}>{own ? ADDRESS_OWN : ADDRESS_GITHUB}</span>{/if}{/snippet}
        {#if address}
          <p class="address"><a href={address} target="_blank" rel="noopener noreferrer" title={HELP.siteOpen}>{address}</a></p>
          <p class="hub-hint">{ADDRESS_NOTE}</p>
        {:else}
          <p class="hub-hint">{ADDRESS_NONE}</p>
        {/if}
      </HubCard>

      <HubCard title={DOMAIN_TITLE} label={DOMAIN_TITLE}>
        <p>{DOMAIN_SAID}</p>
        <p><a class="hub-ext" href={HOSTING_DOMAIN_GUIDE} target="_blank" rel="noopener noreferrer" title={HELP.siteOwnGuide}>{DOMAIN_LINK} <Icon name="external" size={11} /></a></p>
      </HubCard>

      <HubCard title={LIMITS_TITLE} label={LIMITS_TITLE}>
        <div class="usage">
          {#if !read}
            <p class="unread"><span class="hub-hint">{LIMITS_UNREAD}</span>
              <ReadSiteButton {ready} key={readKey} /></p>
          {:else}
            {#each bars as bar (bar.id)}
              {#if bar.bytes === null}
                <p class="meter-line unknown" role="status">{bar.unknown}</p>
              {:else}
                {@const share = shareOf(bar.bytes)}
                <div class="meter-line" title={bar.help}>
                  <span class="meter-said"><span>{barSaid(bar.id, formatBytes(bar.bytes))}</span><span class="pct">{percentOf(share)}%</span></span>
                  <div class="meter" role="meter" aria-label={BARS[bar.id].label} aria-valuemin="0" aria-valuemax="100"
                    aria-valuenow={Math.min(100, percentOf(share))} aria-valuetext="{percentOf(share)}%" data-level={levelOf(share)}>
                    <i style:width="{Math.min(100, share * 100)}%"></i>
                  </div>
                </div>
              {/if}
            {/each}
          {/if}
        </div>
        <ul class="limits">
          {#each LIMITS_LINES as said (said)}<li>{said}</li>{/each}
        </ul>
        <p><a class="hub-ext" href={LIMITS_LINK} target="_blank" rel="noopener noreferrer" title={HELP.githubLimits}>{LIMITS_LINK_TEXT} <Icon name="external" size={11} /></a></p>
      </HubCard>
    </div>
  </div>
</HubPanel>

<style>
  .address { overflow-wrap: anywhere; }
  .address a { color: var(--accent); font-size: var(--fs-sm); }
  .address + :global(.hub-hint) { margin-top: 6px; }
  /* the bars or what stands in their place keep one height, so the list under them never moves */
  .usage { display: flex; flex-direction: column; gap: 12px; min-height: 84px; margin-top: 8px; justify-content: center; }
  .unread { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; margin: 0; }
  .meter-line { margin: 0; }
  .meter-line.unknown { color: var(--text-3); font-size: var(--fs-xs); }
  .meter-said { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 5px; color: var(--text-1); font-size: var(--fs-xs); }
  .pct { color: var(--text-3); font-variant-numeric: tabular-nums; }
  .meter { height: 6px; overflow: hidden; border-radius: 3px; background: var(--bg-3); }
  .meter i { display: block; height: 100%; border-radius: 3px; background: var(--ok); transition: width 0.4s var(--ease); }
  .meter[data-level='warn'] i { background: var(--warn); }
  .meter[data-level='danger'] i { background: var(--danger); }
  .meter-line:has(.meter[data-level='danger']) .pct { color: var(--danger); }
  .meter-line:has(.meter[data-level='warn']) .pct { color: var(--warn); }
  .limits { margin: 14px 0 10px; padding: 12px 0 0 18px; border-top: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px;
    color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  .limits li::marker { color: var(--text-3); }
</style>
