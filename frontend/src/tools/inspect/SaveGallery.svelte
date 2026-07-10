<script>
  import Icon from '../../components/Icon.svelte';
  import CollagePreview from './CollagePreview.svelte';

  // Viewer side of the Save tab: everything this session produced that can be
  // filed — the enhanced video, each adjusted frame, the collage. Tick the ones
  // to commit; the menu on the right does the actual save.
  let { savables, saveUi } = $props();

  function toggle(key) {
    saveUi.selected[key] = !saveUi.selected[key];
  }
</script>

<div class="gallery">
  {#if savables.length === 0}
    <div class="empty">
      <Icon name="save" size={34} />
      <p>Nothing to save yet — capture frames, build a collage, or adjust the video first.</p>
    </div>
  {:else}
    {#each savables as it (it.key)}
      <button class="card" class:sel={saveUi.selected[it.key]} class:saved={it.saved} onclick={() => toggle(it.key)}>
        <div class="thumb">
          {#if it.kind === 'collage' && it.collage?.nodes.length}
            {#if it.preview}
              <!-- the actual composited PNG (backend warp), on a checker so alpha reads -->
              <div class="collage-real checker"><img src={it.preview} alt={it.label} /></div>
            {:else}
              <CollagePreview collage={it.collage} />
            {/if}
          {:else if it.thumb}
            <img src={it.thumb} alt={it.label} style:filter={it.filter} />
          {:else}
            <Icon name={it.kind === 'collage' ? 'layers' : it.kind === 'video' ? 'video' : 'image'} size={30} />
          {/if}
          <span class="kind"><Icon name={it.kind === 'video' ? 'video' : it.kind === 'collage' ? 'layers' : 'image'} size={12} /></span>
          <span class="tick"><Icon name="check" size={14} /></span>
        </div>
        <span class="label">{it.label}</span>
        {#if it.saved}<span class="badge">saved</span>{/if}
      </button>
    {/each}
  {/if}
</div>

<style>
  .gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px;
    align-content: start;
    width: 100%;
    height: 100%;
    overflow: auto;
    padding: 4px;
  }
  .empty {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-3);
    text-align: center;
    min-height: 240px;
  }
  .empty p {
    max-width: 280px;
    font-size: var(--fs-sm);
  }
  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px;
    border: 2px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-1);
    text-align: left;
    position: relative;
  }
  .card.sel {
    border-color: var(--accent);
  }
  .thumb {
    position: relative;
    aspect-ratio: 4 / 3;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-0);
    border-radius: var(--r-sm);
    overflow: hidden;
    color: var(--text-3);
  }
  .thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .collage-real {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .collage-real img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .checker {
    background-color: #2a2f3a;
    background-image:
      linear-gradient(45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.07) 75%),
      linear-gradient(45deg, rgba(255, 255, 255, 0.07) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.07) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 8px 8px;
  }
  .kind {
    position: absolute;
    top: 4px;
    left: 4px;
    background: rgba(6, 9, 14, 0.6);
    color: #fff;
    border-radius: 4px;
    display: flex;
    padding: 2px;
  }
  .tick {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--bg-2);
    border: 1px solid var(--border-strong);
    display: flex;
    align-items: center;
    justify-content: center;
    color: transparent;
  }
  .card.sel .tick {
    background: var(--accent);
    border-color: var(--accent);
    color: #10141c;
  }
  .label {
    font-size: var(--fs-sm);
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    position: absolute;
    bottom: 8px;
    right: 8px;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--accent-soft);
    color: var(--accent);
  }
</style>
