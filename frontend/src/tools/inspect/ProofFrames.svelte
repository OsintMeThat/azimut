<script>
  import Icon from '../../components/Icon.svelte';
  import Modal from '../../components/Modal.svelte';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import { cropImgStyle, previewStyle, styleText } from '../../lib/inspect.js';
  import { editClock, isWholeVideo, sceneTime, sceneTitle, shortClock } from '../../lib/scenes.js';

  // Make the proof, the step before Geo Proof: the frames of the scene, all ticked,
  // to start the proof from (`lib/sceneFrames.js`), then the captures it gathered on
  // the map while it was geolocated, ticked too. A scene holding no frame says which
  // frame is captured for it instead, since a proof of the scene rests on one of its
  // frames. Frames not in the case yet are saved on the way, which the note under
  // them says.
  let {
    scene,
    frames = [],
    // `{ path, url, title }`, in the order they were attached
    captures = [],
    filters = [],
    filedIds = new Set(),
    capture = null,
    busy = false,
    onconfirm,
    oncancel,
  } = $props();

  // seeded once from the frames and captures it opened on, all ticked
  // svelte-ignore state_referenced_locally
  let picked = $state(new Set(frames.map((f) => f.id)));
  // svelte-ignore state_referenced_locally
  let pickedCaptures = $state(new Set(captures.map((c) => c.path)));

  const allPicked = $derived(frames.length > 0 && frames.every((f) => picked.has(f.id)));
  const unsaved = $derived(frames.filter((f) => picked.has(f.id) && !filedIds.has(f.id)).length);
  const ready = $derived(!busy && (!frames.length || picked.size > 0));
  // An unnamed scene is told by its time, which then needs no second mention.
  const named = $derived(scene.kind === 'proof' || Boolean(scene.label));

  function toggle(id) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    picked = next;
  }

  function toggleCapture(path) {
    const next = new Set(pickedCaptures);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    pickedCaptures = next;
  }

  function toggleAll() {
    picked = allPicked ? new Set() : new Set(frames.map((f) => f.id));
  }

  /** What is captured for a scene that holds no frame. */
  function captureWords({ time, why }) {
    const at = shortClock(time);
    if (why === 'sharpest') return `Captures and saves the sharpest frame of the scene, at ${at}`;
    if (why === 'start') return `Captures and saves the frame the scene starts on, at ${at}`;
    if (why === 'screen') return `Captures and saves the frame on screen, at ${at}`;
    return `Captures and saves the frame at ${at}`;
  }

  function make() {
    if (!ready) return;
    onconfirm?.(
      frames.filter((f) => picked.has(f.id)).map((f) => f.id),
      captures.filter((c) => pickedCaptures.has(c.path)).map((c) => c.path),
    );
  }
</script>

<Modal title="Make the proof" width="480px" onclose={() => !busy && oncancel?.()}>
  <div class="make-proof">
    <p class="scene-line" style:--scene={scene.color}>
      <span class="swatch" aria-hidden="true"></span>
      {#if named}
        <span class="what" dir="auto">{sceneTitle(scene)}</span>
        <span class="when" class:mono={!isWholeVideo(scene)}>{sceneTime(scene)}</span>
      {:else}
        <span class="what" class:mono={!isWholeVideo(scene)}>{sceneTime(scene)}</span>
      {/if}
    </p>

    {#if frames.length}
      <div class="row-head">
        <span>{picked.size} of {frames.length} {frames.length === 1 ? 'frame' : 'frames'} in the proof</span>
        {#if frames.length > 3}
          <button class="btn btn-ghost btn-xs" onclick={toggleAll} title={INSPECT_HELP.proofFramesAll}>{allPicked ? 'Untick all' : 'Tick all'}</button>
        {/if}
      </div>
      <ul class="frames" aria-label="Frames of the scene">
        {#each frames as fr (fr.id)}
          {@const look = previewStyle(filters, fr.adjust)}
          <li>
            <label class="frame" class:off={!picked.has(fr.id)}>
              <input type="checkbox" checked={picked.has(fr.id)} onchange={() => toggle(fr.id)} aria-label={`Frame at ${editClock(fr.time)}`} />
              <span class="thumb">
                <img src={fr.url} alt="" style={styleText(cropImgStyle(fr.crop))} style:filter={look.filter} />
                {#if !filedIds.has(fr.id)}
                  <span class="unsaved" title={INSPECT_HELP.proofFrameUnsaved}>Not in the case</span>
                {/if}
              </span>
              <span class="at mono">{editClock(fr.time)}</span>
            </label>
          </li>
        {/each}
      </ul>
      {#if unsaved}
        <p class="note">{unsaved === 1 ? 'Saves 1 frame to the case on the way.' : `Saves ${unsaved} frames to the case on the way.`}</p>
      {/if}
    {:else if capture}
      <div class="none">
        <Icon name="camera" size={16} />
        <p><strong>No frame in this scene yet.</strong> {captureWords(capture)}.</p>
      </div>
    {/if}

    {#if captures.length}
      <div class="row-head" title={INSPECT_HELP.proofCaptures}>
        <span>{pickedCaptures.size} of {captures.length} {captures.length === 1 ? 'capture' : 'captures'} from the map</span>
      </div>
      <ul class="frames" aria-label="Captures of the scene">
        {#each captures as cap (cap.path)}
          <li>
            <label class="frame" class:off={!pickedCaptures.has(cap.path)}>
              <input type="checkbox" checked={pickedCaptures.has(cap.path)} onchange={() => toggleCapture(cap.path)} aria-label={`Capture ${cap.title}`} />
              <span class="thumb"><img src={cap.url} alt="" /></span>
              <span class="at" dir="auto" title={cap.title}>{cap.title}</span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="acts">
      <button class="btn btn-ghost btn-sm" disabled={busy} onclick={() => oncancel?.()}>Cancel</button>
      <button class="btn btn-primary btn-sm" disabled={!ready} onclick={make} title={INSPECT_HELP.proofFramesMake}>
        {busy ? 'Making…' : 'Make the proof'}
      </button>
    </div>
  </div>
</Modal>

<style>
  .make-proof {
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-size: var(--fs-sm);
  }
  .scene-line {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0;
    min-width: 0;
  }
  .swatch {
    flex-shrink: 0;
    width: 4px;
    height: 18px;
    border-radius: 2px;
    background: var(--scene, var(--accent));
  }
  .what {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    color: var(--text-1);
  }
  .when {
    flex-shrink: 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .row-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .frames {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 8px;
    max-height: 300px;
    margin: 0;
    padding: 2px;
    overflow-y: auto;
    list-style: none;
  }
  .frame {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 3px;
    cursor: pointer;
  }
  .frame input {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 1;
    margin: 0;
    accent-color: var(--accent);
  }
  .thumb {
    position: relative;
    display: block;
    aspect-ratio: 3 / 2;
    overflow: hidden;
    border: 2px solid var(--accent);
    border-radius: var(--r-sm);
    background: var(--bg-0);
  }
  .thumb img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .frame.off .thumb {
    border-color: var(--border);
    opacity: 0.5;
  }
  .at {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
    font-size: 10px;
  }
  /* over the picture, so the same dark chip in either theme */
  .unsaved {
    position: absolute;
    left: 4px;
    bottom: 4px;
    padding: 1px 5px;
    border-radius: 3px;
    background: rgba(10, 10, 10, 0.72);
    color: #f2f2f2;
    font-size: 9.5px;
    line-height: 14px;
    white-space: nowrap;
  }
  .note {
    margin: 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .none {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px;
    border: 1px dashed var(--border);
    border-radius: var(--r-md);
    color: var(--text-2);
  }
  .none p {
    margin: 0;
    line-height: 1.4;
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    padding-top: 2px;
  }
</style>
