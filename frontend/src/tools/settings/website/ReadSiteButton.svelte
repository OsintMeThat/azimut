<script>
  /**
   * The Read the site press and what it last said: reading, when it was read, or what went wrong.
   * The one press reaches GitHub, and only when pressed; the read it makes is the session's
   * (`lib/siteRead.svelte.js`), shared by every panel that shows it.
   */
  import Icon from '../../../components/Icon.svelte';
  import { runRead, siteRead } from '../../../lib/siteRead.svelte.js';
  import { whenLabel } from '../../../lib/websiteHub.js';
  import { READ_AGAIN, READ_NOT_SET, READ_PRESS, WEBSITE_HELP as HELP } from '../../../lib/websiteSetup.js';

  let { ready = false, repository = '', key = '' } = $props();

  const label = $derived(siteRead.busy ? 'Reading…' : siteRead.data ? READ_AGAIN : READ_PRESS);
</script>

<span class="read-line">
  <button type="button" class="btn btn-sm" onclick={() => runRead(key)} disabled={!ready || siteRead.busy}
    title={ready ? HELP.siteRead : READ_NOT_SET}>{label}</button>
  <span class="said" role="status" data-state={siteRead.error ? 'error' : siteRead.needs ? 'needs' : ''}>
    {#if siteRead.busy}<span class="spinner" aria-hidden="true"></span> Reading {repository}…
    {:else if siteRead.error}<Icon name="alert" size={12} /> {siteRead.error}
    {:else if siteRead.needs}<Icon name="info" size={12} /> {siteRead.needs.detail}
    {:else if siteRead.at}Read {whenLabel(siteRead.at)}{/if}
  </span>
</span>

<style>
  .read-line { display: inline-flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
  .said { display: inline-flex; align-items: center; gap: 5px; color: var(--text-3); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .said[data-state='error'] { color: var(--danger); }
  .said[data-state='needs'] { color: var(--warn); }
  .spinner { flex: none; width: 11px; height: 11px; border-radius: 50%; border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
    border-top-color: var(--accent); animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
