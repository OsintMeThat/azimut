<script>
  /**
   * Identity: the site's name, its line, its logo and the credit, beside a preview of the three places
   * a reader meets them. The name and the line save when the field is left and show in the preview (and
   * the hero) as they are typed. The logo is a PNG of the site's own, else the Publishing logo; picking
   * one and putting the Publishing logo back are both on a press (`lib/githubPages.js`). Nothing here
   * reaches GitHub.
   */
  import { appInfo, toast } from '../../../lib/state.svelte.js';
  import { LOGO_MAX_BYTES } from '../../../lib/publishingHelp.js';
  import { removeSiteLogo, uploadSiteLogo } from '../../../lib/githubPages.js';
  import { hostOf } from '../../../lib/websiteHub.js';
  import {
    CREDIT_HINT, HUB_LEADS, OWN_HOME_PILL, SITE_LOGO_BIG, SITE_LOGO_LABEL, SITE_LOGO_NOT_PNG, SITE_LOGO_PICK, SITE_LOGO_RESET, SITE_LOGO_SAID,
    SITE_NAME_LABEL, SITE_NAME_PLACEHOLDER, TAGLINE_HINT, TAGLINE_MAX, TITLE_HINT, TITLE_MAX, WEBSITE_HELP as HELP, ownHomeSaid,
  } from '../../../lib/websiteSetup.js';
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
    /** What an empty name falls back to, and the name the site shows now. */
    fallbackSaid = '',
    fallbackName = '',
    shownName = '',
    /** Which logo the site uses: `site`, `publishing` or '', and where it is read. */
    logoFrom = '',
    logoUrl = '',
    read = null,
    address = '',
  } = $props();

  const [title, sub] = HUB_LEADS.identity;
  let fileInput = $state(null);
  let busy = $state(false);

  const clean = (value) => value.replace(/\s+/g, ' ').trim();

  // read from the field as it is left, which is what a change event is for
  function saveName(value) {
    name = clean(value);
    void savePrefs({ site_title: name });
  }

  function saveTagline(value) {
    tagline = clean(value);
    void savePrefs({ site_tagline: tagline });
  }

  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  async function pick(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = ''; // the same file can be picked again
    if (!file || busy) return;
    if (file.size > LOGO_MAX_BYTES) {
      toast(SITE_LOGO_BIG, 'danger');
      return;
    }
    const head = new Uint8Array(await file.slice(0, PNG_MAGIC.length).arrayBuffer());
    if (!PNG_MAGIC.every((byte, index) => head[index] === byte)) {
      toast(SITE_LOGO_NOT_PNG, 'danger');
      return;
    }
    busy = true;
    try {
      await uploadSiteLogo(file);
      prefs.siteLogoSet = true;
      prefs.picturesRev += 1;
      toast('Site logo saved', 'ok');
    } catch (error) {
      toast(`Could not save the site logo: ${error.message}`, 'danger');
    } finally {
      busy = false;
    }
  }

  async function reset() {
    if (busy) return;
    busy = true;
    try {
      await removeSiteLogo();
      prefs.siteLogoSet = false;
      prefs.picturesRev += 1;
      toast('The site uses your Publishing logo again', 'ok');
    } catch (error) {
      toast(`Could not put the Publishing logo back: ${error.message}`, 'danger');
    } finally {
      busy = false;
    }
  }
</script>

<HubPanel id="identity" {active} {title} {sub}>
  <div class="grid">
    <HubCard guide="settings.site" label="Site">
      <HubField id="hub-site-name" label={SITE_NAME_LABEL} hint="{TITLE_HINT} {fallbackSaid}">
        <input id="hub-site-name" class="input" bind:value={name} maxlength={TITLE_MAX} placeholder={fallbackName || SITE_NAME_PLACEHOLDER}
          title={HELP.siteTitle} onchange={(event) => saveName(event.currentTarget.value)} />
      </HubField>
      <HubField id="hub-site-tagline" label="Tagline" hint={TAGLINE_HINT}>
        <input id="hub-site-tagline" class="input" bind:value={tagline} maxlength={TAGLINE_MAX} placeholder="What the site is about"
          title={HELP.siteTagline} onchange={(event) => saveTagline(event.currentTarget.value)} />
      </HubField>
      <HubField label={SITE_LOGO_LABEL} hint={SITE_LOGO_SAID[logoFrom]}>
        <span class="logo-pick">
          {#if logoUrl}<img class="well" src={logoUrl} alt="The logo the site uses" />{:else}<span class="well" aria-hidden="true"></span>{/if}
          <span class="opts">
            <button type="button" class="btn btn-sm" onclick={() => fileInput?.click()} disabled={busy} title={HELP.siteLogoPick}>{SITE_LOGO_PICK}</button>
            {#if prefs.siteLogoSet}
              <button type="button" class="btn btn-sm" onclick={reset} disabled={busy} title={HELP.siteLogoReset}>{SITE_LOGO_RESET}</button>
            {/if}
          </span>
        </span>
        <input bind:this={fileInput} class="file" type="file" accept="image/png" title={HELP.siteLogoPick} onchange={pick} />
      </HubField>
      <HubField id="hub-site-credit" label="Made with Azimut" hint={CREDIT_HINT}>
        <input id="hub-site-credit" class="switch" type="checkbox" checked={prefs.siteCreditAzimut} aria-label="Made with Azimut" title={HELP.siteCredit}
          onchange={(event) => savePrefs({ site_credit_azimut: event.currentTarget.checked })} />
      </HubField>
    </HubCard>

    <div class="side">
      <SitePreview name={shownName} {tagline} {logoUrl} credit={prefs.siteCreditAzimut} version={appInfo.version} {read} />
      {#if read?.home === 'yours'}
        <p class="own-home"><span class="pill">{OWN_HOME_PILL}</span><span>{ownHomeSaid(hostOf(address))}</span></p>
      {/if}
    </div>
  </div>
</HubPanel>

<style>
  .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; align-items: start; }
  .side { min-width: 0; }
  .logo-pick { display: flex; gap: 12px; align-items: center; }
  .well { width: 52px; height: 52px; flex: none; border-radius: 50%; object-fit: cover; background: #fff; border: 1px solid var(--border-strong); display: block; }
  .opts { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .file { display: none; }
  .switch { appearance: none; width: 34px; height: 19px; border-radius: 99px; background: var(--bg-3); position: relative; flex: none; margin: 4px 0 0;
    cursor: pointer; border: 0; align-self: flex-start; transition: background 0.12s var(--ease); }
  .switch::after { content: ''; position: absolute; left: 2px; top: 2px; width: 15px; height: 15px; border-radius: 50%; background: var(--text-2);
    transition: left 0.12s var(--ease), background 0.12s var(--ease); }
  .switch:checked { background: var(--accent); }
  .switch:checked::after { left: 17px; background: var(--accent-text); }
  .switch:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .own-home { margin: 10px 0 0; display: flex; gap: 8px; align-items: flex-start; font-size: var(--fs-xs); color: var(--text-2); line-height: 1.5; }
  .pill { display: inline-flex; padding: 1px 8px; border-radius: 99px; border: 1px solid var(--border-strong); color: var(--text-2); white-space: nowrap; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
</style>
