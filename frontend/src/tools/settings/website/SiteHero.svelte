<script>
  /**
   * The site at a glance, over every panel: its logo, name and tagline as they read now, where it
   * lives, how big it is and when it last changed once the site is read, and the two presses that
   * matter most, Open the site and Update the site. What is not known yet before a read says so.
   */
  import Icon from '../../../components/Icon.svelte';
  import { countsLine, formatBytes, whenLabel } from '../../../lib/websiteHub.js';
  import { TOO_MANY_SHORT, UPDATE_NOT_SET, WEBSITE_HELP as HELP } from '../../../lib/websiteSetup.js';

  let {
    name, tagline = '', logoUrl = '', address = '', github = null, ready = false, read = null,
    /** The name of the counter that is really counting, or ''. */
    counting = '',
    /** `null`, `'working'`, or what the last Update the site said: `{ text }` or `{ error }`. */
    updated = null,
    onupdate = () => {},
  } = $props();

  const working = $derived(updated === 'working');
  const said = $derived(updated && updated !== 'working' ? updated : null);
  const size = $derived(read?.size.site != null ? formatBytes(read.size.site) : '');
</script>

<section class="hero" data-guide="settings.website" aria-label="The site at a glance">
  {#if logoUrl}
    <img class="logo" src={logoUrl} alt="" />
  {:else}
    <span class="logo blank" aria-hidden="true"><Icon name="globe" size={26} /></span>
  {/if}
  <div class="who">
    <h1>{name || 'Your site'}</h1>
    {#if tagline}<p class="tag">{tagline}</p>{/if}
    <div class="where">
      {#if address}
        <span><span class="led" aria-hidden="true"></span><a href={address} target="_blank" rel="noopener noreferrer" title={HELP.siteOpen}>{address.replace(/^https?:\/\//, '').replace(/\/$/, '')}</a></span>
      {/if}
      {#if ready}<span>GitHub Pages · {github.account}/{github.repo} · {github.branch}</span>{/if}
      <span>{!read ? 'Site not read yet' : read.truncated ? TOO_MANY_SHORT : `${countsLine(read.items)}${size ? ` · ${size}` : ''}`}</span>
      <span>{counting ? `Readers counted by ${counting}` : 'Readers not counted'}</span>
      {#if read?.last}<span>Last change {whenLabel(read.last.date)}</span>{/if}
    </div>
    {#if working || said}
      <p class="status" role="status" data-state={said?.error ? 'error' : ''}>
        {#if working}Updating {github.account}/{github.repo}…
        {:else if said.error}<Icon name="alert" size={12} /> {said.error}
        {:else}<Icon name="check" size={12} /> {said.text}{/if}
      </p>
    {/if}
  </div>
  <div class="actions">
    <a class="btn" class:disabled={!address} href={address || undefined} target="_blank" rel="noopener noreferrer"
      aria-disabled={address ? undefined : 'true'} title={HELP.siteOpen}>Open the site <Icon name="external" size={12} /></a>
    <button type="button" class="btn btn-primary" onclick={onupdate} disabled={!ready || working}
      title={ready ? HELP.siteUpdate : UPDATE_NOT_SET}>Update the site</button>
  </div>
</section>

<style>
  .hero { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 18px; align-items: center; padding: 18px 20px;
    border: 1px solid var(--border); border-radius: 10px;
    background: radial-gradient(120% 140% at 0% 0%, var(--accent-soft), transparent 55%), var(--bg-1); }
  .logo { width: 64px; height: 64px; border-radius: 50%; object-fit: cover; background: #fff; box-shadow: 0 0 0 3px var(--bg-2), 0 0 0 4px var(--border-strong); }
  .logo.blank { display: grid; place-items: center; background: var(--bg-2); color: var(--text-3); }
  .who { min-width: 0; }
  h1 { margin: 0; font-size: 1.55rem; line-height: 1.15; font-weight: 650; letter-spacing: 0.01em; overflow-wrap: anywhere; }
  .tag { margin: 4px 0 0; max-width: 60ch; color: var(--text-2); font-size: var(--fs-sm); }
  .where { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px 14px; color: var(--text-2); font-size: var(--fs-xs); }
  .where > span { display: inline-flex; align-items: center; gap: 6px; }
  .where a { color: var(--accent); }
  .led { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
  .status { display: flex; align-items: center; gap: 5px; margin: 8px 0 0; color: var(--ok); font-size: var(--fs-xs); }
  .status[data-state='error'] { color: var(--danger); }
  .actions { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
  .actions .btn { justify-content: center; text-decoration: none; }
  @media (max-width: 760px) {
    .hero { grid-template-columns: auto minmax(0, 1fr); }
    .actions { grid-column: 1 / -1; flex-direction: row; }
  }
</style>
