<script>
  /**
   * What the scene being geolocated gathered, opened from the counts on its pill
   * (`components/GeolocatingPill.svelte`): its leads, the map captures attached to it,
   * and what its file gives it, the frames of the video's Inspect strip and its collages
   * inside the scene, or the picture itself (`GET /geolocating/gathered`).
   *
   * A frame never saved to the case is drawn from the video while the list is open, as
   * Make the proof draws it (`lib/unfiledFrames.js`), its dashed edge kept.
   *
   * A lead shows on the map and is deleted in one press: it is the scene's, nothing
   * else in the case reads it. A capture goes to the case Trash behind the dialog that
   * says what it touches. A frame leaves Inspect's strip, as Inspect's × does, its
   * picture staying in Media. A collage is deleted in Collage, and the picture is the
   * question itself: both only open. The extension's pill lists the same.
   */
  import { onDestroy, tick, untrack } from 'svelte';
  import ConfirmDialog from './ConfirmDialog.svelte';
  import Icon from './Icon.svelte';
  import MediaViewer from './MediaViewer.svelte';
  import { anchoredPanel } from '../lib/anchoredPanel.js';
  import { api } from '../lib/api.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import { GATHERED_HELP as HELP } from '../lib/geolocatingHelp.js';
  import { readGathered, readGeolocating, removeGatheredFrame, removeLead } from '../lib/geolocating.svelte.js';
  import { preciseClock } from '../lib/inspectPlayer.js';
  import { fmtCoords, toast, uiState } from '../lib/state.svelte.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import { frameDrawer } from '../lib/unfiledFrames.js';

  let {
    caseId,
    /** The scene held, as the pill holds it: its counts and leads say when to read again. */
    scene,
    /** The scene's colour, its leads drawn in it. */
    color,
    /** The element the list hangs under. */
    anchor,
    onclose = () => {},
  } = $props();

  let found = $state(null);
  let error = $state('');
  let asked = 0;

  async function read() {
    const mine = ++asked;
    try {
      const answer = await readGathered(caseId);
      if (mine === asked) {
        found = answer;
        error = '';
      }
    } catch (e) {
      if (mine === asked) error = e.message;
    }
  }

  // Read on opening, and again whenever what the pill counts moved: a capture filed, a
  // lead dropped from the map or the extension, a frame cut in Inspect.
  const key = $derived(
    scene
      ? [scene.id, scene.captures?.length ?? 0, scene.footage ?? 0, (scene.leads ?? []).map((p) => `${p.id}@${p.lat},${p.lon}`).join(';')].join('|')
      : '',
  );
  $effect(() => {
    void key;
    untrack(read);
  });

  const leads = $derived(found?.leads ?? []);
  const captures = $derived(found?.captures ?? []);
  const frames = $derived(found?.frames ?? []);
  const collages = $derived(found?.collages ?? []);
  const picture = $derived(found?.picture ?? null);
  const empty = $derived(found && !leads.length && !captures.length && !frames.length && !collages.length && !picture);

  const thumb = (row) => (row?.thumb ? fileUrl(caseId, row.thumb) : row?.path ? fileUrl(caseId, row.path) : '');
  // a picture that does not load shows the icon of its kind, not a broken image
  let unloaded = $state(new Set());
  const failed = (url) => (unloaded = new Set(unloaded).add(url));

  // The frames never saved, drawn from the video a few at a time while the list is open,
  // and let go when it closes; one that cannot be drawn keeps its dashed chip.
  const DRAWN_AT_MOST = 12;
  const drawer = frameDrawer();
  let drawn = $state([]); // `{ id, time, edits, url }`, a frame's picture once it came
  let drawnFor = '';
  let open = true;
  $effect(() => {
    const about = found?.geolocating;
    const unsaved = frames.filter((f) => !f.path);
    untrack(() => {
      if (!about?.video) return;
      // the answer is about another scene: what was drawn for the last one goes
      const owner = `${about.video}|${about.id}`;
      if (owner !== drawnFor) {
        drawer.drop();
        drawn = [];
        drawnFor = owner;
      }
      const fresh = unsaved
        .filter((f) => !drawn.some((one) => one.id === f.id))
        .slice(0, Math.max(0, DRAWN_AT_MOST - drawn.length))
        .map((f) => ({ id: f.id, time: f.time, edits: f.edits ?? {}, url: '' }));
      if (!fresh.length) return;
      drawn.push(...fresh);
      void drawer.draw(caseId, about.video, fresh, () => (open ? drawn : null), { limit: DRAWN_AT_MOST });
    });
  });
  onDestroy(() => {
    open = false;
    drawer.drop();
  });
  const drawnUrl = (id) => drawn.find((one) => one.id === id)?.url ?? '';

  // ← and → walk every picture the list shows, in its order.
  const shown = $derived([
    ...(picture ? [{ key: picture.path, path: picture.path, kind: 'image', name: picture.title }] : []),
    ...captures.map((c) => ({ key: c.path, path: c.path, kind: 'image', name: c.title })),
    ...frames.filter((f) => f.path).map((f) => ({ key: f.path, path: f.path, kind: 'image', name: preciseClock(f.time) })),
    ...collages.filter((c) => c.path).map((c) => ({ key: c.path, path: c.path, kind: 'image', name: c.title })),
  ]);
  let viewing = $state(null);

  function showLead(lead) {
    uiState.gotoCoords = { lat: lead.lat, lon: lead.lon, zoom: 17 };
    uiState.tool = 'satellite';
    onclose();
  }

  async function dropLead(lead) {
    try {
      await removeLead(caseId, lead.id);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  /** A frame never saved to the case opens where it lives: Inspect, on its scene. */
  function openInInspect() {
    if (!scene) return;
    uiState.inspectScene = { video: scene.video, draft: scene.id };
    uiState.tool = 'inspect';
    onclose();
  }

  function openCollage(collage) {
    if (collage.path) viewing = collage.path;
    else {
      uiState.openCollage = collage.name;
      uiState.tool = 'collage';
      onclose();
    }
  }

  // --- the two deletes behind a dialog ---
  let deleting = $state(null); // { kind: 'capture' | 'frame', row }
  let busy = $state(false);

  async function confirmDelete() {
    const target = deleting;
    if (!target || busy) return;
    busy = true;
    try {
      if (target.kind === 'capture') {
        const result = await api.del(`/api/cases/${caseId}/satellite?path=${encodeURIComponent(target.row.path)}`);
        deletedToast(caseId, result, target.row.title);
        await readGeolocating(caseId);
      } else {
        await removeGatheredFrame(caseId, target.row.id);
        toast(`Frame at ${preciseClock(target.row.time)} taken off the strip`, 'info', 3000);
      }
      deleting = null;
      await read();
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      busy = false;
    }
  }

  // Anywhere else closes it, as the menus of the bar do; a dialog or the viewer over it is its own.
  let panel = $state();
  $effect(() => {
    const onDown = (e) => {
      if (deleting || viewing) return;
      if (panel?.contains(e.target) || anchor?.contains(e.target)) return;
      onclose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !deleting && !viewing) onclose();
    };
    // from the next tick, so the press that opened it does not close it
    let on = true;
    tick().then(() => on && document.addEventListener('mousedown', onDown, true));
    window.addEventListener('keydown', onKey);
    return () => {
      on = false;
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  });
</script>

<div
  class="gathered card"
  popover="manual"
  bind:this={panel}
  use:anchoredPanel={{ anchor: () => anchor, width: 340 }}
  role="dialog"
  aria-label="What this scene gathered"
  data-testid="gathered-panel"
  style:--scene={color}
>
  {#if error}
    <p class="note">{error}</p>
  {:else if !found}
    <p class="note">Reading…</p>
  {:else if empty}
    <p class="note">Nothing gathered yet. Drop a lead or capture the map.</p>
  {:else}
    {#if leads.length}
      <section>
        <h4>Leads</h4>
        <ul class="rows">
          {#each leads as lead (lead.id)}
            <li class="row lead">
              <button class="main" onclick={() => showLead(lead)} title={HELP.showLead}>
                <span class="num" aria-hidden="true">{lead.n}</span>
                <span class="words mono">{fmtCoords(lead.lat, lead.lon)}</span>
              </button>
              <button class="act" onclick={() => dropLead(lead)} title={HELP.deleteLead} aria-label={`Delete lead ${lead.n}`}>
                <Icon name="x" size={12} />
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if picture}
      <section>
        <h4>Picture</h4>
        <ul class="tiles">
          <li class="tile">
            <button class="shot" onclick={() => (viewing = picture.path)} title={HELP.open}>
              {#if unloaded.has(thumb(picture))}<Icon name="image" size={16} />{:else}<img src={thumb(picture)} alt="" loading="lazy" onerror={() => failed(thumb(picture))} />{/if}
            </button>
            <span class="caption" dir="auto">{picture.title}</span>
          </li>
        </ul>
      </section>
    {/if}

    {#if captures.length}
      <section>
        <h4>Map captures</h4>
        <ul class="tiles">
          {#each captures as capture (capture.path)}
            <li class="tile">
              <button class="shot" onclick={() => (viewing = capture.path)} title={HELP.open}>
                {#if unloaded.has(thumb(capture))}<Icon name="image" size={16} />{:else}<img src={thumb(capture)} alt="" loading="lazy" onerror={() => failed(thumb(capture))} />{/if}
              </button>
              <span class="caption" dir="auto">{capture.title}</span>
              <button class="act corner" onclick={() => (deleting = { kind: 'capture', row: capture })} title={HELP.deleteCapture} aria-label={`Delete ${capture.title}`}>
                <Icon name="trash" size={12} />
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if frames.length}
      <section>
        <h4>Frames</h4>
        <ul class="tiles">
          {#each frames as frame (frame.id)}
            <li class="tile">
              {#if frame.path}
                <button class="shot" onclick={() => (viewing = frame.path)} title={HELP.open}>
                  {#if unloaded.has(thumb(frame))}<Icon name="image" size={16} />{:else}<img src={thumb(frame)} alt="" loading="lazy" onerror={() => failed(thumb(frame))} />{/if}
                </button>
              {:else}
                {@const url = drawnUrl(frame.id)}
                <button class="shot unsaved" onclick={openInInspect} title={HELP.unsavedFrame}>
                  {#if url && !unloaded.has(url)}<img src={url} alt="" onerror={() => failed(url)} />{:else}<Icon name="video" size={16} />{/if}
                </button>
              {/if}
              <span class="caption mono">{preciseClock(frame.time)}</span>
              <button class="act corner" onclick={() => (deleting = { kind: 'frame', row: frame })} title={HELP.removeFrame} aria-label={`Take the frame at ${preciseClock(frame.time)} off the strip`}>
                <Icon name="x" size={12} />
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if collages.length}
      <section>
        <h4>Collages</h4>
        <ul class="tiles">
          {#each collages as collage (collage.name)}
            <li class="tile">
              <button class="shot" class:unsaved={!collage.path} onclick={() => openCollage(collage)} title={collage.path ? HELP.open : HELP.openCollage}>
                {#if collage.path && !unloaded.has(thumb(collage))}<img src={thumb(collage)} alt="" loading="lazy" onerror={() => failed(thumb(collage))} />{:else}<Icon name="image" size={16} />{/if}
              </button>
              <span class="caption" dir="auto">{collage.title}</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</div>

{#if viewing}
  <MediaViewer {caseId} items={shown} current={viewing} onmove={(next) => (viewing = next)} onclose={() => (viewing = null)} />
{/if}

{#if deleting?.kind === 'capture'}
  <ConfirmDialog
    title="Delete this capture?"
    message={`“${deleting.row.title}” will be removed from the case.`}
    detail="Moves the capture and its image to the case trash."
    impact={{ caseId, paths: [deleting.row.path] }}
    restorable={RESTORABLE}
    confirmLabel="Delete"
    {busy}
    onconfirm={confirmDelete}
    oncancel={() => (deleting = null)}
  />
{:else if deleting?.kind === 'frame'}
  <ConfirmDialog
    title="Take this frame off the strip?"
    message={`The frame at ${preciseClock(deleting.row.time)} leaves Inspect's strip.`}
    detail={deleting.row.path ? 'Its picture saved to the case stays in Media.' : ''}
    confirmLabel="Remove"
    {busy}
    onconfirm={confirmDelete}
    oncancel={() => (deleting = null)}
  />
{/if}

<style>
  .gathered {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 10px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius, 8px);
    background: var(--bg-1);
    color: var(--text-1);
    font-size: var(--fs-xs);
    box-shadow: var(--shadow-lg, 0 8px 24px rgba(0, 0, 0, 0.3));
  }
  .note {
    margin: 4px 2px;
    color: var(--text-3);
  }
  section h4 {
    margin: 0 0 6px;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .row .main {
    flex: 1;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 26px;
    padding: 0 6px;
    border-radius: 6px;
    color: inherit;
    text-align: left;
  }
  .row .main:hover {
    background: var(--bg-2);
  }
  .num {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    display: inline-grid;
    place-items: center;
    border-radius: 50%;
    background: var(--scene);
    color: #fff;
    font-size: 11px;
    font-weight: 700;
  }
  .words {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .tile {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .shot {
    width: 100%;
    aspect-ratio: 4 / 3;
    display: grid;
    place-items: center;
    overflow: hidden;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg-3);
    color: var(--text-3);
  }
  .shot:hover {
    border-color: var(--accent);
  }
  .shot img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .shot.unsaved {
    border-style: dashed;
  }
  .caption {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
  }
  .act {
    flex-shrink: 0;
    width: 22px;
    height: 22px;
    display: inline-grid;
    place-items: center;
    border-radius: 6px;
    color: var(--text-3);
  }
  .act:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .act.corner {
    position: absolute;
    top: 3px;
    right: 3px;
    background: color-mix(in srgb, var(--bg-0) 80%, transparent);
    opacity: 0;
  }
  .tile:hover .act.corner,
  .act.corner:focus-visible {
    opacity: 1;
  }
</style>
