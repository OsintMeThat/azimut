<script>
  import { untrack } from 'svelte';
  import ConfirmDialog from '../../components/ConfirmDialog.svelte';
  import Icon from '../../components/Icon.svelte';
  import SceneTimeEditor from '../../components/SceneTimeEditor.svelte';
  import ScenePlayer from './ScenePlayer.svelte';
  import { api } from '../../lib/api.js';
  import { onEvent } from '../../lib/events.js';
  import { clipWords, cuttable } from '../../lib/postClip.js';
  import { sceneTime, spanLabel } from '../../lib/scenes.js';
  import { applyPrefs, prefs, toast, uiState } from '../../lib/state.svelte.js';
  import { RESTORABLE, deletedToast } from '../../lib/trash.js';
  import { PROOF_SCENE_HELP as HELP, PROOF_TIME_HELP, PROOF_TIME_TIPS } from '../../lib/proofSceneHelp.js';
  import { SceneClip } from './sceneClip.svelte.js';

  // Where in its video the proof happens: the Scene tab of the side column. It is
  // there only for a proof built on a video, either through a panel Inspect cut from
  // one or through a time the proof states; any other proof reads as it always did.
  //
  // One field per video, like a source: the ★ video with its time, which opens the
  // time editor Inspect uses (`components/SceneTimeEditor`), and any other video as a
  // confirmation, ☆, made the ★ in one press. The player under the fields has the tab
  // to itself (`ScenePlayer`): it opens on the ★ video with the tab, the play act at
  // the end of a field runs that video in it, Here reads its frame and a frame becomes
  // a panel. What is stated goes through `proofScene.svelte.js`.
  //
  // `active` is whether the tab is shown. A hidden tab keeps its player where it
  // stood, paused, so coming back finds the same frame.
  //
  // **Cut for the post** sits on one quiet line under the fields, for a saved proof that
  // states a passage: it cuts that passage into a video of its own in Media, which the
  // proof's scene keeps for its post (`sceneClip.svelte.js`). The line then says the
  // clip's length and size, its passage too when the proof states several, with Show in
  // Media and Remove, the case trash's road. One clip a proof: another passage is cut
  // once this one is removed.
  //
  // **▶ on video panels**, under the fields, hides the ▶ the canvas draws in the corner of
  // each panel cut from a video, which covers the picture while composing. It is the
  // analyst's way of working, kept in settings.json for every proof (`prefs.proofScenePlays`);
  // the panel's frame is still a press away here, on the player's dots.
  let { scene, caseId, color = 'var(--accent)', active = true, onaddframe } = $props();

  let player = $state(null);

  const view = $derived(scene.view);
  const star = $derived(scene.star);
  const editing = $derived(!!scene.edit.scene);
  const time = $derived(sceneTime({ kind: 'proof', moments: scene.moments }));
  const outside = $derived(scene.outside);
  const shownFrames = $derived(
    view ? scene.frames().filter((f) => f.video === view.video).map((f) => ({ panel: f.panel, time: f.time })) : [],
  );
  const firstFrame = $derived(shownFrames.length ? Math.min(...shownFrames.map((f) => f.time)) : 0);
  // What the bar draws: the passages as the editor reads them while it is open, so a
  // time typed or taken shows before Apply, else as the proof states them. Another
  // passage adds one of the scene's kind from the frame on the player, taken in hand.
  const barMoments = $derived.by(() => {
    if (view?.video !== star) return [];
    if (!editing) return scene.moments.map((m, i) => ({ start: m.start, end: m.end, i }));
    return scene.edit.moments
      .map((m, i) => ({ start: m.start, end: m.passage ? m.end : null, i }))
      .filter((m) => m.start != null);
  });
  const barHeld = $derived(
    editing && scene.edit.moments.length > 1 ? barMoments.findIndex((m) => m.i === scene.edit.active) : -1,
  );

  // The tab is the player's: it shows the ★ video as soon as the tab is shown, paused
  // where the scene starts, and again when the video it showed left the proof.
  $effect(() => {
    if (!active) return;
    const videos = scene.videos.map((v) => v.video);
    const shown = scene.view?.video;
    if (videos.length && !videos.includes(shown)) untrack(() => scene.show(scene.star));
  });

  /** A field's play act: its video in the player, running through the scene. */
  function play(v) {
    if (!v.star) scene.leaveTime();
    scene.show(v.video, { play: true });
  }

  function toggleTime() {
    if (editing) scene.leaveTime();
    else scene.openTime();
  }

  const frameNow = () => player?.frameNow() ?? { start: 0, end: 0 };

  function nudge(which, direction, wholeSecond, index) {
    const shown = scene.edit.nudge(which, direction, wholeSecond, index);
    if (shown != null) player?.show(shown);
  }

  // -- the clip for the post ------------------------------------------------------------
  const clips = new SceneClip({ api });
  const named = $derived(scene.where().name ?? null);
  // the stretches the proof states, while its time is not being changed: never an
  // instant, and never the time of a scene its frames found, which is not stated yet
  const passages = $derived(editing || scene.match ? [] : scene.moments.filter(cuttable));
  const clip = $derived(clips.clip);
  // the clip's passage goes without saying when it is the proof's one passage
  const clipPassage = $derived(
    !!clip && !(passages.length === 1 && Math.abs(passages[0].start - clip.start) < 1e-3 && Math.abs(passages[0].end - clip.end) < 1e-3),
  );
  const cutting = $derived(clips.cutting);
  let removing = $state(null);
  let removeBusy = $state(false);

  $effect(() => {
    if (!active) return;
    const id = caseId, name = named;
    untrack(() => clips.read(id, name));
  });
  // a clip taken back from the trash, or cut from another tab
  $effect(() => {
    const again = (event) => {
      if (active && named && event.case_id === caseId) clips.read(caseId, named);
    };
    const offSaved = onEvent('saved', again);
    const offScenes = onEvent('scenes', again);
    return () => {
      offSaved();
      offScenes();
    };
  });

  // -- the ▶ on the canvas --------------------------------------------------------------
  async function showPlays(on) {
    if (on === prefs.proofScenePlays) return;
    prefs.proofScenePlays = on; // the box answers the click, not the round trip
    try {
      applyPrefs(await api.put('/api/settings/prefs', { proof_scene_plays: on }));
    } catch {
      toast('That box could not be saved, so it lasts this session only', 'warn');
    }
  }

  function showInMedia() {
    if (!clip) return;
    uiState.focusMedia = clip.path;
    uiState.tool = 'media';
  }

  async function removeClip() {
    const target = removing;
    if (!target || removeBusy) return;
    removeBusy = true;
    try {
      const result = await api.del(`/api/cases/${caseId}/media?path=${encodeURIComponent(target.path)}`);
      clips.removed();
      removing = null;
      deletedToast(caseId, result, target.title ?? target.path);
    } catch (e) {
      clips.error = e.message;
      removing = null;
    } finally {
      removeBusy = false;
    }
  }
</script>

<div class="scene-block" style:--scene={color} data-testid="scene-block">
  <div class="meta-head">
    <Icon name="video" size={13} />
    <span>{scene.videos.length > 1 ? 'Videos' : 'Video'}</span>
  </div>
  {#each scene.videos as v (v.video)}
    {@const open = view?.video === v.video}
    <div class="field-with-act video-field" class:star={v.star} data-testid="scene-video">
      <span class="line">
        {#if v.star}
          <span class="mark on" title={HELP.star} role="img" aria-label="The proof's video">★</span>
        {:else}
          <button class="mark" onclick={() => scene.makeStar(v.video)} title={HELP.makeStar} aria-label={`Make ${v.name} the proof's video`}>☆</button>
        {/if}
        <span class="name" dir="auto" title={v.video}>{v.name}</span>
        <span class="sep" aria-hidden="true">·</span>
        {#if v.star}
          <button
            class="time"
            class:whole={!scene.moments.length}
            class:on={editing}
            onclick={toggleTime}
            title={HELP.time}
            aria-expanded={editing}
            aria-label={`Time of the scene, ${time}`}
          >{time}</button>
        {:else}
          <span class="confirm">confirmation</span>
        {/if}
      </span>
      <button
        class="field-act"
        class:on={open}
        onclick={() => play(v)}
        title={HELP.show}
        aria-label={`Play ${v.name}`}
      >
        <Icon name="play" size={12} />
      </button>
    </div>
    {#if v.star && scene.match}
      <!-- The scene still to prove its frames found, taken up at the next save. -->
      {@const found = scene.match}
      <p class="matched" role="status" data-testid="scene-match" title={found.whole ? HELP.onlyScene : HELP.matched}>
        <span class="swatch" style:background={found.color} aria-hidden="true"></span>
        <span class="found" dir="auto">{found.title}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span class="why">{found.whole ? 'the video\'s only scene' : 'found by its frames'}</span>
        <button class="link refuse" onclick={() => scene.refuse()} title={HELP.notThisScene}>Not this scene</button>
      </p>
    {/if}
  {/each}

  {#if outside.length}
    <p class="outside" role="status">
      {outside.length === 1 ? '1 panel is' : `${outside.length} panels are`} outside these passages.
      <button class="link" onclick={() => scene.addInstants(outside.map((f) => f.time))} title={HELP.addMoment}>
        {outside.length === 1 ? 'Add its passage' : 'Add their passages'}
      </button>
    </p>
  {/if}

  {#if named && (clip || cutting || passages.length)}
    <!-- Cut for the post: one quiet line, the clip once cut. -->
    <div class="post-clip" data-testid="scene-clip">
      <Icon name="scissors" size={12} />
      {#if cutting}
        <span class="clip-what" role="status">Cutting {spanLabel(cutting.start, cutting.end)}… {Math.round(cutting.percent)}%</span>
        <span class="clip-bar" aria-hidden="true"><span style:width={`${Math.round(cutting.percent)}%`}></span></span>
      {:else if clip}
        <span class="clip-what" title={clip.title}>Clip · {clipWords(clip, { passage: clipPassage })}</span>
        <button class="link" onclick={showInMedia} title={HELP.clipShow}>Show in Media</button>
        <button class="link" onclick={() => (removing = clip)} title={HELP.clipRemove}>Remove</button>
      {:else if passages.length === 1}
        <button class="link" onclick={() => clips.cut(caseId, named, passages[0])} title={HELP.cut}>Cut for the post</button>
      {:else}
        <span class="clip-what">Cut for the post</span>
        {#each passages as m (m.start)}
          <button class="link time-pick" onclick={() => clips.cut(caseId, named, m)} title={HELP.cut}>{spanLabel(m.start, m.end)}</button>
        {/each}
      {/if}
    </div>
    {#if clips.error}
      <p class="clip-error" role="alert">{clips.error}</p>
    {/if}
  {/if}

  <label class="plays" title={HELP.plays}>
    <input type="checkbox" checked={prefs.proofScenePlays} onchange={(e) => showPlays(e.currentTarget.checked)} />
    <span>▶ on video panels</span>
  </label>

  {#if view}
    <div class="under">
      {#key view.video}
        <ScenePlayer
          bind:this={player}
          {caseId}
          video={view.video}
          moments={barMoments}
          held={barHeld}
          {color}
          frames={shownFrames}
          from={firstFrame}
          request={view}
          {active}
          adding={scene.adding}
          onclip={(clip) => (scene.clip = clip)}
          {onaddframe}
        />
      {/key}
      {#if editing && view.video === star}
        <SceneTimeEditor
          edit={scene.edit}
          help={PROOF_TIME_HELP}
          tips={PROOF_TIME_TIPS}
          onhere={(which, i) => scene.edit.here(which, frameNow(), i)}
          onkind={(kind) => scene.edit.setKind(kind, frameNow())}
          onnudge={nudge}
          onaddmoment={() => scene.edit.another(frameNow())}
          onapply={() => scene.applyTime()}
          oncancel={() => scene.edit.close()}
        />
      {/if}
    </div>
  {/if}
</div>

{#if removing}
  <ConfirmDialog
    title="Remove the clip?"
    message={`“${removing.title ?? removing.path}” leaves Media and the proof's scene.`}
    detail="Moves the clip to the case trash. The video it was cut from stays."
    impact={{ caseId, paths: [removing.path] }}
    restorable={RESTORABLE}
    confirmLabel="Remove"
    tone="default"
    busy={removeBusy}
    onconfirm={removeClip}
    oncancel={() => (removing = null)}
  />
{/if}

<style>
  .meta-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 5px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-2);
  }
  .video-field + .video-field {
    margin-top: 4px;
  }
  /* The field's words, laid out like the text of the boxes around it. */
  .line {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 8px 4px 6px;
    font-size: var(--fs-xs);
    color: var(--text-1);
  }
  .mark {
    flex-shrink: 0;
    width: 16px;
    text-align: center;
    color: var(--text-3);
    font-size: 13px;
    line-height: 1;
  }
  .mark.on {
    color: var(--accent);
  }
  button.mark:hover {
    color: var(--accent);
  }
  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .video-field:not(.star) .name {
    color: var(--text-2);
  }
  .sep {
    flex-shrink: 0;
    color: var(--text-3);
  }
  /* two moments read whole beside the file's name, which gives way first */
  .time {
    flex-shrink: 0;
    max-width: 70%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 1px 4px;
    margin: -1px 0;
    border-radius: var(--r-sm);
    color: var(--text-1);
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    text-decoration: underline dotted var(--text-3);
    text-underline-offset: 3px;
  }
  .time.whole {
    font-family: inherit;
    color: var(--text-2);
  }
  .time:hover,
  .time.on {
    background: var(--bg-3);
  }
  .time.on {
    text-decoration: none;
    box-shadow: inset 0 0 0 1px var(--accent);
  }
  .confirm {
    flex-shrink: 0;
    color: var(--text-3);
  }
  /* Under the ★ field, in the scene's colour: what the frames found, and the way out. */
  .matched {
    display: flex;
    align-items: center;
    gap: 5px;
    margin: 4px 0 0;
    padding: 0 0 0 8px;
    font-size: var(--fs-xs);
    line-height: 1.4;
    color: var(--text-2);
  }
  .swatch {
    flex-shrink: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .found {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-1);
  }
  .why {
    flex-shrink: 0;
    white-space: nowrap;
  }
  .refuse {
    flex-shrink: 0;
    margin-left: auto;
    white-space: nowrap;
  }
  .outside {
    margin: 5px 0 0;
    font-size: var(--fs-xs);
    line-height: 1.4;
    color: var(--warn, #e8a33d);
  }
  .link {
    color: var(--text-1);
    font: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .link:hover {
    color: var(--accent);
  }
  /* Cut for the post: as quiet as the line under a field. */
  .post-clip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    margin: 6px 0 0;
    padding: 0 0 0 8px;
    font-size: var(--fs-xs);
    line-height: 1.4;
    color: var(--text-2);
  }
  .post-clip :global(svg) {
    flex-shrink: 0;
    color: var(--text-3);
  }
  .clip-what {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  .time-pick {
    font-family: var(--font-mono);
  }
  .clip-bar {
    flex: 1 1 60px;
    max-width: 120px;
    height: 3px;
    border-radius: 2px;
    background: var(--bg-3);
    overflow: hidden;
  }
  .clip-bar span {
    display: block;
    height: 100%;
    background: var(--accent);
    transition: width 0.3s ease;
  }
  .clip-error {
    margin: 4px 0 0;
    padding: 0 0 0 8px;
    font-size: var(--fs-xs);
    line-height: 1.4;
    color: var(--danger, #e5534b);
  }
  /* a quiet line of its own, like Cut for the post */
  .plays {
    display: flex;
    align-items: center;
    gap: 7px;
    margin: 8px 0 0;
    padding: 0 0 0 8px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    cursor: pointer;
  }
  .plays input {
    margin: 0;
    accent-color: var(--accent);
  }
  .under {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
  }
</style>
