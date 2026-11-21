<script>
  /**
   * What the export dialog says once a note is published to GitHub Pages: GitHub is
   * building the page, then **Live at** its address, with Open and Copy link.
   *
   * It asks after the commit's build for a bounded time (`watchBuild`, `lib/githubPages.js`)
   * and stops asking when the dialog closes. Past that time it says the page is
   * published and GitHub is still building it, which is no failure: the address works
   * within minutes. What the publish had to say of the site (`site.warnings`: a list left as it
   * was, a file that is the analyst's) is listed under it.
   */
  import Icon from '../../components/Icon.svelte';
  import { copyText } from '../../lib/clipboard.js';
  import { watchBuild } from '../../lib/githubPages.js';
  import { REPLACED_EDITED } from '../../lib/websiteSetup.js';

  let {
    /** What Publish answered: `{ address, repository, commit, removed, edited, site: { warnings }, told }`. */
    result,
    /** Stands in for `watchBuild` in tests. */
    watch = watchBuild,
  } = $props();

  // building, built, slow or errored
  let phase = $state('building');
  let detail = $state('');

  $effect(() => {
    const commit = result?.commit;
    if (!commit) return;
    const controller = new AbortController();
    phase = 'building';
    watch(commit, { signal: controller.signal }).then((answer) => {
      if (controller.signal.aborted || answer?.state === 'stopped') return;
      phase = answer?.state === 'built' || answer?.state === 'errored' ? answer.state : 'slow';
      detail = String(answer?.detail ?? '');
    });
    return () => controller.abort();
  });

  // what the site says to mind; a folder changed on GitHub is said here only when the press was not warned of it
  const minded = $derived([
    ...(result?.edited && !result?.told ? [REPLACED_EDITED] : []),
    ...(Array.isArray(result?.site?.warnings) ? result.site.warnings : []),
  ]);

  const removed = $derived(Number.isInteger(result?.removed) && result.removed > 0
    ? ` · ${result.removed} earlier file${result.removed === 1 ? '' : 's'} removed` : '');
</script>

<section class="live" aria-label="Published to GitHub Pages" data-phase={phase}>
  {#if phase === 'built'}
    <p class="line done" role="status"><Icon name="check" size={15} /> <span>Live at
      <a href={result.address} target="_blank" rel="noopener noreferrer" title="Open the page in a new tab">{result.address}</a></span></p>
  {:else if phase === 'slow'}
    <p class="line" role="status"><Icon name="clock" size={15} /> <span>Published; GitHub is still building the page.</span></p>
    <p class="quiet">It goes live at {result.address} within a few minutes.</p>
  {:else if phase === 'errored'}
    <p class="line bad" role="alert"><Icon name="alert" size={15} />
      <span>Published, but GitHub could not build the page{detail ? `: ${detail.replace(/\.$/, '')}` : ''}.</span></p>
  {:else}
    <p class="line" role="status"><span class="spinner" aria-hidden="true"></span>
      <span>Published to {result.repository}. GitHub is building the page…</span></p>
    <p class="quiet">Usually about a minute. It will live at {result.address}</p>
  {/if}
  <div class="actions">
    <a class="btn btn-sm" href={result.address} target="_blank" rel="noopener noreferrer" title="Open the page in a new tab">
      <Icon name="external" size={13} /> Open</a>
    <button type="button" class="btn btn-sm" title="Copy the page's address, to share it on X"
      onclick={() => copyText(result.address, { said: 'Link copied' })}><Icon name="copy" size={13} /> Copy link</button>
  </div>
  {#if minded.length}
    <ul class="minded" aria-label="To mind">
      {#each minded as warning, index (index)}<li><Icon name="alert" size={12} /> {warning}</li>{/each}
    </ul>
  {/if}
  <p class="quiet mono">{result.repository} · commit {String(result.commit ?? '').slice(0, 7)}{removed}</p>
</section>

<style>
  .live { display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-sm); }
  .line { display: flex; align-items: center; gap: 7px; margin: 0; color: var(--text-1); font-weight: 600; overflow-wrap: anywhere; }
  .line :global(svg) { flex: none; }
  .line.done :global(svg) { color: var(--ok); }
  .line.bad { color: var(--danger); }
  .line a { color: var(--accent); font-weight: 600; }
  .quiet { margin: 0; color: var(--text-3); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .mono { font-family: var(--font-mono); }
  .minded { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; color: var(--warn); font-size: var(--fs-xs); }
  .minded li { display: flex; align-items: flex-start; gap: 5px; overflow-wrap: anywhere; }
  .minded :global(svg) { flex: none; margin-top: 2px; }
  .actions { display: flex; gap: 8px; margin-top: 4px; }
  .actions .btn { display: inline-flex; align-items: center; gap: 5px; text-decoration: none; }
  .spinner { flex: none; width: 13px; height: 13px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
