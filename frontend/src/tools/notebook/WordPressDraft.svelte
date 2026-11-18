<script>
  /**
   * The export dialog's WordPress branch: where the note goes, what goes with it and
   * what stays out, then what WordPress answered.
   *
   * Reads the site from Settings and asks the server what the draft would hold and what
   * it would warn about (`check`), both on this machine: the dialog's own check leaves
   * this branch alone. Only Send reaches the site (`lib/wordpress.js`), and the dialog's
   * own button calls `send()`. The public edition is the one sent;
   * the draft ends on WordPress's own Publish button. While the site is not set, the
   * steps of Settings › Publishing show here (`lib/wordpressSetup.js`).
   */
  import Icon from '../../components/Icon.svelte';
  import { uiState } from '../../lib/state.svelte.js';
  import { checkDraft, readWordPress, sendDraft } from '../../lib/wordpress.js';
  import { WORDPRESS_COM, WORDPRESS_FIELDS, WORDPRESS_FREE, siteHost, wordpressReady } from '../../lib/wordpressSetup.js';

  let {
    caseId,
    noteIds = [],
    /** Writes what the editor still holds, before the note is read from disk. */
    prepare = async () => {},
    busy = $bindable(false),
    /** What WordPress answered once sent: `{ post, edit, preview, updated, left_said }`. */
    sent = $bindable(null),
    /** Whether Send can go: a site set up and one note picked. */
    ready = $bindable(false),
    /** Called when the analyst leaves the dialog for Settings. */
    onleave = () => {},
  } = $props();

  let site = $state(null);
  let check = $state(null);
  let failed = $state('');
  let roundPov = $state(false);

  // a branch opened afresh holds nothing sent yet
  sent = null;
  busy = false;

  const one = $derived(noteIds.length === 1 ? noteIds[0] : null);
  const setUp = $derived(wordpressReady(site));
  $effect(() => { ready = setUp && Boolean(one); });

  $effect(() => {
    let live = true;
    readWordPress().then((value) => { if (live) site = value; }).catch(() => { if (live) site = { site: '', user: '', password: { set: false } }; });
    return () => { live = false; };
  });

  // what the draft would hold, from the note as saved: nothing leaves this machine
  $effect(() => {
    const id = caseId;
    const note = one;
    check = null;
    if (!id || !note) return;
    const controller = new AbortController();
    prepare().then(() => checkDraft(id, note, { signal: controller.signal }))
      .then((answer) => { check = answer; })
      .catch(() => {});
    return () => controller.abort();
  });

  /** Send the note as a draft; the dialog's button calls this. */
  export async function send() {
    if (!ready || busy) return;
    busy = true;
    failed = '';
    try {
      await prepare();
      sent = await sendDraft(caseId, one, { roundPov });
    } catch (error) {
      failed = error.message;
    } finally {
      busy = false;
    }
  }

  function openSettings() {
    onleave();
    uiState.settingsTab = 'publishing';
    uiState.tool = 'settings';
  }

  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
</script>

<section class="wp" aria-label="WordPress draft">
  {#if site === null}
    <p class="quiet" role="status">Reading…</p>
  {:else if !setUp}
    <div class="setup">
      <p class="lead"><Icon name="info" size={13} /> Connect your WordPress site once, in Settings › Publishing.</p>
      <dl>
        {#each WORDPRESS_FIELDS as [name, said] (name)}<dt>{name}</dt><dd>{said}</dd>{/each}
      </dl>
      <p class="quiet">{WORDPRESS_FREE}</p>
      <p class="quiet">{WORDPRESS_COM}</p>
      <button type="button" class="btn btn-sm" title="Open Settings on Publishing, where the site is set" onclick={openSettings}>
        Open Settings › Publishing</button>
    </div>
  {:else}
    <p class="where">
      <Icon name="globe" size={13} />
      <span>To <strong>{siteHost(site.site)}</strong> as {site.user}, as a draft you publish in WordPress.</span>
    </p>
    <p class="quiet">The public edition goes: internal passages never leave this computer.</p>
    {#if !one}
      <p class="quiet warn" role="status">WordPress takes one note at a time. Pick one note to send it.</p>
    {:else if sent}
      <div class="sent" role="status">
        <p><Icon name="check" size={13} /> {sent.updated ? 'Draft updated in WordPress.' : 'Draft saved in WordPress.'}
          {#if sent.preview}<a href={sent.preview} target="_blank" rel="noopener noreferrer" title="The draft as readers will see it">Preview</a>{/if}</p>
        {#if sent.left_said}<p class="quiet">{sent.left_said}</p>{/if}
      </div>
    {:else if check}
      <p class="quiet" role="status">
        {check.pictures || check.clips
          ? `${[check.pictures ? plural(check.pictures, 'picture') : '', check.clips ? plural(check.clips, 'clip') : ''].filter(Boolean).join(' and ')} go to the media library, without their metadata.`
          : 'Nothing to upload.'}
        {check.left_said}
      </p>
      {#if check.warnings?.length}
        <section class="before" aria-label="Before you send">
          <h5 class="listed-head"><Icon name="alert" size={12} /> Before you send</h5>
          <ul>{#each check.warnings as warning, index (index)}<li>{warning}</li>{/each}</ul>
        </section>
      {/if}
      {#if check.pov?.length}
        <div class="listed">
          <h5 class="listed-head">Where a filmer stood, shown to the metre</h5>
          <ul aria-label="Points of view">{#each check.pov as point, index (index)}<li>{point}</li>{/each}</ul>
          <label class="round" title="The note keeps its points as written">
            <input type="checkbox" bind:checked={roundPov} title="The note keeps its points as written" /> Round them to about 150 m in this draft
          </label>
        </div>
      {/if}
    {/if}
    {#if failed}<p class="failed" role="alert"><Icon name="alert" size={12} /> {failed}</p>{/if}
  {/if}
</section>

<style>
  .wp { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; font-size: var(--fs-sm); }
  .where { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--text-1); }
  .quiet { margin: 0; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; }
  .quiet.warn { color: var(--warn); }
  .setup { display: flex; flex-direction: column; gap: 6px; border: 1px solid var(--border); border-radius: var(--r-md); padding: 8px 12px 10px; background: var(--bg-1); }
  .setup .btn { align-self: flex-start; margin-top: 2px; }
  .lead { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--text-1); }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 2px 0; font-size: var(--fs-xs); }
  dt { color: var(--text-1); font-weight: 600; }
  dd { margin: 0; color: var(--text-2); line-height: 1.45; }
  .sent { border: 1px solid color-mix(in srgb, var(--ok) 40%, var(--border)); border-radius: var(--r-md); padding: 7px 10px;
    background: color-mix(in srgb, var(--ok) 8%, var(--bg-1)); }
  .sent p { display: flex; align-items: center; gap: 6px; margin: 0; flex-wrap: wrap; }
  .sent p:first-child { color: var(--text-1); }
  .sent a { color: var(--accent); }
  .failed { display: flex; align-items: center; gap: 5px; margin: 0; color: var(--danger); font-size: var(--fs-xs); overflow-wrap: anywhere; }
  .listed { border: 1px solid var(--border); border-radius: var(--r-md); padding: 6px 10px; background: var(--bg-1); }
  .listed-head { display: block; margin: 0 0 4px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; }
  .listed ul { list-style: none; margin: 0; padding: 0; max-height: 100px; overflow: auto; color: var(--text-1); }
  .before { border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--border)); border-radius: var(--r-md); padding: 6px 10px;
    background: color-mix(in srgb, var(--warn) 7%, var(--bg-1)); }
  .before .listed-head { display: flex; align-items: center; gap: 5px; color: var(--warn); }
  .before ul { list-style: none; margin: 0; padding: 0; max-height: 120px; overflow: auto; color: var(--text-1); font-size: var(--fs-xs); }
  .before li { padding: 1px 0; overflow-wrap: anywhere; }
  .round { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
</style>
