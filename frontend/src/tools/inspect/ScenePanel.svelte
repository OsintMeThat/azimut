<script>
  import { onDestroy, tick } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import SceneTimeEditor from '../../components/SceneTimeEditor.svelte';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import {
    PROGRESS, SCENE_LABEL_MAX, isAbandoned, isWholeVideo, scenePassage, sceneTime, sceneTitle,
  } from '../../lib/scenes.js';

  // The scenes of the clip, in a drawer docked beside the video: it narrows the
  // picture rather than covering it, and leaves the whole bar under both. It lists
  // them in clip order, plays, names, ends and removes them, and opens a proved one's
  // proof.
  //
  // Pressing a scene's time goes there and opens its time in the row (`edit`, a
  // `lib/sceneEdit.svelte.js` the tool owns): the whole video, or moments, each an
  // instant or a passage, typed, taken from the frame on screen, or dragged on the
  // bar (`components/SceneTimeEditor`, which Geo Proof opens too). A proof may hold
  // several moments, a draft one. A press on the player hands the keys back to it,
  // so S and the arrows act on the frame, not on a field.
  //
  // A scene still to prove says where it stands under its name: To geolocate, In
  // progress once captures were filed for it on the map, or Geolocating while it is
  // the one being looked for (`engine/geolocate.py`). Geolocate is its main act, in
  // the accent, and Make the proof stays beside it: Geo Proof opens on its frames
  // and captures. Abandon asks for a word, which may stay empty, and the scene leaves
  // the list for the folded Abandoned group at the foot of the drawer, greyed, its
  // word shown, and Restore there brings it back as it was.
  let {
    scenes = [],
    edit = null,
    // `{ key, n }`: the row to bring into view and light a moment, `n` counting asks
    focus = null,
    onadd,
    onplay,
    ongo,
    onlabel,
    onend,
    onremove,
    onopenproof,
    onmakeproof,
    ongeolocate,
    onabandon,
    onrestore,
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
  const listed = $derived(scenes.filter((s) => !isAbandoned(s)));
  const given = $derived(scenes.filter(isAbandoned));

  // The Abandoned group, folded each time the drawer opens, never remembered.
  let showGiven = $state(false);
  // The row asking for the word it is abandoned with, and the word so far.
  let leaving = $state(null);
  let reason = $state('');
  let lit = $state(null);

  function askReason(sc) {
    leaving = sc.key;
    reason = '';
  }

  function giveUp(sc) {
    const word = reason.trim();
    leaving = null;
    onabandon?.(sc, word);
  }

  function reasonKey(e, sc) {
    if (e.key === 'Enter') {
      e.preventDefault();
      giveUp(sc);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      leaving = null;
    }
  }

  // A field that opens is where the typing goes.
  const focused = (input) => {
    input.focus();
  };

  // A scene asked for from elsewhere (the pill, the To-do) is brought into view and
  // lit a moment, its group unfolded when it was abandoned.
  $effect(() => {
    const wanted = focus;
    if (!wanted?.key || !node) return;
    const held = scenes.find((s) => s.key === wanted.key);
    if (!held) return;
    if (isAbandoned(held)) showGiven = true;
    let timer = null;
    tick().then(() => {
      const row = [...node.querySelectorAll('[data-scene-key]')].find((el) => el.dataset.sceneKey === wanted.key);
      row?.scrollIntoView?.({ block: 'nearest' });
      lit = wanted.key;
      timer = setTimeout(() => (lit = null), 1600);
    });
    return () => clearTimeout(timer);
  });

  /** Where a scene still to prove stands, in a few words. */
  function standing(sc) {
    const count = sc.captures?.length ?? 0;
    const captures = count === 1 ? '1 capture' : `${count} captures`;
    if (sc.geolocating) return count ? `Geolocating · ${captures}` : 'Geolocating';
    return sc.state === PROGRESS ? `In progress · ${captures}` : 'To geolocate';
  }

  function standingTip(sc) {
    if (sc.geolocating) return INSPECT_HELP.sceneGeolocating;
    return sc.state === PROGRESS ? INSPECT_HELP.sceneInProgress : INSPECT_HELP.sceneToGeolocate;
  }

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

  // What the editor says in Inspect, where S and the bar move the time too.
  const HELP = {
    whole: INSPECT_HELP.sceneWhole,
    instant: INSPECT_HELP.sceneInstant,
    passage: INSPECT_HELP.scenePassage,
    field: INSPECT_HELP.sceneField,
    startHere: INSPECT_HELP.sceneStartHere,
    endHere: INSPECT_HELP.sceneEndHere,
    add: INSPECT_HELP.momentAdd,
    remove: INSPECT_HELP.momentRemove,
    apply: INSPECT_HELP.sceneApply,
  };
  const tips = (sc) => ({
    whole: `No timecode, the scene is about the whole video${sc.kind === 'proof' && sc.at?.length ? '. Its frames stay pinned on the bar' : ''}`,
    instant: 'S sets it at the frame on screen, or drag it on the bar',
    passage: 'S sets the start, Shift+S the end, or drag them on the bar',
  });
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
  {#if !listed.length && !given.length}
    <p class="note">Press S where something happens to geolocate. End here turns it into a passage.</p>
  {/if}
  <div class="list">
    {#each listed as sc (sc.key)}
      {@const loop = scenePassage(sc)}
      {@const inHand = editing?.key === sc.key}
      {@const whole = isWholeVideo(sc)}
      <div
        class="scene-row"
        class:open={inHand}
        class:active={sc.geolocating}
        class:lit={lit === sc.key}
        style:--scene={sc.color}
        data-testid="scene-row"
        data-scene-key={sc.key}
      >
        <span class="swatch" aria-hidden="true"></span>
        <div class="line">
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
            <button class="btn btn-ghost btn-xs drop" onclick={() => onremove?.(sc.id)} title={INSPECT_HELP.sceneRemove} aria-label="Remove scene">
              <Icon name="x" size={12} />
            </button>
          {/if}
        </div>
        <!-- Where a scene still to prove stands, then what it can become: its place found
             on the map, then a proof. The editor's own End takes the place of these
             while its time is open, and the word it is abandoned with while asked. -->
        {#if sc.kind !== 'proof' && !inHand}
          {#if leaving === sc.key}
            <div class="leave" role="group" aria-label="Abandon the scene">
              <input
                class="input why-field"
                dir="auto"
                bind:value={reason}
                maxlength={200}
                placeholder="Why, if you like"
                aria-label="Why it is abandoned"
                title={INSPECT_HELP.sceneAbandonWord}
                onkeydown={(e) => reasonKey(e, sc)}
                use:focused
              />
              <button class="btn btn-xs" onclick={() => giveUp(sc)} title={INSPECT_HELP.sceneAbandonConfirm}>Abandon</button>
              <button class="btn btn-ghost btn-xs" onclick={() => (leaving = null)}>Cancel</button>
            </div>
          {:else}
            <div class="standing" class:going={sc.geolocating} class:found={sc.state === PROGRESS} title={standingTip(sc)} data-testid="scene-state">
              {#if sc.geolocating}
                <Icon name="crosshair" size={11} />
              {:else if sc.state === PROGRESS}
                <Icon name="camera" size={11} />
              {:else}
                <span class="ring" aria-hidden="true"></span>
              {/if}
              <span class="words">{standing(sc)}</span>
              <button class="quiet" onclick={() => askReason(sc)} title={INSPECT_HELP.sceneAbandon}>Abandon</button>
            </div>
            <div class="acts">
              {#if !whole}
                <button class="btn btn-ghost btn-xs" onclick={() => onend?.(sc.id)} title={INSPECT_HELP.sceneEnd}>End here</button>
              {/if}
              <button class="btn btn-ghost btn-xs make" onclick={() => onmakeproof?.(sc)} title={INSPECT_HELP.sceneMakeProof} aria-label="Make the proof">
                <Icon name="proof" size={12} /> <span class="make-words">Make the proof</span>
              </button>
              <!-- a switch: pressed again on the scene in hand, it stops -->
              <button
                class="btn btn-xs locate"
                class:on={sc.geolocating}
                aria-pressed={!!sc.geolocating}
                onclick={() => ongeolocate?.(sc)}
                title={sc.geolocating ? INSPECT_HELP.sceneStopGeolocating : INSPECT_HELP.sceneGeolocate}
              >
                <Icon name="crosshair" size={12} /> {sc.geolocating ? 'Stop' : 'Geolocate'}
              </button>
            </div>
          {/if}
        {/if}
        {#if inHand}
          <div class="in-row">
            <SceneTimeEditor
              {edit}
              help={HELP}
              tips={tips(sc)}
              {onhere}
              {onkind}
              {onnudge}
              {onaddmoment}
              {onapply}
              {oncancel}
            />
          </div>
        {/if}
      </div>
    {/each}

    <!-- Given up on, kept where it was in the clip: folded at the foot of the drawer. -->
    {#if given.length}
      <div class="given" class:shown={showGiven}>
        <button class="given-head" onclick={() => (showGiven = !showGiven)} aria-expanded={showGiven} title={INSPECT_HELP.scenesAbandoned}>
          <Icon name={showGiven ? 'chevronDown' : 'chevronRight'} size={12} />
          Abandoned ({given.length})
        </button>
        {#if showGiven}
          {#each given as sc (sc.key)}
            <div class="scene-row abandoned" class:lit={lit === sc.key} data-testid="scene-row-abandoned" data-scene-key={sc.key}>
              <span class="swatch" aria-hidden="true"></span>
              <div class="line">
                <span class="go" aria-hidden="true"></span>
                <button
                  class="time mono"
                  class:whole={isWholeVideo(sc)}
                  onclick={() => ongo?.(sc)}
                  title={INSPECT_HELP.sceneGo}
                  aria-label={`Go to the scene, ${sceneTime(sc)}`}
                >{sceneTime(sc)}</button>
                <span class="title gone-title" class:unnamed={!sc.label} dir="auto">{sc.label || 'No label'}</span>
                <button class="btn btn-ghost btn-xs" onclick={() => onrestore?.(sc)} title={INSPECT_HELP.sceneRestore}>Restore</button>
              </div>
              {#if sc.abandoned?.reason}
                <p class="why" dir="auto">{sc.abandoned.reason}</p>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</aside>

<style>
  /* It gives way down to 260 px rather than leave the picture a sliver. */
  .scene-panel {
    flex: 0 1 320px;
    min-width: 260px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    container-type: inline-size;
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
    gap: 6px;
    padding: 0 8px 8px;
  }
  /* The scene's colour runs down its whole row: its line, what it can become, its time. */
  .scene-row {
    position: relative;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding-left: 8px;
    border-radius: var(--r-sm);
  }
  .scene-row.open {
    gap: 6px;
    padding-bottom: 8px;
    background: var(--bg-0);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .line {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    min-height: 26px;
  }
  .swatch {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4px;
    border-radius: 2px;
    background: var(--scene);
  }
  /* under the time, past the play press */
  .acts {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-left: 22px;
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
  /* The scene being geolocated, ringed in the accent; one asked for, lit a moment. */
  .scene-row.active {
    padding: 3px 4px 4px 8px;
    background: color-mix(in srgb, var(--accent) 6%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  }
  .scene-row.lit {
    animation: lit 1.6s var(--ease);
  }
  @keyframes lit {
    0%, 35% { background: color-mix(in srgb, var(--scene, var(--accent)) 22%, transparent); }
    100% { background: transparent; }
  }
  /* Where a scene still to prove stands, small and under its name. */
  .standing {
    display: flex;
    align-items: center;
    gap: 5px;
    min-height: 18px;
    padding-left: 22px;
    color: var(--text-3);
    font-size: 10.5px;
  }
  .standing.found {
    color: var(--text-2);
  }
  .standing.going {
    color: var(--accent);
    font-weight: 600;
  }
  .standing :global(svg) {
    flex-shrink: 0;
  }
  .words {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ring {
    flex-shrink: 0;
    width: 9px;
    height: 9px;
    border: 1.5px solid currentColor;
    border-radius: 50%;
    opacity: 0.8;
  }
  .quiet {
    flex-shrink: 0;
    margin-left: auto;
    padding: 1px 5px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: 10.5px;
    font-weight: 400;
  }
  .quiet:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  /* the step a scene to prove may jump to, its mark in the accent */
  .make {
    margin-left: auto;
  }
  .make :global(svg) {
    color: var(--accent);
  }
  .make:hover {
    color: var(--accent);
  }
  /* Its main act: the accent, kept soft so a list of them stays calm. */
  .locate {
    flex-shrink: 0;
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: var(--accent-soft);
    color: var(--text-1);
    font-weight: 600;
  }
  .locate :global(svg) {
    color: var(--accent);
  }
  .locate:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-text);
  }
  .locate:hover :global(svg) {
    color: var(--accent-text);
  }
  .locate.on {
    border-color: var(--accent);
  }
  .drop {
    flex-shrink: 0;
  }
  /* The word it is abandoned with, asked in its row. */
  .leave {
    display: flex;
    align-items: center;
    gap: 4px;
    padding-left: 22px;
  }
  .why-field {
    flex: 1;
    min-width: 0;
    padding: 2px 6px;
    font-size: var(--fs-xs);
  }
  /* The abandoned, folded at the foot of the list. */
  .given {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 2px;
    padding-top: 6px;
    border-top: 1px solid var(--border);
  }
  .given-head {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px 2px 2px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .given-head:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .scene-row.abandoned .swatch {
    background: none;
    box-shadow: inset 0 0 0 1px var(--text-3);
  }
  .scene-row.abandoned .time {
    color: var(--text-3);
  }
  .gone-title {
    color: var(--text-2);
    font-size: var(--fs-sm);
    padding: 0 4px;
  }
  .gone-title.unnamed {
    color: var(--text-3);
    font-style: italic;
  }
  .why {
    margin: 0 0 2px;
    padding-left: 22px;
    color: var(--text-3);
    font-size: 11px;
    font-style: italic;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  /* a narrow drawer keeps Make the proof's mark and drops its words */
  @container (max-width: 300px) {
    .make-words {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .scene-row.lit {
      animation: none;
      box-shadow: inset 0 0 0 1px var(--scene, var(--accent));
    }
  }
  /* The scene's time, opened in its own row, under its line. */
  .in-row {
    padding: 0 8px 0 4px;
  }
</style>
