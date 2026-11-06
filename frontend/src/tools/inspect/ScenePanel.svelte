<script>
  import { onDestroy } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import {
    SCENE_LABEL_MAX, MAX_MOMENTS, isWholeVideo, parseClock, scenePassage, sceneTime, sceneTitle,
  } from '../../lib/scenes.js';

  // The scenes of the clip, in a drawer docked beside the video: it narrows the
  // picture rather than covering it, and leaves the whole bar under both. It lists
  // them in clip order, plays, names, ends and removes them, and opens a proved one's
  // proof.
  //
  // Pressing a scene's time goes there and opens its time in the row (`edit`, a
  // `lib/sceneEdit.svelte.js` the tool owns): the whole video, or moments, each an
  // instant or a passage, typed, taken from the frame on screen, or dragged on the
  // bar. A proof may hold several moments, a draft one. A press on the player hands
  // the keys back to it, so S and the arrows act on the frame, not on a field.
  let {
    scenes = [],
    edit = null,
    onadd,
    onplay,
    onlabel,
    onend,
    onremove,
    onopenproof,
    onedit,
    onhere,
    onkind,
    onnudge,
    onaddmoment,
    onapply,
    oncancel,
    onleave,
    onclose,
  } = $props();

  let node = $state(null);

  const editing = $derived(edit?.scene ? scenes.find((s) => s.key === edit.key) ?? null : null);

  $effect(() => {
    if (!node) return;
    const press = (event) => {
      const focused = document.activeElement;
      if (!node.contains(event.target) && focused && node.contains(focused)) focused.blur();
    };
    window.addEventListener('pointerdown', press, true);
    return () => window.removeEventListener('pointerdown', press, true);
  });

  // The player going away with a time open (a frame picked from the strip) leaves it
  // the way closing the drawer does, so no time stays open with no row to show it.
  onDestroy(() => {
    if (edit?.scene) onleave?.();
  });

  function fieldKey(e, which, index) {
    if (e.key === 'Enter') {
      e.preventDefault();
      onapply?.();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      oncancel?.();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      onnudge?.(which, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey, index);
    }
  }

  // A field that opens in hand is picked, so typing replaces it.
  function picked(node, inHand) {
    if (inHand) {
      node.focus();
      node.select();
    }
  }

  const KINDS = [
    { id: 'whole', label: 'Whole video', help: INSPECT_HELP.sceneWhole },
    { id: 'instant', label: 'Instant', help: INSPECT_HELP.sceneInstant },
    { id: 'passage', label: 'Passage', help: INSPECT_HELP.scenePassage },
  ];
</script>

<aside class="scene-panel" aria-label="Scenes" bind:this={node} data-scene-panel>
  <div class="head">
    <span class="heading">Scenes</span>
    <button class="btn btn-xs" onclick={() => onadd?.()} title={INSPECT_HELP.sceneHere}>
      <Icon name="plus" size={12} /> Scene here <kbd>S</kbd>
    </button>
    <button class="close" onclick={() => onclose?.()} title={INSPECT_HELP.scenesClose} aria-label="Close the scenes">
      <Icon name="x" size={13} />
    </button>
  </div>
  {#if !scenes.length}
    <p class="note">Press S where something happens to geolocate. End here turns it into a passage.</p>
  {/if}
  <div class="list">
    {#each scenes as sc (sc.key)}
      {@const loop = scenePassage(sc)}
      {@const inHand = editing?.key === sc.key}
      {@const whole = isWholeVideo(sc)}
      <div class="scene-row" class:open={inHand} style:--scene={sc.color} data-testid="scene-row">
        <div class="line">
          <span class="swatch" aria-hidden="true"></span>
          {#if loop}
            <button class="go" onclick={() => onplay?.(sc)} title={INSPECT_HELP.scenePlay} aria-label="Play scene">
              <Icon name="play" size={10} />
            </button>
          {:else}
            <span class="go" aria-hidden="true"></span>
          {/if}
          <button
            class="time mono"
            class:on={inHand}
            class:whole
            onclick={() => onedit?.(sc)}
            title={INSPECT_HELP.sceneTime}
            aria-expanded={inHand}
            aria-label={`Time of the scene, ${sceneTime(sc)}`}
          >{sceneTime(sc)}</button>
          {#if sc.kind === 'proof'}
            <button class="proof" onclick={() => onopenproof?.(sc)} title={INSPECT_HELP.sceneProof}>
              <span class="title" dir="auto">{sceneTitle(sc)}</span>
              <span class="proved"><Icon name="check" size={11} /> {sc.points?.length > 1 ? `${sc.points.length} places` : 'Proved'}</span>
            </button>
          {:else}
            <input
              class="input scene-label"
              dir="auto"
              value={sc.label}
              oninput={(e) => onlabel?.(sc.id, e.currentTarget.value)}
              maxlength={SCENE_LABEL_MAX}
              placeholder="What to find here"
              aria-label="Scene label"
              title={INSPECT_HELP.sceneLabel}
              onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            {#if !inHand && !whole}
              <button class="btn btn-ghost btn-xs" onclick={() => onend?.(sc.id)} title={INSPECT_HELP.sceneEnd}>End here</button>
            {/if}
            <button class="btn btn-ghost btn-xs" onclick={() => onremove?.(sc.id)} title={INSPECT_HELP.sceneRemove} aria-label="Remove scene">
              <Icon name="x" size={12} />
            </button>
          {/if}
        </div>
        {#if inHand}
          <div class="editor" role="group" aria-label="When the scene happens">
            <div class="kinds" role="radiogroup" aria-label="Kind of time">
              {#each KINDS as k (k.id)}
                <button role="radio" aria-checked={edit.kind === k.id} class:on={edit.kind === k.id} onclick={() => onkind?.(k.id)} title={k.help}>{k.label}</button>
              {/each}
            </div>
            {#if edit.whole}
              <p class="tip">No timecode, the scene is about the whole video{sc.kind === 'proof' && sc.at?.length ? '. Its frames stay pinned on the bar' : ''}</p>
            {:else}
              {#each edit.moments as m, i (i)}
                <div
                  class="moment"
                  class:held={edit.moments.length > 1 && i === edit.active}
                  role="group"
                  aria-label={`Moment ${i + 1}`}
                  data-testid="scene-moment"
                  onfocusin={() => edit.activate(i)}
                  onpointerdown={() => edit.activate(i)}
                >
                  <label class="field">
                    <span class="name">{m.passage ? 'Start' : 'At'}</span>
                    <span class="field-with-act">
                      <input
                        class="input mono"
                        value={m.startText}
                        oninput={(e) => edit.typeStart(e.currentTarget.value, i)}
                        onkeydown={(e) => fieldKey(e, 'start', i)}
                        aria-label="Scene start"
                        aria-invalid={parseClock(m.startText) == null}
                        title={INSPECT_HELP.sceneField}
                        spellcheck="false"
                        autocomplete="off"
                        use:picked={i === edit.active}
                      />
                      <button class="field-act here" onclick={() => onhere?.('start', i)} title={INSPECT_HELP.sceneStartHere}>Here</button>
                    </span>
                  </label>
                  {#if m.passage}
                    <label class="field">
                      <span class="name">End</span>
                      <span class="field-with-act">
                        <input
                          class="input mono"
                          value={m.endText}
                          oninput={(e) => edit.typeEnd(e.currentTarget.value, i)}
                          onkeydown={(e) => fieldKey(e, 'end', i)}
                          aria-label="Scene end"
                          aria-invalid={parseClock(m.endText) == null}
                          title={INSPECT_HELP.sceneField}
                          spellcheck="false"
                          autocomplete="off"
                        />
                        <button class="field-act here" onclick={() => onhere?.('end', i)} title={INSPECT_HELP.sceneEndHere}>Here</button>
                      </span>
                    </label>
                  {:else}
                    <span class="field"></span>
                  {/if}
                  {#if edit.moments.length > 1}
                    <button class="drop" onclick={() => edit.remove(i)} title={INSPECT_HELP.momentRemove} aria-label="Remove this moment">
                      <Icon name="x" size={11} />
                    </button>
                  {/if}
                </div>
              {/each}
              {#if edit.many && edit.moments.length < MAX_MOMENTS}
                <button class="btn btn-ghost btn-xs another" onclick={() => onaddmoment?.()} title={INSPECT_HELP.momentAdd}>
                  <Icon name="plus" size={11} /> Another moment
                </button>
              {/if}
            {/if}
            {#if edit.problem}
              <p class="problem" role="alert">{edit.problem}</p>
            {:else if !edit.whole}
              <p class="tip">{edit.end != null ? 'S sets the start, Shift+S the end, or drag them on the bar' : 'S sets it at the frame on screen, or drag it on the bar'}</p>
            {/if}
            <div class="acts">
              <button class="btn btn-ghost btn-xs" onclick={() => oncancel?.()}>Cancel</button>
              <button class="btn btn-primary btn-xs" disabled={Boolean(edit.problem)} onclick={() => onapply?.()} title={INSPECT_HELP.sceneApply}>Apply</button>
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
</aside>

<style>
  .scene-panel {
    flex: 0 0 320px;
    width: 320px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .head {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 8px 6px 12px;
  }
  .heading {
    flex: 1;
    color: var(--text-3);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .head kbd {
    padding: 0 4px;
    border: 1px solid currentColor;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 9px;
    opacity: 0.7;
  }
  .close {
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--r-sm);
    color: var(--text-3);
  }
  .close:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .note {
    margin: 4px 12px 8px;
    color: var(--text-3);
    font-size: 11px;
    line-height: 1.4;
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 0 8px 8px;
  }
  .scene-row {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    border-radius: var(--r-sm);
  }
  .scene-row.open {
    padding: 0 0 8px;
    background: var(--bg-0);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .swatch {
    flex-shrink: 0;
    width: 4px;
    align-self: stretch;
    min-height: 26px;
    border-radius: 2px;
    background: var(--scene);
  }
  .go {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 18px;
    height: 22px;
    border-radius: var(--r-sm);
    color: var(--text-3);
  }
  button.go:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .time {
    flex-shrink: 0;
    max-width: 150px;
    min-width: 46px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 3px 5px;
    border-radius: var(--r-sm);
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-align: left;
    text-decoration: underline dotted var(--text-3);
    text-underline-offset: 3px;
  }
  .time.whole {
    font-family: inherit;
    color: var(--text-3);
  }
  .time:hover,
  .time.on {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .time.on {
    text-decoration: none;
    box-shadow: inset 0 0 0 1px var(--scene);
  }
  .scene-label {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    font-size: var(--fs-sm);
  }
  .proof {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-0);
    color: var(--text-1);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .proof:hover {
    border-color: var(--accent);
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .proved {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: var(--fs-xs);
    color: var(--ok);
  }
  /* The scene's time, opened in its own row: indented past the swatch. */
  .editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 0 8px 0 12px;
  }
  .kinds {
    display: grid;
    grid-template-columns: 1.3fr 1fr 1fr;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    overflow: hidden;
  }
  .kinds button {
    padding: 3px 0;
    color: var(--text-2);
    font-size: var(--fs-xs);
  }
  .kinds button + button {
    border-left: 1px solid var(--border);
  }
  .kinds button:hover:not(.on) {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .kinds button.on {
    background: var(--accent);
    color: var(--accent-text);
  }
  /* One moment: its start, its end when it is a passage, and its removal. */
  .moment {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    align-items: end;
    gap: 6px;
    padding-left: 6px;
    border-left: 2px solid transparent;
  }
  .moment.held {
    border-left-color: var(--scene);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .name {
    color: var(--text-3);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .field .input {
    padding: 3px 6px;
    font-size: var(--fs-xs);
  }
  .field .input[aria-invalid='true'] {
    color: var(--danger);
  }
  .here {
    width: auto;
    padding: 0 7px;
    font-size: 11px;
  }
  .drop {
    display: inline-grid;
    place-items: center;
    width: 20px;
    height: 26px;
    border-radius: var(--r-sm);
    color: var(--text-3);
  }
  .drop:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .another {
    align-self: flex-start;
  }
  .problem,
  .tip {
    margin: 0;
    font-size: 11px;
    line-height: 1.35;
  }
  .problem {
    color: var(--danger);
  }
  .tip {
    color: var(--text-3);
  }
  .acts {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
  }
</style>
