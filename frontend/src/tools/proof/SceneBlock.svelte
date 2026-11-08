<script>
  import { untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import SceneTimeEditor from '../../components/SceneTimeEditor.svelte';
  import ScenePlayer from './ScenePlayer.svelte';
  import { sceneTime } from '../../lib/scenes.js';
  import { PROOF_SCENE_HELP as HELP, PROOF_TIME_HELP, PROOF_TIME_TIPS } from '../../lib/proofSceneHelp.js';

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
  // What the bar draws: the moments as the editor reads them while it is open, so a
  // time typed or taken shows before Apply, else as the proof states them.
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
      {outside.length === 1 ? '1 panel is' : `${outside.length} panels are`} outside these moments.
      <button class="link" onclick={() => scene.addInstants(outside.map((f) => f.time))} title={HELP.addMoment}>
        {outside.length === 1 ? 'Add its moment' : 'Add their moments'}
      </button>
    </p>
  {/if}

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
          onaddmoment={() => scene.edit.add(frameNow().start)}
          onapply={() => scene.applyTime()}
          oncancel={() => scene.edit.close()}
        />
      {/if}
    </div>
  {/if}
</div>

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
  .under {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
  }
</style>
