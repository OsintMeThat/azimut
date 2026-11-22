<script>
  /**
   * The export dialog's For review branch: one note and only what its public web page needs, as
   * an Azimut file to send to somebody who publishes it (`engine/reviewexport.py`,
   * `lib/notes/reviewExport.js`).
   *
   * Before the press it reads from the server what would leave, grouped with counts and names,
   * its size, and what stays; the author fields start from the note's look, else the exporter's
   * own name and logo. The dialog's own buttons call `send()`, which writes the file as a bundle
   * job, then `download()`, the whole case's own download (`lib/bundles.js`), and `reveal()`, the
   * folder it landed in.
   */
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { downloadBundle } from '../../lib/bundles.js';
  import { formatSize } from '../../lib/trash.js';
  import {
    CONTRIBUTE, METADATA, VIDEOS_HELP, VIDEOS_WORDS, exportForReview, namesWords, readReview, revealBundles, sizeSaid, staysWords,
  } from '../../lib/notes/reviewExport.js';

  let {
    caseId,
    noteId,
    /** Writes what the open note still holds unsaved, so the file is the note as it reads. */
    prepare = async () => {},
    busy = $bindable(false),
    /** Whether the press can go: what leaves has been read. */
    ready = $bindable(false),
    /** The file written and its job, which the download asks for; null until then. */
    written = $bindable(null),
  } = $props();

  let shown = $state(null);
  let author = $state('');
  let picture = $state('');
  let failed = $state('');
  // the source videos' files stay behind until asked for: the page reads the same without them
  let sendVideos = $state(false);
  let reading = 0;
  const said = $derived(sizeSaid(shown, sendVideos));

  // a branch opened afresh has written nothing yet
  written = null;
  busy = false;
  $effect(() => { ready = Boolean(shown); });

  async function load(choice = null) {
    const mine = ++reading;
    failed = '';
    try {
      const answer = await readReview(caseId, noteId, choice);
      if (mine !== reading) return;
      if (shown === null) author = answer.author ?? '';
      shown = answer;
      picture = answer.picture ?? '';
    } catch (error) {
      if (mine === reading) failed = error.message;
    }
  }

  // read once on open; a picture picked reads again, since a logo filed is one more picture
  $effect(() => untrack(() => void load()));

  function choose(value) {
    picture = value;
    void load(value);
  }

  /** Write the file; the dialog's Export calls this. */
  export async function send() {
    if (busy || !shown) return;
    busy = true;
    failed = '';
    try {
      await prepare();
      const job = await exportForReview(caseId, noteId, { author: author.trim(), picture, videos: sendVideos });
      if (job.state === 'ready') written = { file: job.file, job: job.id };
      else failed = job.error ? `Could not export the note: ${job.error}` : 'Could not export the note';
    } catch (error) {
      failed = error.message;
    } finally {
      busy = false;
    }
  }

  /** The file written, through the browser's download. */
  export function download() {
    if (written) downloadBundle(caseId, written.job);
  }

  /** The folder it was written in, in the system's file manager. */
  export async function reveal() {
    try {
      await revealBundles(caseId);
    } catch (error) {
      failed = error.message;
    }
  }
</script>

{#snippet invite()}
  <p class="review-invite">Want it published on osintmethat.com under your name? Send this file at <a href={CONTRIBUTE} target="_blank" rel="noopener noreferrer">osintmethat.com/contribute</a>: it is read first, and nothing goes online before you agree.</p>
{/snippet}

<section class="review" aria-label="For review">
  {#if written}
    <p class="review-done" role="status"><Icon name="check" size={14} /> Written: {written.file}</p>
    {@render invite()}
  {:else if !shown && !failed}
    <p class="review-quiet" role="status">Reading what the page needs…</p>
  {:else if shown}
    <section aria-label="What leaves">
      <h3 class="review-head">What leaves <span>{formatSize(said.size)}</span></h3>
      <ul class="review-groups">
        {#each shown.groups ?? [] as group (group.key)}
          <li><strong>{group.label} ({group.count})</strong> <span dir="auto">{namesWords(group)}</span></li>
        {/each}
        {#if shown.map_count}
          <li><strong>Maps ({shown.map_count})</strong> <span dir="auto">{namesWords({ names: shown.maps, count: shown.map_count })}</span></li>
        {/if}
      </ul>
      {#if shown.videos?.count}
        <label class="review-videos" title={VIDEOS_HELP}>
          <input type="checkbox" bind:checked={sendVideos} disabled={busy} /> Source videos ({formatSize(shown.videos.size)}): {VIDEOS_WORDS}</label>
      {/if}
      {#if said.line}<p class="review-limit" role="status">{said.line}</p>{/if}
    </section>
    <section aria-label="What stays">
      <h3 class="review-head">What stays</h3>
      <p class="review-stays">{staysWords(shown.internal)}</p>
    </section>
    <p class="review-quiet">{METADATA}</p>

    <div class="review-fields">
      <label class="review-field" title="The name the page is signed with">
        <span>Author</span>
        <input class="input" bind:value={author} maxlength="120" placeholder="Whoever publishes it" disabled={busy} />
      </label>
      <label class="review-field" title="Shown small and round beside the name">
        <span>Author picture</span>
        <select class="select" value={picture} disabled={busy} onchange={(event) => choose(event.currentTarget.value)}>
          {#each shown.pictures ?? [] as one (one.value)}<option value={one.value}>{one.label}</option>{/each}
          <option value="">None</option>
        </select>
      </label>
    </div>
    {#if (shown.groups ?? []).some((group) => group.key === 'pages')}<p class="review-quiet review-signs">These sign the article and its maps.</p>{/if}
    {@render invite()}
  {/if}
  {#if failed}<p class="review-problem" role="alert">{failed}</p>{/if}
</section>

<style>
  .review { margin-top: 12px; }
  .review-head {
    display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    margin: 0 0 6px; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600;
  }
  .review-head span { color: var(--text-3); font-size: var(--fs-xs); font-weight: 400; }
  .review-groups {
    list-style: none; margin: 0 0 14px; padding: 0; max-height: 240px; overflow: auto;
    border-top: 1px solid var(--border);
  }
  .review-groups li {
    padding: 6px 2px; border-bottom: 1px solid var(--border); color: var(--text-2); font-size: var(--fs-sm);
    line-height: 1.4; overflow-wrap: anywhere;
  }
  .review-groups strong { color: var(--text-1); font-weight: 600; }
  .review-videos { display: flex; align-items: center; gap: 6px; margin: -6px 0 10px; color: var(--text-1); font-size: var(--fs-sm); }
  .review-limit { margin: 0 0 12px; color: var(--warn); font-size: var(--fs-xs); line-height: 1.45; }
  .review-stays { margin: 0 0 10px; color: var(--text-2); font-size: var(--fs-sm); }
  .review-quiet { margin: 0 0 12px; color: var(--text-3); font-size: var(--fs-xs); line-height: 1.45; }
  .review-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 4px 0 12px; }
  .review-field { display: flex; flex-direction: column; gap: 4px; color: var(--text-2); font-size: var(--fs-sm); }
  .review-invite { margin: 0; color: var(--text-2); font-size: var(--fs-sm); line-height: 1.45; }
  .review-invite a { color: var(--accent); }
  .review-done { display: flex; align-items: center; gap: 6px; margin: 0 0 10px; color: var(--text-1); font-size: var(--fs-sm); overflow-wrap: anywhere; }
  .review-done :global(svg) { flex: none; color: var(--ok); }
  .review-problem { margin: 10px 0 0; color: var(--danger); font-size: var(--fs-sm); }
</style>
