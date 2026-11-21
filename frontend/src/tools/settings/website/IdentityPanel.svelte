<script>
  /**
   * Identity: the site's name, its line, its logo and the credit, beside a preview of the three places
   * a reader meets them. The name and the line save when the field is left and show in the preview
   * and the hero as they are typed. The logo is a PNG of the site's own, else the Publishing logo;
   * picking one and going back are both on a press, checked here before anything is sent
   * (`lib/githubPages.js`). Nothing here reaches GitHub.
   */
  import { appInfo, toast } from '../../../lib/state.svelte.js';
  import { LOGO_MAX_BYTES } from '../../../lib/publishingHelp.js';
  import { removeSiteLogo, uploadSiteLogo } from '../../../lib/githubPages.js';
  import { hostOf } from '../../../lib/websiteHub.js';
  import {
    CREDIT_HINT, CREDIT_LABEL, HUB_LEADS, OWN_HOME_PILL, SITE_LOGO_BIG, SITE_LOGO_LABEL, SITE_LOGO_NOT_PNG, SITE_LOGO_PICK, SITE_LOGO_REMOVE,
    SITE_LOGO_RESET, SITE_LOGO_SAID, SITE_NAME_LABEL, TAGLINE_HINT, TAGLINE_LABEL, TAGLINE_MAX, TAGLINE_PLACEHOLDER, TITLE_HINT, TITLE_MAX, UNNAMED,
    WEBSITE_HELP as HELP, nameFallbackSaid, ownHomeSaid,
  } from '../../../lib/websiteSetup.js';
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import HubCard from './HubCard.svelte';
  import HubField from './HubField.svelte';
  import HubPanel from './HubPanel.svelte';
  import SitePreview from './SitePreview.svelte';

  let {
    active = false,
    prefs,
    savePrefs,
    /** What is typed in the two fields, shared with the hero. */
    name = $bindable(''),
    tagline = $bindable(''),
    /** The GitHub account, what an empty name falls back to, and the name the site shows now. */
    account = '',
    fallbackName = '',
    shownName = '',
    /** Where the site's logo comes from (`site`, `publishing` or ''), and where it is read. */
    logoFrom = '',
    logoUrl = '',
    address = '',
  } = $props();

  const [title, sub] = HUB_LEADS.identity;
  const read = $derived(siteRead.data);
  let fileInput = $state(null);
  let busy = $state(false);
  // what was refused of a picked file, said under the logo until the next pick
  let problem = $state('');
  // a logo that does not load shows the empty well rather than a broken picture
  let failed = $state('');
  const shown = $derived(logoUrl && failed !== logoUrl ? logoUrl : '');

  const clean = (value) => value.replace(/\s+/g, ' ').trim();

  function saveName(value) {
    name = clean(value);
    if (name !== prefs.siteTitle) void savePrefs({ site_title: name });
  }

  function saveTagline(value) {
    tagline = clean(value);
    if (tagline !== prefs.siteTagline) void savePrefs({ site_tagline: tagline });
  }

  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  async function pick(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = ''; // the same file can be picked again
    if (!file || busy) return;
    problem = '';
    if (file.size > LOGO_MAX_BYTES) {
      problem = SITE_LOGO_BIG;
      return;
    }
    const head = new Uint8Array(await file.slice(0, PNG_MAGIC.length).arrayBuffer());
    if (!PNG_MAGIC.every((byte, index) => head[index] === byte)) {
      problem = SITE_LOGO_NOT_PNG;
      return;
    }
    busy = true;
    try {
      await uploadSiteLogo(file);
      prefs.siteLogoSet = true;
      prefs.picturesRev += 1;
      toast('Site logo saved', 'ok');
    } catch (error) {
      problem = error.message;
    } finally {
      busy = false;
    }
  }

  async function reset() {
    if (busy) return;
    busy = true;
    problem = '';
    try {
      await removeSiteLogo();
      prefs.siteLogoSet = false;
      prefs.picturesRev += 1;
      toast(prefs.logoSet ? 'The site uses your Publishing logo again' : 'Site logo removed', 'ok');
    } catch (error) {
      problem = error.message;
    } finally {
      busy = false;
    }
  }
</script>

<HubPanel id="identity" {active} {title} {sub}>
  <div class="hub-grid">
    <HubCard guide="settings.site" label="Site">
      <HubField id="hub-site-name" label={SITE_NAME_LABEL} hint="{TITLE_HINT} {nameFallbackSaid({ report: prefs.reportName, account })}">
        <input id="hub-site-name" class="input" bind:value={name} maxlength={TITLE_MAX} placeholder={fallbackName || UNNAMED} autocomplete="off"
          title={HELP.siteTitle} onchange={(event) => saveName(event.currentTarget.value)} />
      </HubField>
      <HubField id="hub-site-tagline" label={TAGLINE_LABEL} hint={TAGLINE_HINT}>
        <input id="hub-site-tagline" class="input" bind:value={tagline} maxlength={TAGLINE_MAX} placeholder={TAGLINE_PLACEHOLDER} autocomplete="off"
          title={HELP.siteTagline} onchange={(event) => saveTagline(event.currentTarget.value)} />
      </HubField>
      <HubField label={SITE_LOGO_LABEL} hint={SITE_LOGO_SAID[logoFrom]} {problem}>
        <span class="logo-pick">
          <span class="well" class:blank={!shown}>{#if shown}<img src={shown} alt="The logo the site uses" onerror={() => (failed = logoUrl)} />{/if}</span>
          <span class="opts">
            <button type="button" class="btn btn-sm" onclick={() => fileInput?.click()} disabled={busy} title={HELP.siteLogoPick}>{SITE_LOGO_PICK}</button>
            {#if prefs.siteLogoSet}
              <button type="button" class="btn btn-sm btn-ghost" onclick={reset} disabled={busy}
                title={prefs.logoSet ? HELP.siteLogoReset : HELP.siteLogoRemove}>{prefs.logoSet ? SITE_LOGO_RESET : SITE_LOGO_REMOVE}</button>
            {/if}
          </span>
        </span>
        <input bind:this={fileInput} class="file" type="file" accept="image/png" tabindex="-1" aria-hidden="true" title={HELP.siteLogoPick} onchange={pick} />
      </HubField>
      <HubField id="hub-site-credit" label={CREDIT_LABEL} hint={CREDIT_HINT}>
        <input id="hub-site-credit" class="switch" type="checkbox" checked={prefs.siteCreditAzimut} title={HELP.siteCredit}
          onchange={(event) => savePrefs({ site_credit_azimut: event.currentTarget.checked })} />
      </HubField>
    </HubCard>

    <div class="side">
      <SitePreview name={shownName || UNNAMED} {tagline} {logoUrl} credit={prefs.siteCreditAzimut} version={appInfo.version} {read} />
      {#if read?.home === 'yours'}
        <p class="own-home"><span class="hub-pill info">{OWN_HOME_PILL}</span><span>{ownHomeSaid(hostOf(address))}</span></p>
      {/if}
    </div>
  </div>
</HubPanel>

<style>
  .side { min-width: 0; }
  .logo-pick { display: flex; align-items: center; gap: 12px; }
  .well { display: block; flex: none; width: 52px; height: 52px; overflow: hidden; border-radius: 50%; background: #fff; border: 1px solid var(--border-strong); }
  .well img { width: 100%; height: 100%; object-fit: cover; }
  .well.blank { background: repeating-linear-gradient(135deg, var(--bg-2) 0 6px, var(--bg-3) 6px 12px); }
  .opts { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
  .file { display: none; }
  .switch { appearance: none; position: relative; flex: none; align-self: flex-start; width: 34px; height: 19px; margin: 4px 0 0; border: 0;
    border-radius: 99px; background: var(--bg-3); box-shadow: inset 0 0 0 1px var(--border-strong); cursor: pointer;
    transition: background 0.15s var(--ease); }
  .switch::after { content: ''; position: absolute; left: 2px; top: 2px; width: 15px; height: 15px; border-radius: 50%; background: var(--text-2);
    transition: left 0.15s var(--ease), background 0.15s var(--ease); }
  .switch:checked { background: var(--accent); box-shadow: none; }
  .switch:checked::after { left: 17px; background: var(--accent-text); }
  .switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .own-home { display: flex; align-items: flex-start; gap: 8px; margin: 10px 0 0; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.6; }
  @media (prefers-reduced-motion: reduce) { .switch, .switch::after { transition: none; } }
</style>
