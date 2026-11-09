<script>
  import { untrack } from 'svelte';
  import SceneTimeEditor from '../../components/SceneTimeEditor.svelte';
  import ScenePlayer from '../proof/ScenePlayer.svelte';
  import { SceneEdit } from '../../lib/sceneEdit.svelte.js';
  import { frameInMoment } from '../../lib/sceneFrames.js';
  import { frameDuration } from '../../lib/inspectPlayer.js';
  import { COLLAGE_TIME_TIPS, INSPECT_HELP } from '../../lib/inspectHelp.js';
  import { PROOF_SCENE_HELP, PROOF_TIME_HELP } from '../../lib/proofSceneHelp.js';

  // The moment a collage of one video was marked over, opened under its scene's line
  // for a change: the video in Geo Proof's small player, looping the moment as the
  // fields read it, its pieces' frames as dots on the bar, and Inspect's time editor
  // beneath (`components/SceneTimeEditor`). Nothing is kept until Apply, which the
  // scene's line writes as Inspect would (`lib/sceneRetime.svelte.js`).
  // `wholeOff` says why the whole video is not offered (`components/SceneTimeEditor`).
  let { caseId, video, scene, times = [], busy = false, wholeOff = '', onapply, oncancel } = $props();

  let clip = $state({ duration: 0, fps: null });
  const edit = new SceneEdit(() => clip);
  untrack(() => edit.begin(scene));
  let player = $state(null);

  const help = { ...PROOF_SCENE_HELP, panelFrame: INSPECT_HELP.collagePieceFrame };
  // the moment as its fields read it, drawn and played before Apply
  const moments = $derived(
    edit.moments.filter((m) => m.start != null).map((m) => ({ start: m.start, end: m.passage ? m.end : null })),
  );
  const frames = $derived(times.map((time, i) => ({ panel: `piece-${i}`, time })));
  const first = $derived(times.length ? Math.min(...times) : 0);
  // it opens playing the moment over and over, unless the system asks for less motion
  const request = { play: true, n: 1 };
  // a time holding none of the pieces takes the collage out of the scene: said, not refused
  const outside = $derived.by(() => {
    if (edit.whole || !times.length || edit.problem) return false;
    const frame = frameDuration(clip.fps);
    return !times.some((t) => moments.some((m) => frameInMoment(t, m, frame)));
  });

  const frameNow = () => player?.frameNow() ?? { start: 0, end: 0 };

  function nudge(which, direction, wholeSecond, index) {
    const shown = edit.nudge(which, direction, wholeSecond, index);
    if (shown != null) player?.show(shown);
  }

  function apply() {
    if (busy || edit.problem || !edit.result) return;
    if (edit.changed) onapply?.(edit.result);
    else oncancel?.();
  }
</script>

<div class="moment-edit" data-testid="collage-moment">
  <ScenePlayer
    bind:this={player}
    {caseId}
    {video}
    {moments}
    color={scene.color}
    {frames}
    from={first}
    {request}
    {help}
    onclip={(info) => (clip = info)}
  />
  <SceneTimeEditor
    {edit}
    help={PROOF_TIME_HELP}
    tips={COLLAGE_TIME_TIPS}
    {wholeOff}
    onhere={(which, i) => edit.here(which, frameNow(), i)}
    onkind={(kind) => edit.setKind(kind, frameNow())}
    onnudge={nudge}
    onapply={apply}
    oncancel={() => oncancel?.()}
  />
  {#if outside}
    <p class="outside" role="status">No piece of the collage is in this time, so it leaves the scene.</p>
  {/if}
</div>

<style>
  .moment-edit {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 9px 9px 8px;
    border: 1px solid var(--border);
    border-left: 2px solid var(--scene, var(--accent));
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--bg-0) 40%, var(--bg-1));
  }
  .outside {
    margin: 0;
    color: var(--warn);
    font-size: 11px;
    line-height: 1.35;
  }
</style>
