<script>
  import { untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { buildFrameOps } from '../../lib/inspect.js';
  import Icon from '../../components/Icon.svelte';

  // Where a collage's pieces come from: the frames cut in Inspect, from any file,
  // or any image already in the case. A piece is a recipe frozen when it is added,
  // so what is picked here stays as it was even if the frame is edited later.
  let { caseId, filters, works, images, used, rev = 0, onadd } = $props();

  let tab = $state('frames');
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

  function toggle(name) {
    open[name] = !open[name];
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

  const stamp = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

  function addFrame(frame) {
    onadd({ frameId: frame.id, save: { path: frame.path, time: frame.time ?? null, ops: buildFrameOps(filters, frame) } });
  }

  function addImage(item) {
    onadd({ frameId: null, save: { path: item.path, time: null, ops: [] } });
  }
</script>

<div class="picker">
  <div class="tabs" role="tablist">
    <button role="tab" class:on={tab === 'frames'} aria-selected={tab === 'frames'} onclick={() => (tab = 'frames')}>
      Frames
    </button>
    <button role="tab" class:on={tab === 'images'} aria-selected={tab === 'images'} onclick={() => (tab = 'images')}>
      Images
    </button>
  </div>

  {#if tab === 'frames'}
    {#if !works.some((w) => w.frames)}
      <p class="hint">Frames captured or edited in Inspect show up here, grouped by file.</p>
    {/if}
    {#each works.filter((w) => w.frames) as w (w.name)}
      <div class="group">
        <button class="group-head" onclick={() => toggle(w.name)} aria-expanded={!!open[w.name]}>
          <Icon name={open[w.name] ? 'chevronDown' : 'chevronRight'} size={13} />
          <Icon name={w.kind === 'video' ? 'video' : 'image'} size={13} />
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
                {#if entry.frame.time != null}<span class="num">{stamp(entry.frame.time)}</span>{/if}
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
  {:else}
    {#if !images.length}
      <p class="hint">No images in the case yet.</p>
    {/if}
    <div class="thumbs">
      {#each images as item (item.path)}
        <button class="thumb" onclick={() => addImage(item)} title={item.title || item.filename}>
          {#if item.thumbnail}<img src={fileUrl(caseId, item.thumbnail)} alt="" loading="lazy" />{:else}<Icon name="image" size={14} />{/if}
          <span class="tag"><Icon name="plus" size={10} /></span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tabs {
    display: flex;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .tabs button {
    flex: 1;
    padding: 5px 4px;
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
    gap: 6px;
    width: 100%;
    padding: 4px 2px;
    background: none;
    border: 0;
    color: var(--text-1);
    font-size: var(--fs-sm);
    text-align: left;
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
