<script>
  /**
   * The press that sets GitHub Pages up when something is missing, said beside it:
   * **Create the repository** while the repository is not there, **Turn on Pages**
   * while Pages is off. Settings › Website shows it after Test connection and Update the site,
   * and the export dialog after a Publish that found it missing. Each reaches GitHub on its
   * press only (`lib/githubPages.js`). When the token may not do it, the way on
   * github.com shows in its place (`lib/githubPagesSetup.js`).
   */
  import Icon from './Icon.svelte';
  import { WEBSITE_HELP as HELP } from '../lib/websiteSetup.js';
  import { createRepository, turnOnPages } from '../lib/githubPages.js';
  import {
    CREATE_SAID, PAGES_BY_HAND, PAGES_ON_SAID, REPO_STEPS, newRepositoryLink, pagesSettingsLink,
  } from '../lib/githubPagesSetup.js';

  let {
    /** `repository` or `pages`. */
    needs,
    /** The GitHub settings: `{ account, repo, branch, base }`. */
    github,
    /** What the server said is missing, in one sentence. */
    detail = '',
    /** Called once the press worked, with what GitHub answered. */
    ondone = () => {},
  } = $props();

  let busy = $state(false);
  let failed = $state(null);

  const repository = $derived(`${github?.account ?? ''}/${github?.repo ?? ''}`);

  async function press() {
    busy = true;
    failed = null;
    try {
      const answer = needs === 'repository' ? await createRepository() : await turnOnPages();
      if (answer?.ok) ondone(answer);
      else failed = { detail: String(answer?.detail ?? 'GitHub did not do it.'), manual: Boolean(answer?.manual) };
    } catch (error) {
      failed = { detail: error.message, manual: false };
    } finally {
      busy = false;
    }
  }
</script>

<div class="needs" role="group" aria-label={needs === 'repository' ? 'Make the repository' : 'Turn on Pages'}>
  <p class="lead"><Icon name="info" size={13} />
    {detail || (needs === 'repository' ? `There is no repository ${repository} yet.` : `Pages is off for ${repository}.`)}</p>
  <div class="press">
    {#if needs === 'repository'}
      <button type="button" class="btn btn-sm btn-primary" onclick={press} disabled={busy} title={HELP.githubCreate}>
        {busy ? 'Creating…' : 'Create the repository'}</button>
      <span class="said">{CREATE_SAID}</span>
    {:else}
      <button type="button" class="btn btn-sm btn-primary" onclick={press} disabled={busy} title={HELP.githubPagesOn}>
        {busy ? 'Turning on…' : 'Turn on Pages'}</button>
      <span class="said">{PAGES_ON_SAID}{github?.base ? ` It will live at ${github.base}` : ''}</span>
    {/if}
  </div>
  {#if failed}
    <p class="failed" role="alert"><Icon name="alert" size={12} /> {failed.detail}</p>
    {#if failed.manual && needs === 'repository'}
      <ol class="steps">{#each REPO_STEPS as step, index (index)}<li>{step}</li>{/each}</ol>
      <a class="way" href={newRepositoryLink(github?.account, github?.repo)} target="_blank" rel="noopener noreferrer"
        title={HELP.githubNewRepo}>New repository on github.com <Icon name="external" size={11} /></a>
    {:else if failed.manual}
      <p class="said">{PAGES_BY_HAND}</p>
      <a class="way" href={pagesSettingsLink(github?.account, github?.repo)} target="_blank" rel="noopener noreferrer"
        title={HELP.githubPagesSettings}>Pages settings on github.com <Icon name="external" size={11} /></a>
    {/if}
  {/if}
</div>

<style>
  .needs { display: flex; flex-direction: column; gap: 6px; border: 1px solid color-mix(in srgb, var(--accent) 30%, var(--border));
    border-radius: var(--r-md); padding: 8px 12px 10px; background: color-mix(in srgb, var(--accent) 5%, var(--bg-1)); font-size: var(--fs-sm); }
  .lead { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--text-1); }
  .press { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .press .btn { flex: none; }
  .said { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; overflow-wrap: anywhere; }
  p.said { margin: 0; }
  .failed { display: flex; align-items: center; gap: 5px; margin: 0; color: var(--danger); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .steps { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 3px; color: var(--text-2); font-size: var(--fs-xs); line-height: 1.45; }
  .way { display: inline-flex; align-items: center; gap: 4px; align-self: flex-start; font-size: var(--fs-xs); color: var(--accent); }
</style>
