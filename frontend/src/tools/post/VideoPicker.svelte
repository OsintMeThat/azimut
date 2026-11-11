<script>
  /**
   * New post → Video thread: which video's proofs to post. It lists the videos holding
   * two proofs to post or more (`postHome.threadVideos`), each with the picture of its
   * first slide; one with a thread in the case already says so and can start another.
   * A video of one proof is not listed: its proof is a geolocation of its own.
   */
  import Modal from '../../components/Modal.svelte';
  import Icon from '../../components/Icon.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { threadVideos } from './postHome.js';

  let { caseId = '', proofs = null, drafts = null, onpick, onclose } = $props();

  const videos = $derived(threadVideos(proofs ?? [], drafts ?? []));
</script>

<Modal title="Video thread" width="560px" {onclose}>
  <p class="vp-lead">Pick the video whose proofs the thread posts.</p>
  {#if proofs === null}
    <p class="vp-none" aria-busy="true">Reading the case…</p>
  {:else if !videos.length}
    <p class="vp-none">No video has two proofs to post yet. A thread posts the proofs of one video; each proof can still go out on its own.</p>
  {:else}
    <div class="vp-list" role="group" aria-label="Videos">
      {#each videos as one (one.video)}
        <button type="button" class="vp-row" onclick={() => onpick?.(one.video)} title={`Post the proofs of ${one.title} as one thread`}>
          <span class="vp-pic dark-surface">
            {#if one.thumb}<img src={fileUrl(caseId, one.thumb)} alt="" loading="lazy" decoding="async" />{:else}<Icon name="video" size={20} />{/if}
          </span>
          <span class="vp-words">
            <span class="vp-title" dir="auto">{one.title}</span>
            <span class="vp-said">{one.count} proofs{one.threaded ? ' · has a thread already' : ''}</span>
          </span>
          <Icon name="chevronRight" size={14} />
        </button>
      {/each}
    </div>
  {/if}
</Modal>

<style>
  .vp-lead { margin: 0 0 12px; color: var(--text-2); font-size: var(--fs-sm); }
  .vp-none { margin: 0; color: var(--text-3); font-size: var(--fs-sm); line-height: 1.5; }
  .vp-list { display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow-y: auto; }
  .vp-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--text-2);
    text-align: left;
  }
  .vp-row:hover { border-color: var(--accent); color: var(--text-1); }
  .vp-row:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .vp-pic {
    display: grid;
    place-items: center;
    flex: none;
    width: 72px;
    height: 44px;
    overflow: hidden;
    border-radius: var(--r-sm);
    background: var(--bg-3);
    color: var(--text-3);
  }
  .vp-pic img { width: 100%; height: 100%; object-fit: cover; }
  .vp-words { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
  .vp-title { overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .vp-said { color: var(--text-3); font-size: var(--fs-xs); }
</style>
