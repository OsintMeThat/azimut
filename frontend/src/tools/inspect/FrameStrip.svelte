<script>
  import { previewStyle, cropImgStyle, styleText } from '../../lib/inspect.js';
  import Icon from '../../components/Icon.svelte';

  // What has been cut from the open file, left to right in the order it was cut.
  // A video leads with the clip itself, which is where frames come from; clicking
  // a tile is what puts it in the viewer. The strip replaces the old tabs: there is
  // no stage to move through, only the file and what was taken from it.
  //
  // A tile's top-left corner says whether the frame is in the case. Until it is, the
  // corner is a save press, so filing a capture never means opening it first.
  let {
    source,
    sourceThumb = null,
    frames,
    selected,
    filters,
    filedIds,
    busyIds = new Set(),
    removable = true,
    savingAll = false,
    onselect,
    onremove,
    onsave,
    onsaveall,
  } = $props();

  const unfiled = $derived(frames.filter((f) => !filedIds.has(f.id) && !busyIds.has(f.id) && f.url).length);

  function stamp(t) {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(1).padStart(4, '0');
    return `${m}:${s}`;
  }

  const label = (fr, i) => (fr.time != null ? `Frame ${i + 1} at ${stamp(fr.time)}` : `Frame ${i + 1}`);
</script>

<div class="strip" aria-label="Frames">
  {#if source.kind === 'video'}
    <button
      class="tile source"
      class:active={selected === 'video'}
      onclick={() => onselect('video')}
      title="The video, where frames are captured"
    >
      {#if sourceThumb}<img src={sourceThumb} alt="" />{:else}<Icon name="video" size={20} />{/if}
      <span class="tag"><Icon name="play" size={10} /> Video</span>
    </button>
  {/if}

  {#each frames as fr, i (fr.id)}
    {@const look = previewStyle(filters, fr.adjust)}
    {@const filed = filedIds.has(fr.id)}
    <div class="tile" class:active={selected === fr.id}>
      <button class="pick" onclick={() => onselect(fr.id)} title={label(fr, i)} aria-label={label(fr, i)}>
        {#if fr.url}
          <span class="crop">
            <img src={fr.url} alt="" style={styleText(cropImgStyle(fr.crop))} style:filter={look.filter} />
          </span>
        {:else if fr.missing}
          <Icon name="alert" size={16} />
        {:else}
          <span class="spinner" aria-hidden="true"></span>
        {/if}
        <span class="num">{fr.time != null ? stamp(fr.time) : i + 1}</span>
        {#if filed}
          <span class="mark filed" title="In the case"><Icon name="check" size={10} /></span>
        {/if}
      </button>
      {#if !filed && busyIds.has(fr.id)}
        <span class="mark busy"><span class="spinner small" aria-label="Saving"></span></span>
      {:else if !filed && fr.url}
        <button class="mark save" onclick={() => onsave(fr.id)} aria-label="Save frame" title="Save to case">
          <Icon name="save" size={11} />
        </button>
      {/if}
      {#if removable}
        <button class="del" onclick={() => onremove(fr.id)} aria-label="Remove frame" title="Remove frame">
          <Icon name="x" size={11} />
        </button>
      {/if}
    </div>
  {/each}

  {#if source.kind === 'video' && frames.length === 0}
    <p class="empty">Frames you capture are kept with this video.</p>
  {/if}

  {#if unfiled > 1}
    <button class="btn btn-sm save-all" disabled={savingAll} onclick={onsaveall} title="Save every frame not in the case yet">
      <Icon name="save" size={13} /> {savingAll ? 'Saving…' : `Save ${unfiled} frames`}
    </button>
  {/if}
</div>

<style>
  .strip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg-1);
    overflow-x: auto;
    flex-shrink: 0;
    min-height: 76px;
  }
  .tile {
    position: relative;
    flex-shrink: 0;
    width: 88px;
    height: 58px;
    border-radius: var(--r-sm);
    border: 2px solid transparent;
    background: var(--bg-0);
    overflow: hidden;
  }
  .tile.active {
    border-color: var(--accent);
  }
  button.tile,
  .pick {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text-3);
    cursor: pointer;
  }
  button.tile {
    width: 88px;
    border: 2px solid transparent;
    background: var(--bg-0);
  }
  button.tile.active {
    border-color: var(--accent);
  }
  .tile img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .crop {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .crop img {
    position: absolute;
    inset: 0;
  }
  .tag,
  .num {
    position: absolute;
    left: 4px;
    bottom: 3px;
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 0 4px;
    border-radius: 3px;
    background: rgba(10, 10, 10, 0.65);
    color: #fff;
    font-size: 10px;
    font-family: var(--font-mono);
  }
  .mark {
    position: absolute;
    top: 2px;
    left: 2px;
    display: flex;
    padding: 2px;
    border: 0;
    border-radius: 3px;
    background: rgba(10, 10, 10, 0.7);
    color: #fff;
  }
  .mark.filed {
    top: 3px;
    left: 3px;
    border-radius: 50%;
    background: var(--ok);
  }
  .mark.busy {
    pointer-events: none;
  }
  .mark.save {
    cursor: pointer;
  }
  .mark.save:hover,
  .mark.save:focus-visible {
    background: var(--accent);
  }
  .del {
    position: absolute;
    top: 2px;
    right: 2px;
    display: none;
    padding: 2px;
    border: 0;
    border-radius: 3px;
    background: rgba(10, 10, 10, 0.7);
    color: #fff;
    cursor: pointer;
  }
  .tile:hover .del,
  .tile:focus-within .del {
    display: flex;
  }
  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--border);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .spinner.small {
    width: 11px;
    height: 11px;
    border-width: 1.5px;
    border-color: rgba(255, 255, 255, 0.3);
    border-top-color: #fff;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .empty {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .save-all {
    margin-left: auto;
    flex-shrink: 0;
  }
</style>
