<script>
  import { onDestroy, untrack } from 'svelte';
  import { api } from '../../lib/api.js';
  import { onEvent } from '../../lib/events.js';
  import {
    geolocateScene, geolocating, markToGeolocate, restoreScene, stopGeolocating,
  } from '../../lib/geolocating.svelte.js';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import { sceneOfCollage } from '../../lib/sceneFrames.js';
  import { queueState } from '../../lib/sceneQueue.js';
  import { retimeScene } from '../../lib/sceneRetime.svelte.js';
  import {
    isWholeVideo, sceneList, sceneMoments, sceneTime, sceneTitle, shortClock, spanLabel, timeWords, timedBeside, wholeBarred,
  } from '../../lib/scenes.js';
  import { toast, uiState } from '../../lib/state.svelte.js';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import Icon from '../../components/Icon.svelte';
  import CollageMoment from './CollageMoment.svelte';

  // Mark to geolocate, in the Collage tool, under its save. A collage cut from one
  // video belongs to that video's scenes by its pieces' instants (`GET /scenes` lists
  // it among them): its press marks the whole video, and its arrow the stretch its
  // pieces span. One of several sources is a picture of its own, marked whole once
  // saved, and its mark follows the picture when it is saved again (`/inspect/compose`).
  // Marked, or already in a scene of its video, it says where the scene stands, with
  // Geolocate and Make the proof, as Inspect's Scenes tab does. A press on the scene's
  // time unfolds its editor with the video playing it (`CollageMoment`). A video is one
  // place or several: once scenes hold passages of it, the whole video is not offered,
  // and the press marks the stretch the pieces span. The scene's own time offers it only
  // as the video's one live scene still to prove (`wholeBarred`).
  //
  // `video` is `{ path, times }` when every piece comes from one video; `picture` the
  // collage's last saved picture and `current` that picture while it still reads as the
  // layout does. `save` files the picture as it stands and answers with its path;
  // `blocked` says why it cannot be.
  let { caseId, name = null, video = null, picture = null, current = null, blocked = '', save } = $props();

  // the file whose scenes the collage reads: its video, else its picture
  const file = $derived(video?.path ?? picture);
  let listing = $state(null); // { file, scenes, taken, collages, geolocating }
  let busy = $state(false);
  let menuOpen = $state(false);
  let arrow = $state(null);

  // the last read asked for answers, whichever lands first
  let reads = 0;
  async function read(path = file) {
    const run = ++reads;
    if (!caseId || !path) {
      listing = null;
      return;
    }
    try {
      const res = await api.get(`/api/cases/${caseId}/scenes?video=${encodeURIComponent(path)}`);
      const read = { file: path, scenes: res.scenes ?? [], taken: res.taken ?? [], collages: res.collages ?? [], geolocating: res.geolocating ?? null };
      if (run === reads) listing = read;
      return read;
    } catch {
      // the picture left the case, or cannot be read: there is nothing marked to say
      if (run === reads) listing = null;
      return null;
    }
  }

  // Read again when the file changes, when the collage is saved under a name, and on
  // coming back to the tool, where a scene may have been proved or abandoned meanwhile.
  $effect(() => {
    void file;
    void name;
    void current;
    if (uiState.tool !== 'collage') return;
    untrack(() => read());
  });
  onDestroy(onEvent('scenes', (event) => event.case_id === caseId && event.video === file && read()));
  onDestroy(onEvent('geolocating', (event) => event.case_id === caseId && event.video === file && read()));

  // the pieces' instants as the server reads them, which follows a frame saved from the video
  const times = $derived(listing?.collages?.find((c) => c.collage === name)?.times ?? video?.times ?? []);

  /** A reading of a file's scenes as Inspect lists them. */
  const listOf = (read) => sceneList(read.scenes, read.scenes.filter((s) => s.kind === 'draft'), read.taken);

  /** The scene the collage is in, by a reading of its file's scenes. */
  function sceneIn(read) {
    if (!read) return null;
    const rows = listOf(read);
    if (video) return sceneOfCollage(times, rows, null);
    return rows.find((s) => s.kind === 'proof') ?? rows.find((s) => s.kind === 'draft' && !s.abandoned) ?? null;
  }
  const scene = $derived(listing?.file === file ? sceneIn(listing) : null);
  // why the video's whole is not offered: scenes hold passages of it
  const wholeOff = $derived(video && listing?.file === file && timedBeside(listOf(listing)) ? INSPECT_HELP.markWholeTimed : '');
  const live = $derived(
    !!scene && scene.kind === 'draft'
      && (geolocating.caseId === caseId ? geolocating.scene?.id === scene.id && geolocating.scene?.video === file : listing?.geolocating === scene.id),
  );
  const liveScene = $derived(
    live && geolocating.scene?.id === scene?.id
      ? { ...scene, captures: geolocating.scene.captures ?? scene.captures, captureCount: geolocating.scene.captureCount }
      : scene,
  );

  const period = $derived(
    times.length ? (times[0] === times.at(-1) ? shortClock(times[0]) : spanLabel(times[0], times.at(-1))) : '',
  );
  // A scene still to prove of the collage's video says its time, which a press opens;
  // a proof, or a picture's scene, only says what it is.
  const timed = $derived(!!video && scene?.kind === 'draft');
  const where = $derived.by(() => {
    if (!scene) return '';
    if (!video) return 'Whole picture';
    if (scene.kind === 'proof') return sceneTitle(scene);
    if (isWholeVideo(scene)) return '';
    return scene.label || 'In scene';
  });

  // -- its time, changed here ---------------------------------------------------------
  let editing = $state(false);
  let editingKey = null;
  $effect(() => {
    const key = timed ? scene.key : null;
    if (key !== editingKey) {
      editingKey = key;
      editing = false;
    }
  });

  function applyTime(time) {
    const draft = scene;
    return act(async () => {
      const before = await retimeScene(caseId, video.path, draft.id, time);
      editing = false;
      await read();
      const undo = {
        label: 'Undo',
        onClick: () => act(async () => {
          await retimeScene(caseId, video.path, draft.id, before);
          await read();
        }),
      };
      toast(`Scene now ${timeWords(sceneMoments({ kind: 'draft', ...time }))}`, 'info', 6000, undo);
    });
  }

  /** The picture as the layout stands, saved first when it is not. */
  async function picturePath() {
    if (current) return current;
    if (blocked) throw new Error(blocked.replace(/\.$/, ''));
    return save();
  }

  async function act(run) {
    if (busy) return;
    busy = true;
    try {
      await run();
    } catch (e) {
      const said = String(e?.message || 'Could not mark it to geolocate');
      toast(said.charAt(0).toUpperCase() + said.slice(1), 'warn');
    } finally {
      busy = false;
    }
  }

  async function marked(row, path) {
    const back = row?.state === 'abandoned' ? await restoreScene(caseId, row.video, row.id) : row;
    await read(path);
    return back;
  }

  function markVideo(stretch = false) {
    menuOpen = false;
    return act(async () => {
      // saved first, so the proof and the map have its picture
      if (!current && !blocked) await save();
      const [start, end] = [times[0], times.at(-1)];
      const row = await markToGeolocate(caseId, video.path, '', stretch && times.length ? { start, end } : {});
      await marked(row, video.path);
    });
  }

  function markPicture() {
    return act(async () => {
      const path = await picturePath();
      const row = await markToGeolocate(caseId, path);
      await marked(row, path);
    });
  }

  /** A picture's scene on the picture as it stands: saved again, its mark follows. */
  async function settledScene() {
    if (video || current || blocked) return { held: scene, on: file };
    const path = await save();
    return { held: sceneIn(await read(path)), on: path };
  }

  function geolocate() {
    return act(async () => {
      if (live) {
        await stopGeolocating(caseId);
        return;
      }
      const { held, on } = await settledScene();
      if (!held) return;
      await geolocateScene(caseId, { ...held, video: on, file_kind: video ? 'video' : 'image' }, video ? { picture: current ?? picture } : {});
    });
  }

  function makeProof() {
    return act(async () => {
      if (scene?.kind === 'proof') {
        uiState.openProof = scene.proof;
        uiState.tool = 'proof';
        return;
      }
      const { held, on } = await settledScene();
      if (!held) return;
      // Inspect's own Make the proof, on the scene: frames, collages and captures together
      uiState.inspectScene = { video: on, draft: held.id, proof: true };
      uiState.tool = 'inspect';
    });
  }
</script>

<div class="scene-slot">
  {#if !scene}
    {#if video}
      <div class="split" role="group" aria-label="Mark to geolocate">
        <button
          class="btn btn-sm press"
          disabled={busy || !file || (Boolean(wholeOff) && !times.length)}
          onclick={() => markVideo(Boolean(wholeOff))}
          title={wholeOff ? INSPECT_HELP.collageMarkPeriod : INSPECT_HELP.collageMarkVideo}
        >
          <Icon name="pin" size={13} />
          <span>Mark to geolocate</span>
        </button>
        <button
          class="btn btn-sm more"
          bind:this={arrow}
          disabled={busy}
          onclick={() => (menuOpen = !menuOpen)}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="More ways to mark"
          title={INSPECT_HELP.collageMarkMenu}
        >
          <Icon name="chevronDown" size={13} />
        </button>
      </div>
    {:else}
      <button
        class="btn btn-sm press alone"
        disabled={busy || (!current && !!blocked)}
        onclick={markPicture}
        title={!current && blocked ? blocked : INSPECT_HELP.collageMarkPicture}
      >
        <Icon name="pin" size={13} />
        <span>Mark to geolocate</span>
      </button>
    {/if}
  {:else}
    <div class="state" style:--scene={scene.color}>
      <span class="swatch" aria-hidden="true"></span>
      {#if where}<span class="where" dir="auto" title={where}>{where}</span>{/if}
      {#if timed}
        {#if where}<span class="sep" aria-hidden="true">·</span>{/if}
        <button
          class="time"
          class:whole={isWholeVideo(scene)}
          class:on={editing}
          aria-expanded={editing}
          aria-label={`Time of the scene, ${sceneTime(scene)}`}
          onclick={() => (editing = !editing)}
          title={INSPECT_HELP.collageTime}
        >{sceneTime(scene)}</button>
      {/if}
      {#if scene.kind === 'proof'}
        <span class="proved"><Icon name="check" size={11} /> Proved</span>
      {:else}
        <span class="standing" class:going={live} data-testid="collage-scene-state">{queueState(liveScene, live)}</span>
      {/if}
    </div>
    {#if editing && timed}
      <CollageMoment
        {caseId}
        video={video.path}
        {scene}
        wholeOff={{ whole: INSPECT_HELP.sceneWholeTaken, timed: INSPECT_HELP.sceneWholeTimed }[wholeBarred(listOf(listing), scene)] ?? ''}
        {times}
        {busy}
        onapply={applyTime}
        oncancel={() => (editing = false)}
      />
    {/if}
    <div class="acts">
      {#if scene.kind === 'proof'}
        <button class="btn btn-sm" disabled={busy} onclick={makeProof} title={INSPECT_HELP.sceneProof}>
          <Icon name="proof" size={12} /> Open the proof
        </button>
      {:else}
        <button
          class="btn btn-sm locate"
          class:on={live}
          aria-pressed={live}
          disabled={busy}
          onclick={geolocate}
          title={live ? INSPECT_HELP.sceneStopGeolocating : video ? INSPECT_HELP.collageGeolocate : INSPECT_HELP.pictureGeolocate}
        >
          <Icon name="crosshair" size={12} /> {live ? 'Stop' : 'Geolocate'}
        </button>
        <button class="btn btn-sm" disabled={busy} onclick={makeProof} title={video ? INSPECT_HELP.collageMakeProof : INSPECT_HELP.pictureMakeProof}>
          <Icon name="proof" size={12} /> Make the proof
        </button>
      {/if}
    </div>
  {/if}
</div>

{#if menuOpen}
  <FloatingMenu anchor={arrow} width={240} align="end" label="Mark to geolocate" onclose={() => (menuOpen = false)}>
    <button class="fm-item" role="menuitem" disabled={Boolean(wholeOff)} onclick={() => markVideo(false)} title={wholeOff || INSPECT_HELP.collageMarkVideo}>
      <Icon name="video" size={13} />
      <span class="fm-grow">Whole video</span>
    </button>
    <button class="fm-item" role="menuitem" disabled={!times.length} onclick={() => markVideo(true)} title={INSPECT_HELP.collageMarkPeriod}>
      <Icon name="clock" size={13} />
      <span class="fm-grow">{times.length > 1 && times[0] !== times.at(-1) ? 'Its stretch' : 'Its instant'}</span>
      <span class="when">{period}</span>
    </button>
  </FloatingMenu>
{/if}

<style>
  .scene-slot {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .split {
    display: flex;
  }
  .press {
    flex: 1;
    min-width: 0;
    justify-content: center;
    gap: 6px;
    padding-top: 5px;
    padding-bottom: 5px;
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }
  .press.alone {
    border-radius: var(--r-sm);
  }
  .press :global(svg) {
    color: var(--accent);
  }
  .press:disabled :global(svg) {
    color: inherit;
  }
  .more {
    flex: 0 0 30px;
    justify-content: center;
    padding-left: 0;
    padding-right: 0;
    margin-left: -1px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }
  .more[aria-expanded='true'] {
    color: var(--accent);
  }
  .when {
    flex: none;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .state {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    font-size: var(--fs-xs);
  }
  .swatch {
    flex: none;
    width: 4px;
    height: 16px;
    border-radius: 2px;
    background: var(--scene, var(--accent));
  }
  .where {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-1);
    font-weight: 600;
  }
  .sep {
    flex: none;
    color: var(--text-3);
  }
  /* The scene's time, which a press opens: dotted, as Geo Proof's is. */
  .time {
    flex: none;
    padding: 1px 4px;
    margin: -1px 0;
    border-radius: var(--r-sm);
    color: var(--text-1);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 600;
    text-decoration: underline dotted var(--text-3);
    text-underline-offset: 3px;
  }
  .time.whole {
    font-family: inherit;
  }
  .time:hover,
  .time.on {
    background: var(--bg-3);
  }
  .time.on {
    text-decoration: none;
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .standing,
  .proved {
    flex: none;
    margin-left: auto;
    color: var(--text-3);
    white-space: nowrap;
  }
  .standing.going {
    color: var(--accent);
  }
  .proved {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--ok);
  }
  .acts {
    display: flex;
    gap: 6px;
  }
  .acts .btn {
    flex: 1;
    justify-content: center;
  }
  .locate :global(svg) {
    color: var(--accent);
  }
  .locate.on {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
