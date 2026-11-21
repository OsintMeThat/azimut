<script>
  /**
   * Upkeep: Update the site with what it last did, who writes which file of the site, and how to do
   * the usual chores. Update the site rebuilds the home, list, feed and sitemap from the articles on
   * GitHub, in one commit, and reaches GitHub on its press only. The table's pages come from the last
   * read of the site.
   */
  import Icon from '../../../components/Icon.svelte';
  import GitHubSetupPress from '../../../components/GitHubSetupPress.svelte';
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import { ownersOf, whenLabel } from '../../../lib/websiteHub.js';
  import {
    CHORES, CHORES_TITLE, HUB_LEADS, OWNERS_TITLE, OWNERS_TRUNCATED, OWNERS_UNREAD, UPDATE_NOT_SET, UPDATE_SAID, WEBSITE_HELP as HELP, lastChangeSaid,
  } from '../../../lib/websiteSetup.js';
  import HubCard from './HubCard.svelte';
  import HubPanel from './HubPanel.svelte';

  let {
    active = false,
    ready = false,
    github = null,
    /** What Update the site did: `null`, `'working'`, `{ text, at, warnings }` or `{ error, warnings }`. */
    updated = null,
    /** What it found missing: `{ needs, detail }`, and what the setup press made of it. */
    needs = null,
    setUp = '',
    onupdate = () => {},
    onsetup = () => {},
  } = $props();

  const [title, sub] = HUB_LEADS.upkeep;
  const read = $derived(siteRead.data);
  const owners = $derived(ownersOf(read));
  const result = $derived(updated && updated !== 'working' ? updated : null);
</script>

<HubPanel id="upkeep" {active} {title} {sub}>
  <section class="update" data-guide="settings.update-site" aria-label="Update the site">
    <div class="body">
      <h3>Update the site</h3>
      <p>{UPDATE_SAID}</p>
      <p class="result" role="status" data-state={result?.error ? 'error' : result ? 'ok' : ''}>
        {#if updated === 'working'}<span class="spinner" aria-hidden="true"></span> Updating {github.account}/{github.repo}…
        {:else if result?.error}<Icon name="alert" size={12} /> {result.error}
        {:else if result}<Icon name="check" size={12} /> {result.text} <span class="when">{whenLabel(result.at)}</span>
        {:else if setUp}<Icon name="check" size={12} /> {setUp}
        {:else if read?.last}{lastChangeSaid(whenLabel(read.last.date), read.last.message)}{/if}
      </p>
    </div>
    <button type="button" class="btn btn-primary" onclick={onupdate} disabled={!ready || updated === 'working'}
      title={ready ? HELP.siteUpdate : UPDATE_NOT_SET}>Update the site</button>
    {#if result?.warnings?.length}
      <ul class="warnings" aria-label="To mind">
        {#each result.warnings as warning, index (index)}<li><Icon name="alert" size={12} /> {warning}</li>{/each}
      </ul>
    {/if}
    {#if needs}
      <div class="needs-row"><GitHubSetupPress needs={needs.needs} {github} detail={needs.detail} ondone={onsetup} /></div>
    {/if}
  </section>

  <div class="pair">
    <HubCard title={OWNERS_TITLE}>
      <table class="own-table">
        <thead><tr><th>File</th><th>Made by</th><th>What Azimut does</th></tr></thead>
        <tbody>
          {#each owners as row, index (index)}
            <tr>
              <td>{#each row.files as file, at (at)}{#if at}<br />{/if}{file}{/each}</td>
              <td><span class="who" class:az={row.who === 'Azimut'}>{row.who}</span></td>
              <td>{row.text}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if !read}<p class="hint more">{OWNERS_UNREAD}</p>{:else if read.truncated}<p class="hint more">{OWNERS_TRUNCATED}</p>{/if}
    </HubCard>
    <HubCard title={CHORES_TITLE}>
      <div class="chores">
        {#each CHORES as [chore, how], index (chore)}
          <details open={index === 0}><summary title={HELP.chore}>{chore}</summary><p class="hint">{how}</p></details>
        {/each}
      </div>
    </HubCard>
  </div>
</HubPanel>

<style>
  .update { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px 18px; align-items: center; border: 1px solid var(--border); background: var(--bg-1);
    border-radius: 8px; padding: 14px 16px; }
  .update h3 { margin: 0 0 4px; font-size: var(--fs-md); font-weight: 600; text-transform: none; letter-spacing: 0; color: var(--text-1); display: block; }
  .update p { margin: 0; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .update p.result { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: var(--fs-xs); color: var(--text-3); min-height: 1em; }
  .update p.result[data-state='ok'] { color: var(--ok); }
  .update p.result[data-state='error'] { color: var(--danger); }
  .when { color: var(--text-3); }
  .warnings { grid-column: 1 / -1; list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; color: var(--warn); font-size: var(--fs-xs); }
  .warnings li { display: flex; align-items: center; gap: 5px; }
  .needs-row { grid-column: 1 / -1; }
  .spinner { flex: none; width: 11px; height: 11px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  .pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 14px; align-items: start; }
  .own-table { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); margin-top: 6px; }
  .own-table th { text-align: left; font-weight: 500; color: var(--text-3); font-size: var(--fs-xs); padding: 6px 10px 6px 0; border-bottom: 1px solid var(--border); }
  .own-table td { padding: 8px 10px 8px 0; border-top: 1px solid var(--border); vertical-align: top; color: var(--text-2); }
  .own-table tbody tr:first-child td { border-top: 0; }
  .own-table td:first-child { color: var(--text-1); font-family: var(--font-mono); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .who { font-size: 0.66rem; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; padding: 1px 6px; border-radius: 3px;
    background: var(--info-soft); color: var(--info); }
  .who.az { background: var(--accent-soft); color: var(--accent); }
  .more { margin-top: 8px; }
  .chores details { border-top: 1px solid var(--border); padding: 9px 0; }
  .chores details:first-child { border-top: 0; padding-top: 2px; }
  .chores summary { cursor: pointer; font-size: var(--fs-sm); color: var(--text-1); }
  .chores :global(p.hint) { margin: 6px 0 0 16px; }
  @media (max-width: 900px) { .pair { grid-template-columns: 1fr; } .update { grid-template-columns: 1fr; } }
</style>
