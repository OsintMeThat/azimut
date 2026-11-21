<script>
  /**
   * The Read the site press and what it last said: reading, when it was read, what went wrong, or what
   * the panel holding it hands it to say instead (`said`, such as what a delete did). The one press
   * reaches GitHub, and only when pressed; the read it makes is the session's
   * (`lib/siteRead.svelte.js`), shared by every panel that shows it.
   */
  import Icon from '../../../components/Icon.svelte';
  import { runRead, siteRead } from '../../../lib/siteRead.svelte.js';
  import {
    READ_AGAIN, READ_NOT_SET, READ_PRESS, WEBSITE_HELP as HELP, readAtSaid, readingSaid, whenSaid,
  } from '../../../lib/websiteSetup.js';

  let {
    ready = false,
    repository = '',
    /** The repository the read is of, `account/repo@branch`. */
    key = '',
    /** What to say in place of when the site was read: `{ state: 'ok' | 'error', text }`, or null. */
    said = null,
  } = $props();
</script>

<span class="read-line">
  <button type="button" class="btn btn-sm" onclick={() => runRead(key)} disabled={!ready || siteRead.busy} aria-busy={siteRead.busy}
    title={ready ? HELP.siteRead : READ_NOT_SET}>
    <Icon name="download" size={12} />{siteRead.data ? READ_AGAIN : READ_PRESS}</button>
  {#if siteRead.busy}
    <span class="hub-line" data-state="busy" role="status"><span class="hub-spinner" aria-hidden="true"></span>{readingSaid(repository)}</span>
  {:else if siteRead.error}
    <span class="hub-line" data-state="error" role="status"><Icon name="alert" size={12} />{siteRead.error}</span>
  {:else if siteRead.needs}
    <span class="hub-line" data-state="error" role="status"><Icon name="info" size={12} />{siteRead.needs.detail}</span>
  {:else if said}
    <span class="hub-line" data-state={said.state} role="status"><Icon name={said.state === 'ok' ? 'check' : 'alert'} size={12} />{said.text}</span>
  {:else}
    <span class="hub-line" role="status">{siteRead.at ? readAtSaid(whenSaid(siteRead.at)) : ''}</span>
  {/if}
</span>

<style>
  .read-line { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; min-width: 0; }
  .read-line .btn { flex: none; }
</style>
