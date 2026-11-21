<script>
  /**
   * Numbers: how many read the site, read from Cloudflare Web Analytics on the Read the numbers press
   * (`lib/siteNumbers.svelte.js`). The whole site over 7 and 30 days, each article's page views with its
   * title linking to it, and the referrers and countries the visits came from, ranked.
   *
   * Under them, where the numbers come from, field by field: the account ID, saved as a preference once
   * it reads as one, and the API token, which goes up once when typed and never comes back (its last
   * characters only), with Forget. The site tag is found by the press from the site token Readers holds;
   * typing it by hand, folded under Set the site tag by hand, wins, and that fold opens when the press
   * could not find it. The steps stay open while something is missing (`lib/websiteSetup.js`). Nothing
   * here reaches Cloudflare but the press; the token state is read from this computer on mount. Which
   * article a page is comes from the session's read of the site (`lib/siteRead.svelte.js`); a page it
   * does not know shows its path.
   */
  import Icon from '../../../components/Icon.svelte';
  import { applyPrefs, toast } from '../../../lib/state.svelte.js';
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import {
    forgetCloudflareToken, forgetNumbers, readCloudflare, runNumbers, saveCloudflareToken, siteNumbers,
  } from '../../../lib/siteNumbers.svelte.js';
  import { countryOf, numbersRows } from '../../../lib/websiteHub.js';
  import {
    ACCOUNT_BAD, ACCOUNT_HINT, API_TOKEN_BAD, API_TOKEN_HINT, CLOUDFLARE_TOKEN_GUIDE, COUNTRIES_TITLE, NO_REFERRER, NUMBERS_AGAIN,
    NUMBERS_BUSY, NUMBERS_FIRST, NUMBERS_FREE, NUMBERS_HEAD, NUMBERS_INTRO, NUMBERS_NONE, NUMBERS_NOT_SET, NUMBERS_PRESS, NUMBERS_SAMPLED,
    NUMBERS_SETUP, NUMBERS_STAYS, NUMBERS_STEPS, NUMBERS_TITLE, NUMBERS_TOTAL, RANKED_NONE, REFERRERS_TITLE, TAG_BAD, TAG_FOUND_HINT, TAG_HAND_TITLE,
    TAG_HINT, TAG_WHERE,
    WEBSITE_HELP as HELP, apiToken, apiTokenKeptSaid, cloudflareId, countSaid, readAtSaid, tileSaid, whenSaid,
  } from '../../../lib/websiteSetup.js';
  import HubCard from './HubCard.svelte';
  import HubField from './HubField.svelte';

  let { prefs, savePrefs, address = '' } = $props();

  // the token as this computer keeps it, null until read from it
  let cloud = $state(null);
  $effect(() => {
    let live = true;
    readCloudflare()
      .then((value) => { if (live) cloud = value; })
      .catch(() => { if (live) cloud = { token: { set: false, hint: '' } }; });
    return () => { live = false; };
  });

  // what is typed, until it reads as an ID and is saved; the saved one is shown again after
  let accountText = $state('');
  let tagText = $state('');
  let tokenText = $state('');
  let accountProblem = $state('');
  let tagProblem = $state('');
  let tokenProblem = $state('');
  $effect(() => { accountText = prefs.siteStatsAccount; });
  $effect(() => { tagText = prefs.siteStatsTag; });

  // a tag typed by hand, which wins over the site token; one the press found stands for the site token
  const handTag = $derived(prefs.siteStatsTagFound ? '' : prefs.siteStatsTag);
  const key = $derived(`${prefs.siteStatsAccount}/${prefs.siteStatsToken}/${handTag}`);
  const ready = $derived(Boolean(prefs.siteStatsAccount && cloud?.token.set && (prefs.siteStatsToken || handTag)));
  // the fold holding the tag field opens when the press could not find the tag, or one is typed there
  const tagOpen = $derived(siteNumbers.needs === 'tag' || Boolean(handTag) || Boolean(tagProblem));
  // numbers read with another account, site token or tag typed by hand are no numbers of this one
  $effect(() => {
    if (siteNumbers.key && siteNumbers.key !== key) forgetNumbers();
  });

  const data = $derived(siteNumbers.data);
  const rows = $derived(numbersRows(data, siteRead.data, address));
  const quiet = $derived(Boolean(data) && !rows.length && !data.total.month.views);
  const windows = $derived(data ? [['7 days', data.total.week], ['30 days', data.total.month]] : []);

  /** The press: the numbers, and the site tag the server found and kept shown in its field. */
  async function read() {
    const answer = await runNumbers(key);
    if (answer?.tag_found && typeof answer.tag === 'string' && answer.tag !== prefs.siteStatsTag) {
      applyPrefs({ site_stats_tag: answer.tag, site_stats_tag_found: true });
    }
  }

  async function saveId(which) {
    const typed = which === 'account' ? accountText : tagText;
    const found = cloudflareId(typed, which === 'account' ? 'account' : 'tag');
    const prefKey = which === 'account' ? 'siteStatsAccount' : 'siteStatsTag';
    if (found === null) {
      if (which === 'account') accountProblem = ACCOUNT_BAD;
      else tagProblem = TAG_BAD;
      return;
    }
    if (which === 'account') {
      accountProblem = '';
      accountText = found;
    } else {
      tagProblem = '';
      tagText = found;
    }
    if (found === prefs[prefKey]) return;
    await savePrefs({ [which === 'account' ? 'site_stats_account' : 'site_stats_tag']: found });
  }

  async function saveToken() {
    if (!tokenText.trim()) return;
    const token = apiToken(tokenText);
    if (token === null) {
      tokenProblem = API_TOKEN_BAD;
      return;
    }
    tokenProblem = '';
    try {
      cloud = await saveCloudflareToken(token);
      tokenText = '';
      toast('API token kept on this computer', 'ok');
    } catch (error) {
      tokenProblem = error.message;
    }
  }

  async function forget() {
    try {
      cloud = await forgetCloudflareToken();
      tokenText = '';
      tokenProblem = '';
      toast('API token forgotten on this computer', 'ok');
    } catch (error) {
      toast(error.message, 'danger');
    }
  }
</script>

<HubCard title={NUMBERS_TITLE} label={NUMBERS_TITLE} guide="settings.numbers">
  {#snippet aside()}
    {#if ready}<span class="hub-pill ok">Set up</span>{:else if cloud}<span class="hub-pill">Not set up</span>{/if}
  {/snippet}
  <p>{NUMBERS_INTRO}</p>

  <div class="press-line">
    <button type="button" class="btn btn-sm" onclick={read} disabled={!ready || siteNumbers.busy} aria-busy={siteNumbers.busy}
      title={ready ? HELP.statsNumbers : NUMBERS_NOT_SET}>
      <Icon name="download" size={12} />{data ? NUMBERS_AGAIN : NUMBERS_PRESS}</button>
    {#if siteNumbers.busy}
      <span class="hub-line" data-state="busy" role="status"><span class="hub-spinner" aria-hidden="true"></span>{NUMBERS_BUSY}</span>
    {:else if siteNumbers.error}
      <span class="hub-line" data-state="error" role="status"><Icon name="alert" size={12} />{siteNumbers.error}</span>
    {:else}
      <span class="hub-line" role="status">{siteNumbers.at ? readAtSaid(whenSaid(siteNumbers.at)) : ''}</span>
    {/if}
  </div>

  {#if data && quiet}
    <p class="numbers-note">{NUMBERS_NONE}</p>
  {:else if data}
    <div class="tiles" role="group" aria-label={NUMBERS_TOTAL}>
      {#each windows as [days, counts] (days)}
        <div class="tile">
          <span class="tile-days">{NUMBERS_TOTAL}, {days}</span>
          <span class="tile-count">{countSaid(counts.views)}</span>
          <span class="tile-said">{tileSaid(counts)}</span>
        </div>
      {/each}
    </div>

    <table class="numbers-table" aria-label="Page views by page">
      <thead>
        <tr>
          <th scope="col">{NUMBERS_HEAD[0]}</th>
          <th scope="col" class="num" title={HELP.statsWeek}>{NUMBERS_HEAD[1]}</th>
          <th scope="col" class="num" title={HELP.statsMonth}>{NUMBERS_HEAD[2]}</th>
        </tr>
      </thead>
      <tbody>
        {#each rows as row (row.key)}
          <tr class:unknown={!row.known}>
            <th scope="row">
              {#if row.href}
                <a href={row.href} target="_blank" rel="noopener noreferrer" title={HELP.statsOpenPage}>{row.title}</a>
              {:else}
                <span>{row.title}</span>
              {/if}
            </th>
            <td class="num">{countSaid(row.week.views)}</td>
            <td class="num">{countSaid(row.month.views)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if data.sampled}<p class="hub-hint numbers-hint">{NUMBERS_SAMPLED}</p>{/if}

    <div class="ranked">
      <section aria-label={REFERRERS_TITLE}>
        <h4>{REFERRERS_TITLE} <span class="ranked-unit">visits, 30 days</span></h4>
        {#if data.referrers.length}
          <ol class="rank-list">
            {#each data.referrers as one, index (index)}
              <li><span class="rank-name" class:quiet-name={!one.host}>{one.host || NO_REFERRER}</span><span class="rank-count">{countSaid(one.visits)}</span></li>
            {/each}
          </ol>
        {:else}<p class="numbers-note">{RANKED_NONE}</p>{/if}
      </section>
      <section aria-label={COUNTRIES_TITLE}>
        <h4>{COUNTRIES_TITLE} <span class="ranked-unit">page views, 30 days</span></h4>
        {#if data.countries.length}
          <ol class="rank-list">
            {#each data.countries as one, index (index)}
              <li><span class="rank-name">{countryOf(one.country)}</span><span class="rank-count">{countSaid(one.views)}</span></li>
            {/each}
          </ol>
        {:else}<p class="numbers-note">{RANKED_NONE}</p>{/if}
      </section>
    </div>
  {:else if ready && !siteNumbers.busy && !siteNumbers.error}
    <p class="numbers-note">{NUMBERS_FIRST}</p>
  {/if}

  <div class="fields">
    <HubField id="hub-stats-account" label="Account ID" hint={ACCOUNT_HINT} problem={accountProblem}>
      <input id="hub-stats-account" class="input hub-mono" bind:value={accountText} onchange={() => saveId('account')} placeholder="0123456789abcdef…"
        spellcheck="false" autocomplete="off" aria-label="Cloudflare account ID" aria-invalid={accountProblem ? 'true' : undefined} title={HELP.statsAccount} />
    </HubField>
    <HubField id="hub-stats-api" label="API token" hint={cloud?.token.set ? apiTokenKeptSaid(cloud.token.hint) : API_TOKEN_HINT} problem={tokenProblem}>
      <span class="token-line">
        <input id="hub-stats-api" class="input hub-mono" type="password" bind:value={tokenText} onchange={saveToken}
          placeholder={cloud?.token.set ? `•••• ${cloud.token.hint.replace('…', '')}` : 'Paste the API token'} autocomplete="new-password" spellcheck="false"
          disabled={cloud === null} aria-label="Cloudflare API token" aria-invalid={tokenProblem ? 'true' : undefined} title={HELP.statsApiToken} />
        <button type="button" class="btn btn-ghost btn-sm" onclick={forget} disabled={!cloud?.token.set} title={HELP.statsApiForget}>Forget</button>
      </span>
    </HubField>
  </div>

  <details class="hub-how tag-hand" open={tagOpen}>
    <summary title={HELP.statsTagHand}>{TAG_HAND_TITLE}</summary>
    <div class="tag-field">
      <HubField id="hub-stats-tag" label="Site tag" hint={prefs.siteStatsTagFound ? TAG_FOUND_HINT : TAG_HINT} problem={tagProblem}>
        <input id="hub-stats-tag" class="input hub-mono" bind:value={tagText} onchange={() => saveId('tag')} placeholder="fedcba9876543210…"
          spellcheck="false" autocomplete="off" aria-label="Web Analytics site tag" aria-invalid={tagProblem ? 'true' : undefined} title={HELP.statsTag} />
      </HubField>
    </div>
    <p class="how-note">{TAG_WHERE}</p>
  </details>

  <details class="hub-how" open={!ready}>
    <summary title={HELP.statsNumbersHow}>{NUMBERS_SETUP}</summary>
    <ol>
      {#each NUMBERS_STEPS as [step, text], index (index)}<li><strong>{step}.</strong> {text}</li>{/each}
    </ol>
    <p class="how-note">{NUMBERS_FREE}</p>
    <p class="how-note">{NUMBERS_STAYS}</p>
    <a class="hub-ext" href={CLOUDFLARE_TOKEN_GUIDE} target="_blank" rel="noopener noreferrer" title={HELP.statsTokenGuide}>
      Cloudflare’s guide to the token <Icon name="external" size={11} /></a>
  </details>
</HubCard>

<style>
  .press-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-top: 12px; }
  .press-line .btn { flex: none; }
  .numbers-note { margin: 12px 0 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  .numbers-hint { margin-top: 6px; }

  .tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 14px; }
  .tile { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-md);
    background: var(--bg-0); }
  .tile-days { color: var(--text-3); font-size: var(--fs-xs); }
  .tile-count { color: var(--text-1); font-size: var(--fs-xl); font-weight: 600; line-height: 1.2; font-variant-numeric: tabular-nums; }
  .tile-said { color: var(--text-2); font-size: var(--fs-xs); overflow-wrap: anywhere; }

  .numbers-table { width: 100%; margin-top: 14px; border-collapse: collapse; font-size: var(--fs-sm); table-layout: fixed; }
  .numbers-table th, .numbers-table td { padding: 6px 0; border-top: 1px solid var(--border); text-align: left; font-weight: 400; vertical-align: baseline; }
  .numbers-table thead th { border-top: 0; padding-top: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .numbers-table tbody th { overflow: hidden; color: var(--text-1); white-space: nowrap; text-overflow: ellipsis; }
  .numbers-table tbody th a { color: var(--text-1); }
  .numbers-table tbody th a:hover { color: var(--accent); }
  .numbers-table tr.unknown th, .numbers-table tr.unknown th a { color: var(--text-2); font-family: var(--font-mono); font-size: 0.86em; }
  .numbers-table .num { width: 76px; text-align: right; color: var(--text-2); font-variant-numeric: tabular-nums; }
  .numbers-table thead .num { color: var(--text-3); }

  .ranked { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; margin-top: 16px; }
  .ranked h4 { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; margin: 0 0 4px; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; }
  .ranked-unit { color: var(--text-3); font-size: var(--fs-xs); font-weight: 400; }
  .rank-list { list-style: none; margin: 0; padding: 0; }
  .rank-list li { display: flex; align-items: baseline; gap: 10px; padding: 4px 0; border-top: 1px solid var(--border); font-size: var(--fs-sm); }
  .rank-list li:first-child { border-top: 0; }
  .rank-name { flex: 1; min-width: 0; overflow: hidden; color: var(--text-1); white-space: nowrap; text-overflow: ellipsis; }
  .rank-name.quiet-name { color: var(--text-3); font-style: italic; }
  .rank-count { flex: none; color: var(--text-2); font-variant-numeric: tabular-nums; }

  .fields { margin-top: 18px; border-top: 1px solid var(--border); padding-top: 6px; }
  .token-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .token-line .input { flex: 1; min-width: 0; }
  .token-line .btn { flex: none; }
  .tag-field { margin-top: 6px; }
  .how-note { margin: 6px 0 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  .hub-how .hub-ext { margin-top: 6px; }

  @container card (min-width: 560px) {
    .ranked { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
  }
  /* a narrow card stacks its tiles and lets a title wrap rather than vanish behind its counts */
  @container card (max-width: 420px) {
    .tiles { grid-template-columns: minmax(0, 1fr); }
    .numbers-table .num { width: 48px; }
    .numbers-table tbody th { white-space: normal; overflow-wrap: break-word; }
  }
</style>
