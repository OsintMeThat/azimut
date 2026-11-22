<script>
  /**
   * Upkeep: Update the site with what it last did, who writes which file of the site, and how to do
   * the usual chores. Update the site rebuilds the home, list, feed and sitemap from the articles on
   * GitHub, in one commit, and reaches GitHub on its press only, saying so with a spinner while it works.
   * The table's pages come from the last read of the site.
   */
  import BusyLabel from '../../../components/BusyLabel.svelte';
  import Icon from '../../../components/Icon.svelte';
  import GitHubSetupPress from '../../../components/GitHubSetupPress.svelte';
  import { siteRead } from '../../../lib/siteRead.svelte.js';
  import {
    BUSY, CHORES, CHORES_TITLE, HUB_LEADS, OWNERS_HEAD, OWNERS_TITLE, OWNERS_TRUNCATED, OWNERS_UNREAD, OWNER_LABEL, UPDATE_NOT_SET, UPDATE_PRESS,
    UPDATE_SAID, WEBSITE_HELP as HELP, lastChangeSaid, ownersOf, whenSaid,
  } from '../../../lib/websiteSetup.js';
  import HubCard from './HubCard.svelte';
  import HubPanel from './HubPanel.svelte';

  let {
    active = false,
    ready = false,
    github = null,
    /** What Update the site did: `null`, `'working'`, `{ text, at, warnings }` or `{ error, at, warnings }`. */
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
  const working = $derived(updated === 'working');
  const result = $derived(updated && !working ? updated : null);
</script>

<HubPanel id="upkeep" {active} {title} {sub}>
  <section class="update" data-guide="settings.update-site" aria-label="Update the site">
    <div class="body">
      <h3>{UPDATE_PRESS}</h3>
      <p>{UPDATE_SAID}</p>
      <p class="hub-line" role="status" data-state={result?.error ? 'error' : result || setUp ? 'ok' : ''}>
        {#if result?.error}<Icon name="alert" size={12} />{result.error}
        {:else if result}<Icon name="check" size={12} />{result.text}<span class="when">· {whenSaid(result.at)}</span>
        {:else if setUp}<Icon name="check" size={12} />{setUp}
        {:else if read?.last}{lastChangeSaid(whenSaid(read.last.date), read.last.message)}{/if}
      </p>
    </div>
    <button type="button" class="btn btn-primary" onclick={onupdate} disabled={!ready || working} aria-busy={working}
      title={ready ? HELP.siteUpdate : UPDATE_NOT_SET}><BusyLabel busy={working} text={BUSY.update}>{UPDATE_PRESS}</BusyLabel></button>
    {#if result?.warnings?.length}
      <ul class="hub-warnings wide" aria-label="To mind">
        {#each result.warnings as warning, index (index)}<li><Icon name="alert" size={12} /> {warning}</li>{/each}
      </ul>
    {/if}
    {#if needs}
      <div class="wide"><GitHubSetupPress needs={needs.needs} {github} detail={needs.detail} ondone={onsetup} /></div>
    {/if}
  </section>

  <div class="pair">
    <HubCard title={OWNERS_TITLE} label={OWNERS_TITLE}>
      <table class="owners">
        <thead><tr>{#each OWNERS_HEAD as head (head)}<th scope="col">{head}</th>{/each}</tr></thead>
        <tbody>
          {#each owners as row, index (index)}
            <tr>
              <td class="files">{#each row.files as file (file)}<span>{file}</span>{/each}</td>
              <td><span class="who {row.who}">{OWNER_LABEL[row.who]}</span></td>
              <td>{row.text}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if !read}<p class="hub-hint more">{OWNERS_UNREAD}</p>{:else if read.truncated}<p class="hub-hint more">{OWNERS_TRUNCATED}</p>{/if}
    </HubCard>
    <HubCard title={CHORES_TITLE} label={CHORES_TITLE}>
      <div class="chores">
        {#each CHORES as [chore, how], index (chore)}
          <details open={index === 0}>
            <summary title={HELP.chore}><Icon name="chevronRight" size={12} />{chore}</summary>
            <p>{how}</p>
          </details>
        {/each}
      </div>
    </HubCard>
  </div>
</HubPanel>

<style>
  .update { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px 18px; align-items: center; padding: 14px 16px; border: 1px solid var(--border);
    border-radius: 8px; background: var(--bg-1); }
  .update h3 { margin: 0 0 4px; color: var(--text-1); font-size: var(--fs-md); font-weight: 600; letter-spacing: 0; text-transform: none; }
  .update .body > p:not(.hub-line) { margin: 0; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.5; }
  .update .hub-line { margin-top: 8px; }
  .when { color: var(--text-3); }
  .update .btn { padding: 6px 14px; }
  .wide { grid-column: 1 / -1; }
  .update .hub-warnings { margin: 0; }

  .pair { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 14px; align-items: start; }
  .owners { width: 100%; margin-top: 8px; border-collapse: collapse; font-size: var(--fs-sm); }
  .owners th { padding: 6px 10px 6px 0; border-bottom: 1px solid var(--border); color: var(--text-3); font-size: var(--fs-xs); font-weight: 500; text-align: left;
    white-space: nowrap; }
  .owners td { padding: 8px 10px 8px 0; border-top: 1px solid var(--border); color: var(--text-2); vertical-align: top; line-height: 1.45; }
  .owners tbody tr:first-child td { border-top: 0; }
  .owners td:last-child, .owners th:last-child { padding-right: 0; }
  .files { color: var(--text-1); font-family: var(--font-mono); font-size: var(--fs-xs); }
  .files span { display: block; overflow-wrap: anywhere; }
  .who { display: inline-block; padding: 1px 6px; border-radius: 3px; background: var(--info-soft); color: var(--info); font-size: 0.66rem; font-weight: 700;
    letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
  .who.azimut { background: var(--accent-soft); color: var(--accent); }
  .more { margin-top: 10px; }
  .chores { margin-top: 4px; }
  .chores details { padding: 9px 0; border-top: 1px solid var(--border); }
  .chores details:first-child { border-top: 0; padding-top: 4px; }
  .chores summary { display: flex; align-items: center; gap: 6px; color: var(--text-1); font-size: var(--fs-sm); cursor: pointer; list-style: none; }
  .chores summary::-webkit-details-marker { display: none; }
  .chores summary :global(svg) { flex: none; color: var(--text-3); transition: transform 0.15s var(--ease); }
  .chores details[open] summary :global(svg) { transform: rotate(90deg); }
  .chores summary:hover { color: var(--accent); }
  .chores summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: var(--r-sm); }
  .chores p { margin: 6px 0 0 18px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  @container hub (min-width: 900px) { .pair { grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); } }
  @container hub (max-width: 520px) { .update { grid-template-columns: minmax(0, 1fr); } .update .btn { justify-self: start; } }
</style>
