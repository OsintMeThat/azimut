<script>
  /**
   * Settings › Website: the site Azimut makes of the notes published to GitHub Pages, and where
   * the notes are sent. Everything here is optional: a site works with it all left empty.
   *
   * **Site** is its title, the line under it and the credit on its home. **GitHub Pages** and
   * **WordPress** are the two places a note goes (`GitHubPagesSettings.svelte`,
   * `WordPressSettings.svelte`). **Statistics** counts the readers of every page, off until one of
   * GoatCounter or Cloudflare Web Analytics is picked with its code or token. **Update the site**
   * rebuilds the home, list, feed and sitemap without a note, and **Legal notice** starts the
   * page of that name in the open case. **Make it yours** says how to change what Azimut makes.
   * Settings save on change as preferences, the server answering with the canonical value.
   * Nothing here reaches GitHub but Test connection, Update the site and the setup presses
   * (`lib/githubPages.js`). The words are in `lib/websiteSetup.js`.
   */
  import Icon from '../../components/Icon.svelte';
  import GitHubSetupPress from '../../components/GitHubSetupPress.svelte';
  import GitHubPagesSettings from './GitHubPagesSettings.svelte';
  import WordPressSettings from './WordPressSettings.svelte';
  import { caseState, reloadCase, toast } from '../../lib/state.svelte.js';
  import { openNotebook } from '../../lib/navigate.js';
  import { githubReady } from '../../lib/githubPagesSetup.js';
  import { startLegalNotice, updateSite } from '../../lib/githubPages.js';
  import {
    CLOUDFLARE_BAD, CLOUDFLARE_GUIDE, CLOUDFLARE_MISSING, CLOUDFLARE_SAID, CLOUDFLARE_SIGNUP, CLOUDFLARE_STEPS, CREDIT_HINT,
    GOATCOUNTER_BAD, GOATCOUNTER_MISSING, GOATCOUNTER_SAID, GOATCOUNTER_SIGNUP, GOATCOUNTER_STEPS, LEGAL_NO_CASE, LEGAL_PRESS,
    LEGAL_SAID, LEGAL_SENTENCE, SITE_INTRO, SITE_OPTIONAL, SITE_OWN, SITE_OWN_TITLE, SITE_STAYS_YOURS, STATS_CHOICES, STATS_INTRO,
    STATS_OFF_SAID, TAGLINE_HINT, TAGLINE_MAX, TITLE_HINT, TITLE_MAX, UPDATE_NOT_SET, UPDATE_SAID, WEBSITE_HELP as HELP, beaconToken,
    counterCode, ownParts, updateSaid,
  } from '../../lib/websiteSetup.js';

  let { prefs, savePrefs } = $props();

  // the GitHub section's own read, handed up: what Update the site needs to know is whether it is set up
  let github = $state(null);
  const ready = $derived(githubReady(github));

  /** A line saved once the field is left, spaces gathered. */
  function saveLine(key, value) {
    savePrefs({ [key]: value.replace(/\s+/g, ' ').trim() });
  }

  // -- statistics ---------------------------------------------------------------------------------

  // what is typed, until it reads as a code or a token and is saved; the saved one is shown again after
  let codeText = $state('');
  let tokenText = $state('');
  let codeProblem = $state('');
  let tokenProblem = $state('');
  $effect(() => { codeText = prefs.siteStatsCode; });
  $effect(() => { tokenText = prefs.siteStatsToken; });

  const said = $derived({ goatcounter: GOATCOUNTER_SAID, cloudflare: CLOUDFLARE_SAID }[prefs.siteStats] ?? STATS_OFF_SAID);
  const helpOf = { '': HELP.statsOff, goatcounter: HELP.statsGoatcounter, cloudflare: HELP.statsCloudflare };

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

  // -- update the site ----------------------------------------------------------------------------

  // what the press found: null, 'working', or { text, warnings } / { error }
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
        return;
      }
      updated = { text: updateSaid(answer), warnings: Array.isArray(answer?.warnings) ? answer.warnings : [] };
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

  // -- the Legal notice page ----------------------------------------------------------------------

  const caseId = $derived(caseState.current?.id ?? '');
  let legalBusy = $state(false);

  async function startLegal() {
    if (!caseId || legalBusy) return;
    legalBusy = true;
    try {
      const note = await startLegalNotice(caseId);
      // the note is new to the case's list until it is read again
      await reloadCase().catch(() => {});
      openNotebook(note.id);
    } catch (error) {
      toast(`Could not start the Legal notice: ${error.message}`, 'danger');
    } finally {
      legalBusy = false;
    }
  }
</script>

<section class="group" data-guide="settings.website" aria-label="Website">
  <h3>Website</h3>
  <p class="intro">{SITE_INTRO}</p>
  <p class="intro">{SITE_STAYS_YOURS}</p>
  <p class="note">{SITE_OPTIONAL}</p>
</section>

<section class="group" data-guide="settings.site" aria-label="Site">
  <h3>Site</h3>
  <label class="row" title={HELP.siteTitle}>
    <span class="row-label"><span>Title</span><span class="row-hint">{TITLE_HINT}</span></span>
    <input class="input who" value={prefs.siteTitle} maxlength={TITLE_MAX} placeholder={github?.website?.title || 'Your site’s title'}
      title={HELP.siteTitle} onchange={(event) => saveLine('site_title', event.currentTarget.value)} />
  </label>
  <label class="row" title={HELP.siteTagline}>
    <span class="row-label"><span>Tagline</span><span class="row-hint">{TAGLINE_HINT}</span></span>
    <input class="input who" value={prefs.siteTagline} maxlength={TAGLINE_MAX} placeholder="What the site is about"
      title={HELP.siteTagline} onchange={(event) => saveLine('site_tagline', event.currentTarget.value)} />
  </label>
  <div class="row">
    <div class="row-label" title={HELP.siteCredit}>
      <span>Made with Azimut</span>
      <span class="row-hint">{CREDIT_HINT}</span>
    </div>
    <input
      type="checkbox"
      checked={prefs.siteCreditAzimut}
      onchange={(event) => savePrefs({ site_credit_azimut: event.currentTarget.checked })}
      aria-label="Made with Azimut"
      title={HELP.siteCredit}
    />
  </div>
</section>

<GitHubPagesSettings onchange={(value) => (github = value)} />

<WordPressSettings />

<section class="group" data-guide="settings.statistics" aria-label="Statistics">
  <h3>Statistics</h3>
  <p class="intro">{STATS_INTRO}</p>
  <div class="row">
    <div class="row-label">
      <span>Count readers with</span>
      <span class="row-hint">{said}</span>
    </div>
    <div class="seg" role="radiogroup" aria-label="Count readers with">
      {#each STATS_CHOICES as choice (choice.id)}
        <button type="button" class="seg-btn" class:on={prefs.siteStats === choice.id} role="radio" aria-checked={prefs.siteStats === choice.id}
          title={helpOf[choice.id]} onclick={() => chooseStats(choice.id)}>{choice.label}</button>
      {/each}
    </div>
  </div>
  {#if prefs.siteStats === 'goatcounter'}
    <label class="row" title={HELP.statsCode}>
      <span class="row-label">
        <span>GoatCounter site code</span>
        <span class="row-hint">{prefs.siteStatsCode ? 'Counting every page of the site.' : GOATCOUNTER_MISSING}</span>
      </span>
      <input class="input who mono" bind:value={codeText} onchange={saveCode} placeholder="mycode" spellcheck="false" autocomplete="off"
        aria-label="GoatCounter site code" aria-invalid={codeProblem ? 'true' : undefined} title={HELP.statsCode} />
    </label>
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
    <label class="row" title={HELP.statsToken}>
      <span class="row-label">
        <span>Cloudflare token</span>
        <span class="row-hint">{prefs.siteStatsToken ? 'Counting every page of the site.' : CLOUDFLARE_MISSING}</span>
      </span>
      <input class="input who mono" bind:value={tokenText} onchange={saveToken} placeholder="0123456789abcdef…" spellcheck="false" autocomplete="off"
        aria-label="Cloudflare token" aria-invalid={tokenProblem ? 'true' : undefined} title={HELP.statsToken} />
    </label>
    {#if tokenProblem}<p class="problem" role="alert"><Icon name="alert" size={12} /> {tokenProblem}</p>{/if}
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
</section>

<section class="group" data-guide="settings.update-site" aria-label="Update the site">
  <h3>Update the site</h3>
  <p class="intro">{UPDATE_SAID}</p>
  <div class="row actions">
    <span class="result" role="status" data-state={updated?.error ? 'error' : updated && updated !== 'working' ? 'ok' : ''}>
      {#if updated === 'working'}<span class="spinner" aria-hidden="true"></span> Updating {github.account}/{github.repo}…
      {:else if updated?.error}<Icon name="alert" size={12} /> {updated.error}
      {:else if updated}<Icon name="check" size={12} /> {updated.text}
      {:else if setUp}<Icon name="check" size={12} /> {setUp}{/if}
    </span>
    <button type="button" class="btn btn-sm" onclick={update} disabled={!ready || updated === 'working'}
      title={ready ? HELP.siteUpdate : UPDATE_NOT_SET}>Update the site</button>
  </div>
  {#if updated?.warnings?.length}
    <ul class="warnings" aria-label="To mind">
      {#each updated.warnings as warning, index (index)}<li><Icon name="alert" size={12} /> {warning}</li>{/each}
    </ul>
  {/if}
  {#if needs}
    <GitHubSetupPress needs={needs.needs} {github} detail={needs.detail} ondone={after} />
  {/if}
</section>

<section class="group" data-guide="settings.legal" aria-label="Legal notice">
  <h3>Legal notice</h3>
  <p class="intro">{LEGAL_SENTENCE}</p>
  <div class="row actions">
    <span class="result">{LEGAL_SAID}</span>
    <button type="button" class="btn btn-sm" onclick={startLegal} disabled={!caseId || legalBusy}
      title={caseId ? HELP.legalStart : LEGAL_NO_CASE}>{legalBusy ? 'Starting…' : LEGAL_PRESS}</button>
  </div>
</section>

<section class="group" data-guide="settings.website-own" aria-label={SITE_OWN_TITLE}>
  <details class="own">
    <summary title={HELP.siteOwn}>{SITE_OWN_TITLE}</summary>
    <ul>
      {#each SITE_OWN as [lead, text] (lead)}
        <li><strong>{lead}</strong>: {#each ownParts(text) as part, index (index)}{#if part.code !== undefined}<code>{part.code}</code>{:else if part.href}<a
          href={part.href} target="_blank" rel="noopener noreferrer" title={HELP.siteOwnGuide}>{part.link}</a>{:else}{part.text}{/if}{/each}</li>
      {/each}
    </ul>
  </details>
</section>

<style>
  .who { width: 220px; flex-shrink: 0; }
  .mono { font-family: var(--font-mono); }
  label.row { cursor: default; }
  .actions { gap: 12px; }
  .result { flex: 1; min-width: 0; display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.4; overflow-wrap: anywhere; }
  .result[data-state='ok'] { color: var(--ok); }
  .result[data-state='error'] { color: var(--danger); }
  .problem { display: flex; align-items: center; gap: 5px; margin: -2px 0 8px; color: var(--danger); font-size: var(--fs-xs); }
  .warnings { list-style: none; margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 3px; color: var(--warn); font-size: var(--fs-xs); }
  .warnings li { display: flex; align-items: center; gap: 5px; }
  .spinner { flex: none; width: 11px; height: 11px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  .group :global(.needs) { margin-top: 8px; }
  .how, .own { margin-top: 6px; border: 1px solid var(--border); border-radius: var(--r-md); padding: 6px 12px 10px; background: var(--bg-1); }
  .own { margin-top: 0; }
  .how summary, .own summary { cursor: pointer; color: var(--text-2); font-size: var(--fs-sm); padding: 2px 0; }
  .how ol { margin: 6px 0 4px; padding-left: 20px; display: flex; flex-direction: column; gap: 4px; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  .own ul { margin: 6px 0 2px; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  .own code { font-family: var(--font-mono); font-size: 0.95em; color: var(--text-1); overflow-wrap: anywhere; }
  .own a { color: var(--accent); }
  .guides { display: flex; gap: 14px; flex-wrap: wrap; }
  .guide { display: inline-flex; align-items: center; gap: 4px; margin-top: 4px; font-size: var(--fs-xs); color: var(--accent); }
</style>
