<script>
  import { fileUrl } from '../../lib/fileUrl.js';
  import { foldTerms, foldText } from '../../lib/textFold.js';
  import Icon from '../../components/Icon.svelte';
  import SearchInput from '../../components/SearchInput.svelte';

  // Where a collage's pieces come from: a video of the case, played in the rail under
  // the canvas, whose frames go on the collage from there, or any image of the case. A
  // piece is a recipe frozen when it is added, so what is picked stays as it was even if
  // its file is worked on later. `tab` is bound, so the empty canvas can open the list it
  // points to. `inRail` is the video the rail plays, `counts` the pieces each file has on
  // the collage; `onvideo(item)` puts a video in the rail and `onadd` lays an image.
  let { caseId, videos = [], images = [], inRail = null, counts = new Map(), onvideo, onadd, tab = $bindable('videos') } = $props();

  let query = $state('');

  // Both lists keep the order they arrive in, the files last added first, and the
  // search box only narrows them.
  const matches = (text) => {
    const terms = foldTerms(query);
    const folded = foldText(text);
    return terms.every((term) => folded.includes(term));
  };
  const shownVideos = $derived(videos.filter((item) => matches(item.title || item.filename)));
  const shownImages = $derived(images.filter((item) => matches(item.title || item.filename)));

  function addImage(item) {
    onadd({ frameId: null, save: { path: item.path, time: null, ops: [] } });
  }
</script>

<div class="picker">
  <div class="bar">
    <div class="tabs" role="tablist">
      <button role="tab" class:on={tab === 'videos'} aria-selected={tab === 'videos'} onclick={() => (tab = 'videos')}>
        Videos
      </button>
      <button role="tab" class:on={tab === 'images'} aria-selected={tab === 'images'} onclick={() => (tab = 'images')}>
        Images
      </button>
    </div>
    <div class="find"><SearchInput bind:value={query} placeholder="Search…" width="100%" /></div>
  </div>

  <div class="list">
  {#if tab === 'videos'}
    {#if !videos.length}
      <p class="hint">No videos in the case yet.</p>
    {/if}
    {#each shownVideos as item (item.path)}
      {@const on = counts.get(item.path) ?? 0}
      <button
        class="group-head"
        class:open={item.path === inRail}
        onclick={() => onvideo?.(item)}
        title={item.path === inRail ? 'Playing in the rail under the canvas' : 'Play it in the rail, to add its frames'}
      >
        <span class="file">
          {#if item.thumbnail}<img src={fileUrl(caseId, item.thumbnail)} alt="" loading="lazy" />{:else}<Icon name="video" size={13} />{/if}
        </span>
        <span class="name">{item.title || item.filename}</span>
        {#if on}<span class="count" title={`${on} piece${on === 1 ? '' : 's'} on this collage`}>{on}</span>{/if}
      </button>
    {/each}
    {#if query.trim() && videos.length && !shownVideos.length}
      <p class="hint">No video named “{query.trim()}”.</p>
    {/if}
  {:else}
    {#if !images.length}
      <p class="hint">No images in the case yet.</p>
    {/if}
    {#if query.trim() && images.length && !shownImages.length}
      <p class="hint">No image named “{query.trim()}”.</p>
    {/if}
    <div class="thumbs">
      {#each shownImages as item (item.path)}
        {@const on = counts.get(item.path) ?? 0}
        <button class="thumb" class:used={on > 0} onclick={() => addImage(item)} title={on ? `On this collage ${on}×` : item.title || item.filename}>
          {#if item.thumbnail}<img src={fileUrl(caseId, item.thumbnail)} alt="" loading="lazy" />{:else}<Icon name="image" size={14} />{/if}
          <span class="tag">{#if on}×{on}{:else}<Icon name="plus" size={10} />{/if}</span>
        </button>
      {/each}
    </div>
  {/if}
  </div>
</div>

<style>
  /* The picker takes the room its block is given and the files scroll inside it,
     so a long list never pushes what sits below. */
  .picker {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bar {
    display: flex;
    gap: 6px;
    align-items: stretch;
  }
  .find {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .find :global(.search-box) {
    flex: 1;
  }
  .list {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow: auto;
    padding-right: 2px;
  }
  .tabs {
    display: flex;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .tabs button {
    padding: 5px 9px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    background: transparent;
    border: none;
  }
  .tabs button + button {
    border-left: 1px solid var(--border);
  }
  .tabs .on {
    background: var(--bg-3);
    color: var(--accent);
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 3px;
    background: none;
    border: 0;
    border-radius: var(--r-sm);
    color: var(--text-1);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .group-head:hover,
  .group-head.open {
    background: var(--bg-2);
  }
  .file {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 26px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--bg-0);
    color: var(--text-3);
  }
  .file img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .thumb {
    position: relative;
    width: 64px;
    height: 48px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 2px solid transparent;
    border-radius: var(--r-sm);
    background: var(--bg-0);
    color: var(--text-3);
    overflow: hidden;
  }
  .thumb:hover {
    border-color: var(--accent);
  }
  .thumb.used {
    border-color: var(--border-strong);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .tag {
    position: absolute;
    display: flex;
    align-items: center;
    padding: 0 3px;
    border-radius: 3px;
    background: rgba(10, 10, 10, 0.65);
    color: #fff;
    font-size: 9px;
    right: 2px;
    top: 2px;
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0;
  }
</style>
