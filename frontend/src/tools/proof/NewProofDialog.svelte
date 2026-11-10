<script>
  /**
   * New proof: the case's pictures to start a proof from, and the house style it starts in.
   *
   * On the left, where the pictures come from (`lib/newProof.js`): All, then each source
   * the case holds something of, its folders, and the scenes still to prove when it has
   * some. On the right, the pictures as large thumbnails: a press adds one, and its number
   * says its place among the panels. Under Videos each video is a block of its frames and
   * collages. A scene pressed shows only its material, all ticked, and the proof made of
   * it takes the scene up, as Inspect's Make the proof does (the composer's
   * `readSceneMaterial` and `makeSceneProof`).
   *
   * At the foot, the pictures picked in panel order, dragged to reorder or taken out, the
   * template, **Create proof** and a quiet **Start empty**. All is where it opens, so a
   * proof is still three presses away: New proof, a picture, Create proof. Enter in the
   * search creates, Escape closes.
   */
  import { tick } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import SceneCounts from '../../components/SceneCounts.svelte';
  import { fileUrl } from '../../lib/fileUrl.js';
  import { filterProofPanelItems } from '../../lib/composer.js';
  import { preciseClock } from '../../lib/inspectPlayer.js';
  import {
    inFolder, inSource, movePick, pictureFolders, proofSources, sceneMaterial, togglePick, videoBlocks,
  } from '../../lib/newProof.js';

  let {
    templateId = $bindable(''),
    templates = [],
    /** The case's pictures, as `fetchPanelItems` reads them. */
    items = [],
    /** The scenes still to prove (`lib/newProof.scenesToProve`); none, and the window shows no scene at all. */
    scenes = [],
    loading = false,
    creating = false,
    caseId = '',
    /** What the case calls a file, its name when it says nothing. */
    titleOf = () => '',
    /** A file's thumbnail path, or null: a video's, for its block. */
    thumbOf = () => null,
    /** `(entry)`: the scene's material, `{ frames, collages, captures, capture, picture }`, or null. */
    readScene = async () => null,
    /** `({ keys, scene })`: the proof made of these pictures, in this order; `scene` the one it takes up. */
    oncreate,
    /** An empty proof, in the template chosen. */
    onempty,
    onimport,
    onclose,
  } = $props();

  const SOURCE_TITLES = {
    all: 'All pictures', satellite: 'Satellite captures', videos: 'Frames and collages of videos',
    collages: 'Collages', screenshots: 'Screenshots', photos: 'Photos',
  };

  /** What the right side shows: a source, a folder, or a scene. */
  let view = $state({ source: 'all' });
  let query = $state('');
  /** The pictures picked, by key, in panel order. */
  let picked = $state([]);
  /** The scene the proof will take up, `{ entry, material }`, while one is picked. */
  let scene = $state(null);
  let sceneBusy = $state(false);
  let sceneError = $state('');
  let searchField = $state(null);
  let dragged = $state(-1);
  let dropAt = $state(-1);

  const sources = $derived(proofSources(items));
  const folders = $derived(pictureFolders(items));
  const shown = $derived.by(() => {
    if (view.scene) return [];
    const within = view.folder != null ? items.filter((item) => inFolder(item, view.folder)) : items.filter((item) => inSource(item, view.source));
    return filterProofPanelItems(within, query, 'all');
  });
  const blocks = $derived(view.source === 'videos' && !view.scene ? videoBlocks(shown, titleOf) : []);
  const material = $derived(scene?.material ? sceneMaterial(scene.material) : []);
  const groups = $derived([
    { id: 'picture', label: 'The picture', list: material.filter((one) => one.group === 'picture') },
    { id: 'frames', label: 'Frames', list: material.filter((one) => one.group === 'frames') },
    { id: 'collages', label: 'Collages', list: material.filter((one) => one.group === 'collages') },
    { id: 'captures', label: 'Captures gathered for it', list: material.filter((one) => one.group === 'captures') },
  ].filter((group) => group.list.length));

  /** Every picture this window can show, by key: its picture and what it is called. */
  const known = $derived.by(() => {
    const out = new Map();
    for (const item of items) out.set(item.src, { url: item.thumb ? fileUrl(caseId, item.thumb) : '', label: item.label });
    for (const one of material) out.set(one.key, { url: pictureOf(one), label: labelOf(one) });
    return out;
  });
  const place = $derived(new Map(picked.map((key, i) => [key, i + 1])));
  /** The frames ticked that the case does not hold yet, filed on the way. */
  const unfiled = $derived(material.filter((one) => one.frame && !one.frame.path && place.has(one.key)).length);
  const labels = $derived(new Map(items.map((item) => [item.src, item.label])));
  const sceneNote = $derived(`All ticked. The proof made of them takes this scene.${
    unfiled ? ` Saves ${unfiled === 1 ? '1 frame' : `${unfiled} frames`} to the case on the way.` : ''}`);
  const heading = $derived(
    view.scene ? scene?.entry.name ?? ''
      : view.folder != null ? view.folder
        : SOURCE_TITLES[view.source] ?? 'All pictures',
  );

  $effect(() => {
    // the search is where the keys go first, so Enter creates
    if (searchField && !loading) searchField.focus();
  });

  const clock = (time) => preciseClock(time).replace(/(\.\d)\d\d$/, '$1');
  /** A scene's time and its file; a scene named by its time says it once. */
  const sceneWhere = (entry) => (entry.name === entry.time ? entry.title : `${entry.time} · ${entry.title}`);
  const many = (n, word) => (n === 1 ? `1 ${word}` : `${n} ${word}s`);
  /** `5 frames · 1 collage`, whichever of them there are. */
  const counted = (frames, frame, collages, collage) => [frames ? many(frames, frame) : '', collages ? many(collages, collage) : ''].filter(Boolean).join(' · ');

  function pictureOf(one) {
    if (one.frame) return one.frame.url || '';
    return one.collage?.url || one.capture?.url || one.picture?.url || '';
  }

  /** What a piece of a scene is called: as the case calls it, a frame it does not hold yet said so. */
  function labelOf(one) {
    if (one.frame) return one.frame.path ? labels.get(one.frame.path) ?? `Frame at ${clock(one.frame.time)}` : 'Not in the case yet';
    return one.collage?.title || labels.get(one.capture?.path) || one.capture?.title || one.picture?.title || '';
  }

  function pick(key) {
    picked = togglePick(picked, key);
  }

  function showSource(id) {
    view = { source: id };
  }

  function showFolder(path) {
    view = { source: null, folder: path };
  }

  /** A scene pressed: only its material, all of it ticked, and the proof takes the scene up. */
  async function showScene(entry) {
    view = { scene: entry.key };
    query = '';
    sceneError = '';
    if (scene?.entry.key === entry.key && scene.material) return;
    scene = { entry, material: null };
    sceneBusy = true;
    try {
      const read = await readScene(entry);
      if (scene?.entry.key !== entry.key) return;
      if (!read) {
        sceneError = 'This scene could not be read. It may have left its video.';
        return;
      }
      scene = { entry, material: read };
      picked = sceneMaterial(read).map((one) => one.key);
    } finally {
      // a scene pressed since is still being read
      if (scene?.entry.key === entry.key) sceneBusy = false;
    }
  }

  /** The proof no longer takes the scene up: the pictures the case holds stay picked. */
  function letSceneGo() {
    const held = new Set(items.map((item) => item.src));
    picked = picked.filter((key) => held.has(key));
    scene = null;
    if (view.scene) view = { source: 'all' };
  }

  function searched() {
    // the search finds pictures of the case: a scene shown gives way to All, still taken up
    if (view.scene && query) view = { source: 'all' };
  }

  function create(event) {
    event?.preventDefault();
    if (creating) return;
    oncreate?.({ keys: [...picked], scene: scene?.material ? scene.entry : null });
  }

  // -- the foot's pictures: dragged to reorder, the keys too ---------------------------------

  function chipKeys(event, at) {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      picked = picked.filter((_, i) => i !== at);
      return;
    }
    if (!event.altKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const to = at + (event.key === 'ArrowLeft' ? -1 : 1);
    picked = movePick(picked, at, to);
    tick().then(() => document.querySelector(`.np-chip[data-at="${Math.max(0, Math.min(picked.length - 1, to))}"]`)?.focus());
  }

  function drop(event, at) {
    event.preventDefault();
    if (dragged >= 0 && dragged !== at) picked = movePick(picked, dragged, at);
    dragged = -1;
    dropAt = -1;
  }
</script>

{#snippet tile(key, url, label, { icon = 'image', badge = '', pending = false } = {})}
  {@const n = place.get(key)}
  <button type="button" class="np-tile selectable-pick" class:selected={!!n} aria-pressed={!!n}
    title={n ? `Panel ${n}. Press to take it out` : `Add ${label} as a panel`} onclick={() => pick(key)}>
    <span class="np-pic">
      {#if url}
        <img src={url} alt="" loading="lazy" decoding="async" />
      {:else}
        <span class="np-none"><Icon name={pending ? 'clock' : icon} size={22} /></span>
      {/if}
      {#if badge}<span class="np-time">{badge}</span>{/if}
      <span class="np-mark" aria-hidden="true">{#if n}{n}{:else}<Icon name="plus" size={13} />{/if}</span>
    </span>
    <span class="np-name" dir="auto">{label}</span>
  </button>
{/snippet}

{#snippet itemTile(item)}
  {@render tile(item.src, item.thumb ? fileUrl(caseId, item.thumb) : '', item.label, {
    icon: item.kind === 'satellite' ? 'satellite' : item.origin ? 'video' : 'image',
    badge: item.origin && !item.collage ? clock(item.origin.time) : '',
    pending: item.thumbPending,
  })}
{/snippet}

<Modal title="New proof" width="min(1100px, calc(100vw - 40px))" onclose={() => { if (!creating) onclose?.(); }}>
  <form class="np" onsubmit={create}>
    <nav class="np-from" aria-label="Where the pictures come from">
      <div class="np-lists">
      <h4>From</h4>
      <ul class="np-list">
        {#each sources as source (source.id)}
          {@const on = !view.scene && view.folder == null && view.source === source.id}
          <li>
            <button type="button" class="np-row" class:on aria-current={on ? 'true' : undefined} onclick={() => showSource(source.id)}>
              <Icon name={source.icon} size={14} /><span class="np-grow">{source.label}</span><span class="np-count">{source.count}</span>
            </button>
          </li>
        {/each}
      </ul>

      {#if folders.length}
        <h4>Folders</h4>
        <ul class="np-list">
          {#each folders as folder (folder.path)}
            {@const on = view.folder === folder.path}
            <li>
              <button type="button" class="np-row" class:on aria-current={on ? 'true' : undefined} style:padding-left={`${8 + folder.depth * 12}px`}
                title={folder.path} onclick={() => showFolder(folder.path)}>
                <Icon name="folder" size={13} /><span class="np-grow" dir="auto">{folder.name}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      {#if scenes.length}
        <h4>Scenes to prove <span class="np-count">{scenes.length}</span></h4>
        <ul class="np-list np-scenes" aria-label="Scenes to prove">
          {#each scenes as entry (entry.key)}
            {@const on = view.scene === entry.key}
            <li>
              <button type="button" class="np-scene" class:on class:taken={scene?.entry.key === entry.key} style:--scene={entry.color}
                aria-current={on ? 'true' : undefined} title={`${entry.name} · ${sceneWhere(entry)}`}
                onclick={() => showScene(entry)}>
                <span class="np-dot" aria-hidden="true"></span>
                <span class="np-scene-words">
                  <span class="np-scene-name" dir="auto">{entry.name}</span>
                  <span class="np-scene-line">
                    <span class="np-scene-said num" dir="auto">{sceneWhere(entry)}</span>
                    <!-- what the map and the video gave it, as everywhere else -->
                    <span class="np-scene-counts"><SceneCounts scene={entry.row} live={entry.live} size={10} /></span>
                  </span>
                </span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      </div>
      <button type="button" class="np-import" disabled={creating} onclick={() => onimport?.()}
        title="A proof somebody already published, brought in whole">
        <Icon name="download" size={13} /> Import a published proof
      </button>
    </nav>

    <section class="np-main" aria-label={heading}>
      <div class="np-top">
        <label class="np-search">
          <Icon name="search" size={14} />
          <input bind:this={searchField} bind:value={query} oninput={searched} placeholder="Search pictures…" aria-label="Search pictures" />
          {#if query}
            <button type="button" class="np-clear" aria-label="Clear search" title="Clear search" onclick={() => (query = '')}><Icon name="x" size={12} /></button>
          {/if}
        </label>
      </div>

      <div class="np-body">
        {#if view.scene}
          {@const entry = scene?.entry}
          {#if entry}
            <div class="np-scene-head" style:--scene={entry.color}>
              <span class="np-dot big" aria-hidden="true"></span>
              <div>
                <h3 dir="auto">{entry.name}</h3>
                <p class="num" dir="auto">{sceneWhere(entry)}</p>
                <p class="np-scene-head-counts"><SceneCounts scene={entry.row} live={entry.live} size={12} /></p>
              </div>
            </div>
          {/if}
          {#if sceneBusy}
            <p class="np-say" aria-busy="true">Reading the scene…</p>
          {:else if sceneError}
            <p class="np-say">{sceneError}</p>
          {:else}
            <p class="np-note">{sceneNote}</p>
            {#each groups as group (group.id)}
              <h5>{group.label} <span class="np-count">{group.list.length}</span></h5>
              <div class="np-grid">
                {#each group.list as one (one.key)}
                  {@render tile(one.key, pictureOf(one), labelOf(one), {
                    icon: one.frame ? 'video' : one.collage ? 'layers' : 'image',
                    badge: one.frame ? clock(one.frame.time) : '',
                    pending: !!one.frame && !one.frame.url,
                  })}
                {/each}
              </div>
            {/each}
          {/if}
        {:else if loading}
          <p class="np-say" aria-busy="true">Reading the case's pictures…</p>
        {:else if !items.length}
          <div class="np-empty">
            <Icon name="image" size={30} />
            <p>No pictures in this case yet. Start empty and add panels as they come.</p>
          </div>
        {:else if !shown.length}
          <p class="np-say">No picture matches this search.</p>
        {:else if blocks.length}
          {#each blocks as block (block.video)}
            {@const thumb = thumbOf(block.video)}
            <div class="np-video">
              <span class="np-video-pic">
                {#if thumb}<img src={fileUrl(caseId, thumb)} alt="" loading="lazy" decoding="async" />{:else}<Icon name="video" size={15} />{/if}
              </span>
              <h5 dir="auto">{block.title}</h5>
              <span class="np-count">{counted(block.frames.length, 'frame', block.collages.length, 'collage')}</span>
            </div>
            <div class="np-grid">
              {#each [...block.frames, ...block.collages] as item (item.src)}{@render itemTile(item)}{/each}
            </div>
          {/each}
        {:else}
          <div class="np-grid">
            {#each shown as item (item.src)}{@render itemTile(item)}{/each}
          </div>
        {/if}
      </div>
    </section>

    <footer class="np-foot">
      <div class="np-picked">
        {#if scene?.material}
          <span class="np-takes" style:--scene={scene.entry.color} title="The proof takes this scene up">
            <span class="np-dot" aria-hidden="true"></span><span class="np-takes-name" dir="auto">{scene.entry.name}</span>
            <button type="button" aria-label="Not this scene" title="Make the proof without taking this scene up" onclick={letSceneGo}><Icon name="x" size={11} /></button>
          </span>
        {/if}
        {#if picked.length}
          <div class="np-chips" role="group" aria-label="Panels, in order">
            {#each picked as key, at (key)}
              {@const chip = known.get(key)}
              <div class="np-chip-slot" role="presentation">
                <button type="button" class="np-chip" class:drop={dropAt === at} data-at={at} draggable="true"
                  aria-label={`Panel ${at + 1}: ${chip?.label ?? key}`} title={`${chip?.label ?? key}. Drag to reorder, Alt+←/→ with the keys, Delete to take it out`}
                  ondragstart={() => (dragged = at)} ondragend={() => { dragged = -1; dropAt = -1; }}
                  ondragover={(event) => { event.preventDefault(); dropAt = at; }} ondrop={(event) => drop(event, at)}
                  onkeydown={(event) => chipKeys(event, at)}>
                  {#if chip?.url}<img src={chip.url} alt="" draggable="false" />{:else}<span class="np-chip-none"><Icon name="image" size={12} /></span>{/if}
                  <span class="np-chip-n">{at + 1}</span>
                </button>
                <button type="button" class="np-chip-x" tabindex="-1" aria-label={`Take panel ${at + 1} out`} title="Take it out" onclick={() => pick(key)}><Icon name="x" size={10} /></button>
              </div>
            {/each}
          </div>
        {:else}
          <p class="np-hint">Press pictures to lay them out as panels, in the order pressed.</p>
        {/if}
      </div>
      <label class="np-template" title="Sets the look without choosing content">
        <span>Template</span>
        <select class="input" bind:value={templateId}>
          <option value="">No template</option>
          {#each templates as template (template.id)}
            <option value={template.id}>{template.name}</option>
          {/each}
        </select>
      </label>
      <button type="button" class="btn btn-ghost np-empty-btn" disabled={creating} onclick={() => onempty?.()}
        title="A proof with no panel yet, in this template">Start empty</button>
      <button type="submit" class="btn btn-primary np-create" disabled={creating}>
        <Icon name="plus" size={15} /> {creating ? 'Creating…' : 'Create proof'}
      </button>
    </footer>
  </form>
</Modal>

<style>
  .np {
    display: grid;
    grid-template-columns: 228px minmax(0, 1fr);
    grid-template-rows: minmax(0, 1fr) auto;
    height: min(700px, calc(100vh - 150px));
    margin: 0 -18px -18px;
    border-top: 1px solid var(--border);
  }

  /* -- where from ----------------------------------------------------------------------- */
  .np-from {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg-0) 55%, var(--bg-1));
  }
  .np-lists { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 10px 10px 14px; }
  h4 {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 12px 0 5px 8px;
    color: var(--text-3);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  h4:first-child { margin-top: 2px; }
  .np-list { display: flex; flex-direction: column; gap: 1px; margin: 0; padding: 0; list-style: none; }
  .np-row {
    position: relative;
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    min-height: 30px;
    padding: 4px 8px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .np-row:hover { background: var(--bg-3); color: var(--text-1); }
  .np-row.on { background: var(--accent-soft); color: var(--text-1); font-weight: 600; }
  .np-row.on::before {
    content: '';
    position: absolute;
    left: -6px;
    top: 7px;
    bottom: 7px;
    width: 3px;
    border-radius: 2px;
    background: var(--accent);
  }
  .np-grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .np-count { color: var(--text-3); font-size: var(--fs-xs); font-weight: 500; font-variant-numeric: tabular-nums; }
  .num { font-variant-numeric: tabular-nums; }

  .np-scenes { gap: 2px; }
  .np-scene {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid transparent;
    border-radius: var(--r-sm);
    text-align: left;
  }
  .np-scene:hover { background: var(--bg-3); }
  .np-scene.taken { border-color: color-mix(in srgb, var(--scene) 55%, transparent); }
  .np-scene.on { background: color-mix(in srgb, var(--scene) 14%, transparent); border-color: var(--scene); }
  .np-dot {
    flex: none;
    width: 9px;
    height: 9px;
    margin-top: 4px;
    border-radius: 50%;
    background: var(--scene, var(--accent));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--scene, var(--accent)) 25%, transparent);
  }
  .np-dot.big { width: 12px; height: 12px; margin-top: 6px; }
  .np-scene-words { display: flex; flex: 1; flex-direction: column; gap: 1px; min-width: 0; }
  .np-scene-name { overflow: hidden; color: var(--text-1); font-size: var(--fs-sm); font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .np-scene-said { overflow: hidden; color: var(--text-3); font-size: var(--fs-xs); text-overflow: ellipsis; white-space: nowrap; }
  .np-scene-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .np-scene-said { min-width: 0; }
  .np-scene-counts { flex: none; margin-left: auto; font-size: var(--fs-xs); }

  .np-import {
    flex: none;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 14px 11px 22px;
    border-top: 1px solid var(--border);
    color: var(--text-3);
    font-size: var(--fs-xs);
    text-align: left;
  }
  .np-import:hover:not(:disabled) { color: var(--text-1); }

  /* -- the pictures --------------------------------------------------------------------- */
  .np-main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .np-top { display: flex; align-items: center; gap: 10px; padding: 12px 16px 10px; }
  .np-search {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    color: var(--text-3);
  }
  .np-search:focus-within { border-color: var(--accent); }
  .np-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-1); font: inherit; font-size: var(--fs-sm); }
  .np-clear { display: flex; color: var(--text-3); }
  .np-clear:hover { color: var(--text-1); }
  .np-body { flex: 1; min-height: 0; overflow-y: auto; padding: 2px 16px 18px; }
  h5 { display: flex; align-items: center; gap: 7px; margin: 14px 0 8px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 700; }
  .np-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); gap: 12px; }

  .np-tile {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--r-lg);
    background: var(--bg-1);
    text-align: left;
    transition: border-color 0.12s var(--ease), box-shadow 0.12s var(--ease), transform 0.12s var(--ease);
  }
  .np-tile:hover { border-color: var(--border-strong); transform: translateY(-1px); }
  .np-tile:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .np-tile.selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  /* every tile the same height: a phone's tall picture is cut to the box rather than
     stretching it, since a ratio box otherwise grows to its content */
  .np-pic { position: relative; display: block; aspect-ratio: 16 / 10; overflow: hidden; background: var(--bg-3); }
  .np-pic img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .np-none { display: grid; place-items: center; width: 100%; height: 100%; color: var(--text-3); }
  .np-time {
    position: absolute;
    left: 6px;
    bottom: 6px;
    padding: 1px 5px;
    border-radius: var(--r-sm);
    background: rgba(0, 0, 0, 0.66);
    color: #fff;
    font-size: 10.5px;
    font-variant-numeric: tabular-nums;
  }
  .np-mark {
    position: absolute;
    top: 7px;
    right: 7px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    opacity: 0;
    transition: opacity 0.12s var(--ease);
  }
  .np-tile:hover .np-mark, .np-tile:focus-visible .np-mark { opacity: 1; }
  .np-tile.selected .np-mark { opacity: 1; background: var(--accent); color: var(--accent-text); box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4); }
  .np-name {
    padding: 7px 9px 8px;
    overflow: hidden;
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .np-tile.selected .np-name { color: var(--text-1); }

  .np-video { display: flex; align-items: center; gap: 9px; margin: 16px 0 8px; }
  .np-video:first-child { margin-top: 6px; }
  .np-video h5 { margin: 0; color: var(--text-1); font-size: var(--fs-sm); }
  .np-video-pic {
    display: grid;
    place-items: center;
    width: 42px;
    height: 26px;
    overflow: hidden;
    border-radius: var(--r-sm);
    background: var(--bg-3);
    color: var(--text-3);
  }
  .np-video-pic img { width: 100%; height: 100%; object-fit: cover; }

  .np-scene-head { display: flex; align-items: flex-start; gap: 11px; margin: 6px 0 2px; }
  .np-scene-head h3 { margin: 0; color: var(--text-1); font-size: var(--fs-lg); font-weight: 650; }
  .np-scene-head p { margin: 2px 0 0; color: var(--text-3); font-size: var(--fs-sm); }
  .np-scene-head .np-scene-head-counts { margin-top: 4px; }
  .np-note { margin: 8px 0 0; color: var(--text-3); font-size: var(--fs-xs); }
  .np-say { margin: 24px 0; color: var(--text-3); font-size: var(--fs-sm); text-align: center; }
  .np-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    margin-top: 40px;
    padding: 34px 20px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--r-lg);
    color: var(--text-3);
    font-size: var(--fs-sm);
    text-align: center;
  }

  /* -- the foot ------------------------------------------------------------------------- */
  .np-foot {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    padding: 10px 16px;
    border-top: 1px solid var(--border);
    background: var(--bg-1);
  }
  .np-picked { flex: 1; display: flex; align-items: center; gap: 10px; min-width: 0; }
  .np-hint { margin: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .np-takes {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    max-width: 200px;
    height: 28px;
    padding: 0 4px 0 9px;
    border: 1px solid color-mix(in srgb, var(--scene) 60%, transparent);
    border-radius: 999px;
    background: color-mix(in srgb, var(--scene) 12%, transparent);
    color: var(--text-1);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .np-takes .np-dot { margin-top: 0; }
  .np-takes-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .np-takes button { display: grid; place-items: center; width: 20px; height: 20px; border-radius: 50%; color: var(--text-2); }
  .np-takes button:hover { background: var(--bg-3); color: var(--text-1); }
  .np-chips { display: flex; gap: 6px; min-width: 0; padding: 3px 2px; overflow-x: auto; scrollbar-width: thin; }
  .np-chip-slot { position: relative; flex: none; }
  .np-chip {
    position: relative;
    display: block;
    padding: 0;
    width: 58px;
    height: 40px;
    overflow: hidden;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-sm);
    background: var(--bg-3);
    cursor: grab;
  }
  .np-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .np-chip.drop { border-color: var(--accent); box-shadow: -3px 0 0 var(--accent); }
  .np-chip img { width: 100%; height: 100%; object-fit: cover; }
  .np-chip-none { display: grid; place-items: center; width: 100%; height: 100%; color: var(--text-3); }
  .np-chip-n {
    position: absolute;
    left: 2px;
    top: 2px;
    min-width: 15px;
    padding: 0 3px;
    border-radius: 2px;
    background: var(--accent);
    color: var(--accent-text);
    font-size: 10px;
    font-weight: 700;
    line-height: 15px;
    text-align: center;
  }
  .np-chip-x {
    position: absolute;
    right: 2px;
    top: 2px;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.7);
    color: #fff;
    opacity: 0;
  }
  .np-chip-slot:hover .np-chip-x, .np-chip-slot:focus-within .np-chip-x { opacity: 1; }
  .np-template { flex: none; display: flex; align-items: center; gap: 7px; color: var(--text-3); font-size: var(--fs-xs); font-weight: 600; }
  .np-template select { width: 170px; }
  .np-empty-btn { flex: none; }
  .np-create { flex: none; }
</style>
