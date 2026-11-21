<script>
  /**
   * Make it yours: the four ways to change what Azimut makes for the site, each with the line of the
   * web folder's own how-to (`SITE_OWN`, the engine's words) and, where it helps, what to write.
   */
  import Icon from '../../../components/Icon.svelte';
  import { HUB_LEADS, SITE_OWN, SITE_OWN_SAMPLES, WEBSITE_HELP as HELP, ownParts } from '../../../lib/websiteSetup.js';
  import HubCard from './HubCard.svelte';
  import HubPanel from './HubPanel.svelte';

  let { active = false } = $props();

  const [title, sub] = HUB_LEADS.yours;
</script>

<HubPanel id="yours" {active} {title} {sub}>
  <div class="grid" data-guide="settings.website-own">
    {#each SITE_OWN as [lead, text] (lead)}
      <HubCard title={lead}>
        <p>{#each ownParts(text) as part, index (index)}{#if part.code !== undefined}<code>{part.code}</code>{:else if part.href}<a
          href={part.href} target="_blank" rel="noopener noreferrer" title={HELP.siteOwnGuide}>{part.link} <Icon name="external" size={11} /></a>{:else}{index === 0 ? part.text.charAt(0).toUpperCase() + part.text.slice(1) : part.text}{/if}{/each}</p>
        {#if SITE_OWN_SAMPLES[lead]}
          <pre>{#each SITE_OWN_SAMPLES[lead] as [how, code], index (index)}{#if index}{'\n'}{/if}<span class={how}>{code}</span>{/each}</pre>
        {/if}
      </HubCard>
    {/each}
  </div>
</HubPanel>

<style>
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
  code { font-family: var(--font-mono); font-size: 0.92em; color: var(--text-1); overflow-wrap: anywhere; }
  pre { margin: 8px 0 0; background: var(--bg-0); border: 1px solid var(--border); border-radius: var(--r-md); padding: 8px 10px; font: 400 0.7rem/1.5 var(--font-mono);
    color: var(--text-1); overflow: auto; white-space: pre; }
  .c { color: var(--accent); }
  .m { color: var(--text-3); }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
