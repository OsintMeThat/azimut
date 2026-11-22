<script>
  /**
   * Readers: how the readers of every page are counted, and how they follow and find the site.
   *
   * Counting is off until one of GoatCounter or Cloudflare Web Analytics is picked with its code or
   * site token; what is typed is checked before it is sent, and what the server keeps is shown again.
   * It starts with the next publish or Update the site. With Cloudflare, Numbers reads how many read
   * each article on its press (`NumbersCard.svelte`); GoatCounter keeps its numbers on its own page.
   * Follow and find gives the feed and the sitemap addresses, built from the site's address, each with
   * a Copy press. Nothing here reaches the network but Read the numbers: the links open in another
   * tab, on a press.
   */
  import Icon from '../../../components/Icon.svelte';
  import { copyText } from '../../../lib/clipboard.js';
  import { onSite } from '../../../lib/websiteHub.js';
  import {
    CLOUDFLARE_BAD, CLOUDFLARE_DASHBOARD, CLOUDFLARE_GUIDE, CLOUDFLARE_MISSING, CLOUDFLARE_SAID, CLOUDFLARE_SIGNUP, CLOUDFLARE_STEPS, COPY_PRESS,
    COUNTING_SAID, FEED_SAID, FOLLOW_NONE, FOLLOW_TITLE, GOATCOUNTER_BAD, GOATCOUNTER_MISSING, GOATCOUNTER_SAID, GOATCOUNTER_SIGNUP, GOATCOUNTER_STEPS,
    HUB_LEADS, NUMBERS_GOATCOUNTER, SITEMAP_SAID, STATS_CHOICES, STATS_INTRO, STATS_OFF_SAID, STATS_TITLE, WEBSITE_HELP as HELP, beaconToken,
    counterCode,
  } from '../../../lib/websiteSetup.js';
  import HubCard from './HubCard.svelte';
  import HubField from './HubField.svelte';
  import HubPanel from './HubPanel.svelte';
  import NumbersCard from './NumbersCard.svelte';

  let { active = false, prefs, savePrefs, address = '' } = $props();

  const [title, sub] = HUB_LEADS.readers;
  const HOVER = { '': HELP.statsOff, goatcounter: HELP.statsGoatcounter, cloudflare: HELP.statsCloudflare };

  // what is typed, until it reads as a code or a token and is saved; the saved one is shown again after
  let codeText = $state('');
  let tokenText = $state('');
  let codeProblem = $state('');
  let tokenProblem = $state('');
  $effect(() => { codeText = prefs.siteStatsCode; });
  $effect(() => { tokenText = prefs.siteStatsToken; });

  const said = $derived({ goatcounter: GOATCOUNTER_SAID, cloudflare: CLOUDFLARE_SAID }[prefs.siteStats] ?? STATS_OFF_SAID);
  const follow = $derived([
    { id: 'feed', said: FEED_SAID, address: onSite(address, 'feed.xml'), help: HELP.copyFeed, copied: 'Feed address copied' },
    { id: 'sitemap', said: SITEMAP_SAID, address: onSite(address, 'sitemap.xml'), help: HELP.copySitemap, copied: 'Sitemap address copied' },
  ]);

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
  <div class="hub-grid">
    <HubCard title={STATS_TITLE} guide="settings.statistics" label="Statistics">
      <p>{STATS_INTRO}</p>
      <div class="seg pick" role="radiogroup" aria-label="Count readers with">
        {#each STATS_CHOICES as choice (choice.id)}
          <button type="button" class="seg-btn" class:on={prefs.siteStats === choice.id} role="radio" aria-checked={prefs.siteStats === choice.id}
            title={HOVER[choice.id]} onclick={() => chooseStats(choice.id)}>{choice.label}</button>
        {/each}
      </div>
      <p class="said">{said}</p>

      {#if prefs.siteStats === 'goatcounter'}
        <div class="fields">
          <HubField id="hub-stats-code" label="Site code" hint={prefs.siteStatsCode ? COUNTING_SAID : GOATCOUNTER_MISSING} problem={codeProblem}>
            <input id="hub-stats-code" class="input hub-mono" bind:value={codeText} onchange={saveCode} placeholder="mycode" spellcheck="false"
              autocomplete="off" aria-label="GoatCounter site code" aria-invalid={codeProblem ? 'true' : undefined} title={HELP.statsCode} />
          </HubField>
        </div>
        <details class="hub-how" open={!prefs.siteStatsCode}>
          <summary title={HELP.statsHow}>How to make a GoatCounter site</summary>
          <ol>
            {#each GOATCOUNTER_STEPS as [step, text], index (index)}<li><strong>{step}.</strong> {text}</li>{/each}
          </ol>
          <a class="hub-ext" href={GOATCOUNTER_SIGNUP} target="_blank" rel="noopener noreferrer" title={HELP.goatcounterSignup}>
            GoatCounter sign-up <Icon name="external" size={11} /></a>
        </details>
        <p class="elsewhere">{NUMBERS_GOATCOUNTER}</p>
        {#if prefs.siteStatsCode}
          <a class="hub-ext" href="https://{prefs.siteStatsCode}.goatcounter.com/" target="_blank" rel="noopener noreferrer" title={HELP.goatcounterOwn}>
            {prefs.siteStatsCode}.goatcounter.com <Icon name="external" size={11} /></a>
        {/if}
      {:else if prefs.siteStats === 'cloudflare'}
        <div class="fields">
          <HubField id="hub-stats-token" label="Site token" hint={prefs.siteStatsToken ? COUNTING_SAID : CLOUDFLARE_MISSING} problem={tokenProblem}>
            <input id="hub-stats-token" class="input hub-mono" bind:value={tokenText} onchange={saveToken} placeholder="0123456789abcdef…" spellcheck="false"
              autocomplete="off" aria-label="Cloudflare site token" aria-invalid={tokenProblem ? 'true' : undefined} title={HELP.statsToken} />
          </HubField>
        </div>
        <p class="dash"><a class="hub-ext" href={CLOUDFLARE_DASHBOARD} target="_blank" rel="noopener noreferrer" title={HELP.cloudflareDashboard}>
          Open Cloudflare's dashboard <Icon name="external" size={11} /></a></p>
        <details class="hub-how" open={!prefs.siteStatsToken}>
          <summary title={HELP.statsHow}>How to make a Cloudflare Web Analytics site</summary>
          <ol>
            {#each CLOUDFLARE_STEPS as [step, text], index (index)}<li><strong>{step}.</strong> {text}</li>{/each}
          </ol>
          <span class="guides">
            <a class="hub-ext" href={CLOUDFLARE_SIGNUP} target="_blank" rel="noopener noreferrer" title={HELP.cloudflareSignup}>
              Cloudflare sign-up <Icon name="external" size={11} /></a>
            <a class="hub-ext" href={CLOUDFLARE_GUIDE} target="_blank" rel="noopener noreferrer" title={HELP.cloudflareGuide}>
              Cloudflare’s guide <Icon name="external" size={11} /></a>
          </span>
        </details>
      {/if}
    </HubCard>

    <HubCard title={FOLLOW_TITLE} label={FOLLOW_TITLE}>
      {#each follow as one (one.id)}
        <p class="follow">{one.said}</p>
        <div class="copyline">
          <code class:none={!one.address}>{one.address || '…'}</code>
          <button type="button" class="btn btn-sm" disabled={!one.address} onclick={() => copyText(one.address, { said: one.copied })} title={one.help}>
            <Icon name="copy" size={12} />{COPY_PRESS}</button>
        </div>
      {/each}
      {#if !address}<p class="none-said">{FOLLOW_NONE}</p>{/if}
    </HubCard>
  </div>

  {#if prefs.siteStats === 'cloudflare'}
    <div class="hub-gap"><NumbersCard {prefs} {savePrefs} {address} /></div>
  {/if}
</HubPanel>

<style>
  /* the settings pane's own segmented control, let wrap when the card is narrow */
  .pick { display: inline-flex; flex-wrap: wrap; max-width: 100%; margin-top: 12px; }
  .said { margin-top: 8px; color: var(--text-2); font-size: var(--fs-xs); }
  .fields { margin-top: 6px; }
  .dash { margin-top: 2px; }
  .elsewhere { margin-top: 12px; color: var(--text-2); font-size: var(--fs-xs); }
  .elsewhere + .hub-ext { margin-top: 4px; }
  .guides { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; }
  .follow { color: var(--text-2); }
  .follow:not(:first-of-type) { margin-top: 16px; }
  .copyline { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
  .copyline code { flex: 1; min-width: 0; padding: 5px 9px; overflow: hidden; border: 1px solid var(--border); border-radius: var(--r-md); background: var(--bg-2);
    color: var(--text-1); font-family: var(--font-mono); font-size: var(--fs-xs); white-space: nowrap; text-overflow: ellipsis; }
  .copyline code.none { color: var(--text-3); }
  .copyline .btn { flex: none; }
  .none-said { margin-top: 10px; color: var(--text-3); font-size: var(--fs-xs); }
</style>
