<script>
  /**
   * Readers: how the readers of every page are counted, and how they follow and find the site.
   *
   * Statistics is off until one of GoatCounter or Cloudflare Web Analytics is picked with its code or
   * token; what is typed is checked before it is sent, and what the server keeps is shown again. Counting
   * starts with the next publish or Update the site. Follow and find gives the feed and the sitemap
   * addresses, built from the site's address, each with a Copy press. Nothing here reaches the network:
   * the links open in another tab, on a press.
   */
  import Icon from '../../../components/Icon.svelte';
  import { copyText } from '../../../lib/clipboard.js';
  import { onSite } from '../../../lib/websiteHub.js';
  import {
    CLOUDFLARE_BAD, CLOUDFLARE_DASHBOARD, CLOUDFLARE_GUIDE, CLOUDFLARE_MISSING, CLOUDFLARE_SAID, CLOUDFLARE_SIGNUP, CLOUDFLARE_STEPS,
    FEED_SAID, FOLLOW_NONE, FOLLOW_TITLE, GOATCOUNTER_BAD, GOATCOUNTER_MISSING, GOATCOUNTER_SAID, GOATCOUNTER_SIGNUP, GOATCOUNTER_STEPS, HUB_LEADS,
    SITEMAP_SAID, STATS_CHOICES, STATS_INTRO, STATS_OFF_SAID, WEBSITE_HELP as HELP, beaconToken, counterCode,
  } from '../../../lib/websiteSetup.js';
  import HubCard from './HubCard.svelte';
  import HubField from './HubField.svelte';
  import HubPanel from './HubPanel.svelte';

  let { active = false, prefs, savePrefs, address = '' } = $props();

  const [title, sub] = HUB_LEADS.readers;

  // what is typed, until it reads as a code or a token and is saved; the saved one is shown again after
  let codeText = $state('');
  let tokenText = $state('');
  let codeProblem = $state('');
  let tokenProblem = $state('');
  $effect(() => { codeText = prefs.siteStatsCode; });
  $effect(() => { tokenText = prefs.siteStatsToken; });

  const said = $derived({ goatcounter: GOATCOUNTER_SAID, cloudflare: CLOUDFLARE_SAID }[prefs.siteStats] ?? STATS_OFF_SAID);
  const helpOf = { '': HELP.statsOff, goatcounter: HELP.statsGoatcounter, cloudflare: HELP.statsCloudflare };

  const feed = $derived(onSite(address, 'feed.xml'));
  const sitemap = $derived(onSite(address, 'sitemap.xml'));

  function chooseStats(id) {
    if (id !== prefs.siteStats) void savePrefs({ site_stats: id });
  }

  async function saveCode() {
    const code = counterCode(codeText);
    if (code === null) {
      codeProblem = GOATCOUNTER_BAD;
      return;
    }
    codeProblem = '';
    codeText = code;
    if (code === prefs.siteStatsCode) return;
    const saved = await savePrefs({ site_stats_code: code });
    if (saved) codeText = saved.site_stats_code ?? code;
  }

  async function saveToken() {
    const token = beaconToken(tokenText);
    if (token === null) {
      tokenProblem = CLOUDFLARE_BAD;
      return;
    }
    tokenProblem = '';
    tokenText = token;
    if (token === prefs.siteStatsToken) return;
    const saved = await savePrefs({ site_stats_token: token });
    if (saved) tokenText = saved.site_stats_token ?? token;
  }
</script>

<HubPanel id="readers" {active} {title} {sub}>
  <div class="grid">
    <HubCard title="Count readers" guide="settings.statistics" label="Statistics">
      <p>{STATS_INTRO}</p>
      <div class="seg pick" role="radiogroup" aria-label="Count readers with">
        {#each STATS_CHOICES as choice (choice.id)}
          <button type="button" class="seg-btn" class:on={prefs.siteStats === choice.id} role="radio" aria-checked={prefs.siteStats === choice.id}
            title={helpOf[choice.id]} onclick={() => chooseStats(choice.id)}>{choice.label}</button>
        {/each}
      </div>
      <p class="said">{said}</p>

      {#if prefs.siteStats === 'goatcounter'}
        <HubField id="hub-stats-code" label="Site code" hint={prefs.siteStatsCode ? 'Counting every page of the site.' : GOATCOUNTER_MISSING}>
          <input id="hub-stats-code" class="input mono" bind:value={codeText} onchange={saveCode} placeholder="mycode" spellcheck="false" autocomplete="off"
            aria-label="GoatCounter site code" aria-invalid={codeProblem ? 'true' : undefined} title={HELP.statsCode} />
        </HubField>
        {#if codeProblem}<p class="problem" role="alert"><Icon name="alert" size={12} /> {codeProblem}</p>{/if}
        <details class="how" open={!prefs.siteStatsCode}>
          <summary title={HELP.statsHow}>How to make a GoatCounter site</summary>
          <ol>
            {#each GOATCOUNTER_STEPS as [step, text], index (index)}<li><strong>{step}.</strong> {text}</li>{/each}
          </ol>
          <a class="guide" href={GOATCOUNTER_SIGNUP} target="_blank" rel="noopener noreferrer" title={HELP.goatcounterSignup}>
            GoatCounter sign-up <Icon name="external" size={11} /></a>
        </details>
      {:else if prefs.siteStats === 'cloudflare'}
        <HubField id="hub-stats-token" label="Token" hint={prefs.siteStatsToken ? 'Counting every page of the site.' : CLOUDFLARE_MISSING}>
          <input id="hub-stats-token" class="input mono" bind:value={tokenText} onchange={saveToken} placeholder="0123456789abcdef…" spellcheck="false"
            autocomplete="off" aria-label="Cloudflare token" aria-invalid={tokenProblem ? 'true' : undefined} title={HELP.statsToken} />
        </HubField>
        {#if tokenProblem}<p class="problem" role="alert"><Icon name="alert" size={12} /> {tokenProblem}</p>{/if}
        <p class="dash"><a class="guide" href={CLOUDFLARE_DASHBOARD} target="_blank" rel="noopener noreferrer" title={HELP.cloudflareDashboard}>
          Open Cloudflare's dashboard <Icon name="external" size={11} /></a></p>
        <details class="how" open={!prefs.siteStatsToken}>
          <summary title={HELP.statsHow}>How to make a Cloudflare Web Analytics site</summary>
          <ol>
            {#each CLOUDFLARE_STEPS as [step, text], index (index)}<li><strong>{step}.</strong> {text}</li>{/each}
          </ol>
          <div class="guides">
            <a class="guide" href={CLOUDFLARE_SIGNUP} target="_blank" rel="noopener noreferrer" title={HELP.cloudflareSignup}>
              Cloudflare sign-up <Icon name="external" size={11} /></a>
            <a class="guide" href={CLOUDFLARE_GUIDE} target="_blank" rel="noopener noreferrer" title={HELP.cloudflareGuide}>
              Cloudflare’s guide <Icon name="external" size={11} /></a>
          </div>
        </details>
      {/if}
    </HubCard>

    <HubCard title={FOLLOW_TITLE}>
      <p>{FEED_SAID}</p>
      <div class="copyline">
        <code>{feed || '…'}</code>
        <button type="button" class="btn btn-sm" disabled={!feed} onclick={() => copyText(feed, { said: 'Feed address copied' })} title={HELP.copyFeed}>Copy</button>
      </div>
      <p class="gap">{SITEMAP_SAID}</p>
      <div class="copyline">
        <code>{sitemap || '…'}</code>
        <button type="button" class="btn btn-sm" disabled={!sitemap} onclick={() => copyText(sitemap, { said: 'Sitemap address copied' })} title={HELP.copySitemap}>Copy</button>
      </div>
      {#if !address}<p class="hint">{FOLLOW_NONE}</p>{/if}
    </HubCard>
  </div>
</HubPanel>

<style>
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
  .seg.pick { margin-top: 10px; display: inline-flex; }
  .said { margin-top: 8px; font-size: var(--fs-xs); }
  .problem { display: flex; align-items: center; gap: 5px; color: var(--danger); font-size: var(--fs-xs); }
  .dash { margin-top: 2px; font-size: var(--fs-xs); }
  .copyline { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .copyline code { flex: 1; min-width: 0; overflow-wrap: anywhere; background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--r-md);
    padding: 5px 9px; font-family: var(--font-mono); font-size: var(--fs-xs); color: var(--text-1); }
  .gap { margin-top: 14px; }
  .how { margin-top: 12px; border: 1px solid var(--border); border-radius: var(--r-md); padding: 6px 12px 10px; background: var(--bg-0); }
  .how summary { cursor: pointer; color: var(--text-2); font-size: var(--fs-sm); padding: 2px 0; }
  .how ol { margin: 6px 0 4px; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  .guides { display: flex; gap: 14px; flex-wrap: wrap; }
  .guide { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; font-size: var(--fs-xs); color: var(--accent); }
  .mono { font-family: var(--font-mono); }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
