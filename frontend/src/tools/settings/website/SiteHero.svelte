<script>
  /**
   * The site at a glance, over every panel: its logo, name and tagline as they read now, where it
   * lives, what it holds, how much it weighs and when it last changed once the site is read, and the
   * two presses that matter most, Open the site and Update the site, which says so with a spinner while it
   * works. Its two lines of facts keep their places whatever arrives, so a read or an update changes
   * words, never the layout.
   */
  import BusyLabel from '../../../components/BusyLabel.svelte';
  import Icon from '../../../components/Icon.svelte';
  import { bareAddress, countsOf, formatBytes } from '../../../lib/websiteHub.js';
  import {
    BUSY, COUNTER_NAME, NOT_READ, NO_ADDRESS, OPEN_SITE, TOO_MANY_SHORT, UNNAMED, UPDATE_NOT_SET, UPDATE_PRESS, WEBSITE_HELP as HELP, changedSaid,
    countsSaid, readersSaid, updatedSaid, whenSaid,
  } from '../../../lib/websiteSetup.js';

  let {
    name = '', tagline = '', logoUrl = '', address = '', github = null, ready = false, read = null,
    /** The counter that really counts (`goatcounter`, `cloudflare`), or ''. */
    counting = '',
    /** `null`, `'working'`, or what the last Update the site said: `{ text, at }` or `{ error, at }`. */
    updated = null,
    onupdate = () => {},
  } = $props();

  // a logo that does not load shows the globe rather than a broken picture
  let failed = $state('');
  const logo = $derived(logoUrl && failed !== logoUrl ? logoUrl : '');
  const working = $derived(updated === 'working');
  const done = $derived(updated && !working ? updated : null);
  const what = $derived.by(() => {
    if (!read) return NOT_READ;
    if (read.truncated) return TOO_MANY_SHORT;
    const size = formatBytes(read.size.site);
    return `${countsSaid(countsOf(read.items))}${size ? ` · ${size}` : ''}`;
  });
</script>

<section class="hero" data-guide="settings.website" aria-label="The site at a glance">
  <span class="logo" class:blank={!logo}>
    {#if logo}<img src={logo} alt="" onerror={() => (failed = logoUrl)} />{:else}<Icon name="globe" size={28} />{/if}
  </span>

  <div class="who">
    <h1 title={name || UNNAMED}>{name || UNNAMED}</h1>
    {#if tagline}<p class="tag" title={tagline}>{tagline}</p>{/if}
    <div class="facts">
      <span class="facts-line">
        {#if address}
          <a class="where" href={address} target="_blank" rel="noopener noreferrer" title={HELP.siteOpen}><span class="led" aria-hidden="true"></span>{bareAddress(address)}</a>
        {:else}
          <span class="where off"><span class="led off" aria-hidden="true"></span>{NO_ADDRESS}</span>
        {/if}
        {#if ready}<span>GitHub Pages · {github.account}/{github.repo} · {github.branch}</span>{/if}
      </span>
      <span class="facts-line">
        <span class:quiet={!read}>{what}</span>
        <span>{readersSaid(COUNTER_NAME[counting] ?? '')}</span>
        {#if done?.error}
          <span class="state" data-state="error" role="status" title={done.error}><Icon name="alert" size={12} />{done.error}</span>
        {:else if done}
          <span class="state" data-state="ok" role="status"><Icon name="check" size={12} />{updatedSaid(whenSaid(done.at))}</span>
        {:else if read?.last}
          <span>{changedSaid(whenSaid(read.last.date))}</span>
        {/if}
      </span>
    </div>
  </div>

  <div class="actions">
    <a class="btn" class:disabled={!address} href={address || undefined} target="_blank" rel="noopener noreferrer" aria-disabled={address ? undefined : 'true'}
      title={HELP.siteOpen}>{OPEN_SITE} <Icon name="external" size={12} /></a>
    <button type="button" class="btn btn-primary" onclick={onupdate} disabled={!ready || working} aria-busy={working}
      title={ready ? HELP.siteUpdate : UPDATE_NOT_SET}><BusyLabel busy={working} text={BUSY.update}>{UPDATE_PRESS}</BusyLabel></button>
  </div>
</section>

<style>
  .hero { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 18px; align-items: center; padding: 18px 20px; border: 1px solid var(--border);
    border-radius: 10px; background: radial-gradient(120% 140% at 0% 0%, var(--accent-soft), transparent 55%), var(--bg-1); }
  .logo { display: grid; place-items: center; width: 64px; height: 64px; flex: none; border-radius: 50%; overflow: hidden; background: #fff;
    box-shadow: 0 0 0 3px var(--bg-2), 0 0 0 4px var(--border-strong); }
  .logo img { width: 100%; height: 100%; object-fit: cover; }
  .logo.blank { background: var(--bg-2); color: var(--text-3); }
  .who { min-width: 0; }
  h1 { margin: 0; overflow: hidden; color: var(--text-1); font-size: 1.55rem; font-weight: 650; line-height: 1.2; letter-spacing: 0.01em;
    white-space: nowrap; text-overflow: ellipsis; }
  .tag { margin: 3px 0 0; max-width: 64ch; overflow: hidden; color: var(--text-2); font-size: var(--fs-sm); white-space: nowrap; text-overflow: ellipsis; }
  .facts { display: flex; flex-direction: column; gap: 3px; margin-top: 9px; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.5; }
  .facts-line { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 16px; min-width: 0; }
  .facts-line > * { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
  .where { color: var(--accent); font-weight: 500; }
  .where:hover { color: var(--accent-hover); }
  .where.off { color: var(--text-3); font-weight: 400; }
  .led { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--ok-soft); }
  .led.off { background: var(--text-3); box-shadow: 0 0 0 3px var(--bg-3); }
  .quiet { color: var(--text-3); }
  .state { max-width: 100%; }
  .state[data-state='ok'] { color: var(--ok); }
  .state[data-state='error'] { color: var(--danger); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; display: inline-block; }
  .state[data-state='error'] :global(svg) { vertical-align: -2px; margin-right: 5px; }
  .actions { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
  .actions .btn { justify-content: center; padding: 6px 14px; text-decoration: none; }
  .actions a.btn:focus-visible, .actions button:focus-visible, .where:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @container hub (max-width: 560px) {
    .hero { grid-template-columns: auto minmax(0, 1fr); padding: 16px; }
    .logo { width: 52px; height: 52px; }
    .actions { grid-column: 1 / -1; flex-direction: row; }
    .actions .btn { flex: 1; }
  }
</style>
