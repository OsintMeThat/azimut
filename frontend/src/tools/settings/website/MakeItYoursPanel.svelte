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
  /** The engine's line starts lower-case after its lead; standing alone, it starts with a capital. */
  const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);
</script>

<HubPanel id="yours" {active} {title} {sub}>
  <div class="hub-grid" data-guide="settings.website-own">
    {#each SITE_OWN as [lead, text] (lead)}
      <HubCard title={lead} label={lead}>
        <p>{#each ownParts(text) as part, index (index)}{#if part.code !== undefined}<code>{part.code}</code>{:else if part.href}<a class="inline"
          href={part.href} target="_blank" rel="noopener noreferrer" title={HELP.siteOwnGuide}>{part.link} <Icon name="external" size={11} /></a>{:else}{index === 0
          ? capital(part.text) : part.text}{/if}{/each}</p>
        {#if SITE_OWN_SAMPLES[lead]}
          <pre>{#each SITE_OWN_SAMPLES[lead] as [how, code], index (index)}{#if index}{'\n'}{/if}<span class={how}>{code}</span>{/each}</pre>
        {/if}
      </HubCard>
    {/each}
  </div>
</HubPanel>

<style>
  code { padding: 0 3px; border-radius: 3px; background: var(--bg-2); color: var(--text-1); font-family: var(--font-mono); font-size: 0.9em;
    overflow-wrap: anywhere; }
  pre { margin: 10px 0 0; padding: 9px 11px; overflow: auto; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-0);
    color: var(--text-1); font: 400 0.7rem/1.6 var(--font-mono); white-space: pre; }
  .inline { display: inline-flex; align-items: center; gap: 3px; color: var(--accent); }
  .inline:hover { color: var(--accent-hover); }
  .c { color: var(--accent); }
  .m { color: var(--text-3); }
</style>
