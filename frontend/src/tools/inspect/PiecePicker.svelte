<script>
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { buildFrameOps, clockTime } from '../../lib/inspect.js';
  import { foldTerms, foldText } from '../../lib/textFold.js';
  import Icon from '../../components/Icon.svelte';
  import SearchInput from '../../components/SearchInput.svelte';

  // Where a collage's pieces come from: the frames cut in Inspect, from any file,
  // or any image already in the case. A piece is a recipe frozen when it is added,
  // so what is picked here stays as it was even if the frame is edited later.
  let { caseId, filters, works, images, used, rev = 0, onadd } = $props();

  let tab = $state('frames');
  let query = $state('');

  // Both lists keep the order they arrive in, the files last worked on and the
  // images last added first, and the search box only narrows them.
  const matches = (text) => {
    const terms = foldTerms(query);
    const folded = foldText(text);
    return terms.every((term) => folded.includes(term));
  };
  const shownWorks = $derived(works.filter((w) => w.frames && matches(w.title)));
  const shownImages = $derived(images.filter((item) => matches(item.title || item.filename)));
  let open = $state({}); // work name -> expanded
  let frames = $state({}); // work name -> [{ frame, thumb }] once fetched
  const blobs = new Set();

  // A thumbnail per frame, rendered as the frame reads (turned, adjusted, cropped),
  // only for the files the analyst actually unfolds.
  async function load(name) {
    const saved = await api.get(`/api/cases/${caseId}/inspect/works/${encodeURIComponent(name)}`);
    const list = (saved.spec?.frames ?? []).map((frame) => ({ frame, thumb: null }));
    frames[name] = list;
    for (const entry of frames[name]) {
      try {
        const res = await fetch(`/api/cases/${caseId}/inspect/render-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: entry.frame.path, time: entry.frame.time ?? null, ops: buildFrameOps(filters, entry.frame) }),
        });
        if (!res.ok) throw new Error('render failed');
        const url = URL.createObjectURL(await res.blob());
        blobs.add(url);
        entry.thumb = url;
      } catch {
        entry.missing = true;
      }
    }
  }

  // One file unfolded at a time, so the list stays a list of files.
  function toggle(name) {
    open = open[name] ? {} : { [name]: true };
    if (open[name] && !frames[name]) load(name).catch(() => (frames[name] = []));
  }

  // A capture in Inspect since the last look means the frames shown are stale.
  $effect(() => {
    rev;
    caseId;
    for (const url of blobs) URL.revokeObjectURL(url);
    blobs.clear();
    frames = {};
    untrack(() => {
      for (const [name, isOpen] of Object.entries(open)) if (isOpen) load(name).catch(() => (frames[name] = []));
    });
  });

  $effect(() => () => {
    for (const url of blobs) URL.revokeObjectURL(url);
  });

  function addFrame(frame) {
    onadd({ frameId: frame.id, save: { path: frame.path, time: frame.time ?? null, ops: buildFrameOps(filters, frame) } });
  }

  function addImage(item) {
    onadd({ frameId: null, save: { path: item.path, time: null, ops: [] } });
  }
</script>

<div class="picker">
  <div class="bar">
    <div class="tabs" role="tablist">
      <button role="tab" class:on={tab === 'frames'} aria-selected={tab === 'frames'} onclick={() => (tab = 'frames')}>
        Frames
      </button>
      <button role="tab" class:on={tab === 'images'} aria-selected={tab === 'images'} onclick={() => (tab = 'images')}>
        Images
      </button>
    </div>
    <div class="find"><SearchInput bind:value={query} placeholder="Search…" width="100%" /></div>
  </div>

  <div class="list">
  {#if tab === 'frames'}
    {#if !works.some((w) => w.frames)}
      <p class="hint">Frames cut in Inspect show up here.</p>
    {/if}
    {#each shownWorks as w (w.name)}
      <div class="group">
        <button class="group-head" class:open={open[w.name]} onclick={() => toggle(w.name)} aria-expanded={!!open[w.name]} title={w.title}>
          <span class="file">
            {#if w.thumb}<img src={fileUrl(caseId, w.thumb)} alt="" loading="lazy" />{:else}<Icon name={w.kind === 'video' ? 'video' : 'image'} size={13} />{/if}
          </span>
          <span class="name">{w.title}</span>
          <span class="count">{w.frames}</span>
        </button>
        {#if open[w.name]}
          <div class="thumbs">
            {#each frames[w.name] ?? [] as entry (entry.frame.id)}
              {@const times = used.get(entry.frame.id) ?? 0}
              <button
                class="thumb"
                class:used={times > 0}
                disabled={entry.missing}
                onclick={() => addFrame(entry.frame)}
                title={times ? `On this collage ${times}×` : 'Add to the collage'}
              >
                {#if entry.thumb}<img src={entry.thumb} alt="" />{:else if entry.missing}<Icon name="alert" size={14} />{:else}<span class="spinner"></span>{/if}
                {#if entry.frame.time != null}<span class="num">{clockTime(entry.frame.time)}</span>{/if}
                <span class="tag">{#if times}×{times}{:else}<Icon name="plus" size={10} />{/if}</span>
              </button>
            {:else}
              {#if frames[w.name]}
                <span class="hint">No frames left here.</span>
              {:else}
                <span class="spinner" aria-label="Loading"></span>
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    {#if query.trim() && works.some((w) => w.frames) && !shownWorks.length}
      <p class="hint">No file named “{query.trim()}”.</p>
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
        <button class="thumb" onclick={() => addImage(item)} title={item.title || item.filename}>
          {#if item.thumbnail}<img src={fileUrl(caseId, item.thumbnail)} alt="" loading="lazy" />{:else}<Icon name="image" size={14} />{/if}
          <span class="tag"><Icon name="plus" size={10} /></span>
        </button>
      {/each}
    </div>
  {/if}
  </div>
</div>

<style>
  .picker {
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
  /* The files scroll on their own, so the controls below stay in reach. */
  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 38vh;
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
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
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
  .num,
  .tag {
    position: absolute;
    display: flex;
    align-items: center;
    padding: 0 3px;
    border-radius: 3px;
    background: rgba(10, 10, 10, 0.65);
    color: #fff;
    font-size: 9px;
  }
  .num {
    left: 2px;
    bottom: 2px;
    font-family: var(--font-mono);
  }
  .tag {
    right: 2px;
    top: 2px;
  }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .hint {
    color: var(--text-3);
    font-size: var(--fs-xs);
    margin: 0;
  }
</style>
