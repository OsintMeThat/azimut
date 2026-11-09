<script>
  import { tick } from 'svelte';
  import FloatingMenu from '../../components/FloatingMenu.svelte';
  import Icon from '../../components/Icon.svelte';
  import SceneCounts from '../../components/SceneCounts.svelte';
  import SceneTimeEditor from '../../components/SceneTimeEditor.svelte';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';
  import {
    SCENE_LABEL_MAX, isAbandoned, isWholeVideo, mixedWhole, samePlaceChoices, sceneColorAt, scenePassage, sceneTime,
    sceneTitle, sceneWhen, shortClock, spanLabel, unplaced, wholeBarred, wholeDrafts,
  } from '../../lib/scenes.js';

  // The Scenes tab: the places to find in the open file, in clip order, a scene about
  // the whole video first, the proofs resting on it among them.
  //
  // A closed row writes its name, its kind and time in words (`Passage · 0:30–0:45`)
  // and where it stands; a press anywhere on it opens it. One row is open at a time
  // (`open`, which the tool keeps: the last touched, or the one under the playhead
  // when the tab is landed in). The open row shows its time as it stands, the
  // segmented Whole video, Instant or Passage and its fields, driven by the tool's
  // `lib/sceneEdit.svelte.js` (`edit`), which also gives the bar its handles; Apply
  // and Cancel come once something changed. A press outside the tab hands the keys
  // back to the player, so S and the arrows act on the frame, never on a field.
  //
  // A scene still to prove says where it stands, by a small mark: To geolocate, In
  // progress once captures were filed for it on the map, or Geolocating while it is the
  // one being looked for (`engine/geolocate.py`). Beside it, its two counts
  // (`components/SceneCounts`): the captures the map gave it, and the frames and
  // collages of the clip in it (`footage`, by scene key, counted off the strip in hand). Geolocate is its main act, in the accent, a
  // switch that stops it when pressed again; Make the proof stays beside it. Abandon
  // asks for a word, which may stay empty, and the scene goes to the folded Abandoned
  // group at the foot, greyed with its word, where Restore brings it back.
  //
  // A proof stands Proved once it states a place. Saved with no point yet, it reads In
  // progress and can be abandoned and restored like a scene (`engine/scenes.proof_state`).
  //
  // A scene still to prove may hold several passages, where its place shows again: the
  // open row's Another passage adds one of its kind from the frame on screen, and Same
  // place as… beside it lists the clip's other scenes still to prove, one press joining
  // this one into the scene chosen (`onjoin`). A video is one place or several: a scene
  // still to prove is offered the whole video only as the video's one live scene still
  // to prove with no scene holding passages beside it, else it is greyed with why
  // (`wholeBarred`). A proof is an answer and keeps it.
  //
  // An older case may hold what is no longer made, and opens as it is. Two scenes still
  // to prove about the whole video get a quiet line over the list, **2 scenes for the
  // whole video · Join them**, which joins them into the first (`onjoinwhole`). One about
  // the whole video beside scenes holding passages says so in its open row, with **Give
  // it a time**, the instant on screen (`ongivetime`), and **Abandon…**; closed, a small
  // mark says it. A video in neither state shows none of it.
  //
  // A video with no live scene asks whether it is one place or several, once its list
  // is read (`read`): **The whole video: one place** keeps one scene about all of it
  // (`onwhole`), **Several places: mark them as you watch** says how S marks them
  // (`onseveral`). The question stays while the clip holds no live scene.
  //
  // A picture (`picture`) is marked whole, once, from here: its row has no time, and
  // once a proof lays the picture out, the proof's row takes its place.
  //
  // The collages cut from the clip alone sit under the scenes they fall in
  // (`collages`, by scene key, `lib/sceneFrames.collagesUnder`); a press opens one.
  let {
    scenes = [],
    footage = new Map(),
    collages = new Map(),
    onopencollage,
    edit = null,
    open = null,
    // `{ key, n }`: the row to bring into view and light a moment, `n` counting asks
    focus = null,
    picture = false,
    read = true,
    onopen,
    onmark,
    onwhole,
    onseveral,
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
    onhere,
    onkind,
    onnudge,
    onaddmoment,
    onjoin,
    onjoinwhole,
    ongivetime,
    onapply,
    oncancel,
  } = $props();

  let node = $state(null);

  // Same place as…: the row whose chooser is open, and the button it hangs from.
  let joining = $state(null);
  let joinButton = $state(null);

  function join(sc, target) {
    joining = null;
    onjoin?.(sc, target);
  }

  const listed = $derived(scenes.filter((s) => !isAbandoned(s)));
  const given = $derived(scenes.filter(isAbandoned));
  // an older case's scenes about the whole video, more than the one a video holds
  const twins = $derived(picture ? [] : wholeDrafts(scenes));
  // why the whole video is greyed in a scene's kinds, by what bars it
  const WHOLE_OFF = { whole: INSPECT_HELP.sceneWholeTaken, timed: INSPECT_HELP.sceneWholeTimed };

  // The Abandoned group, folded each time the tab is shown, never remembered.
  let showGiven = $state(false);
  // The row asking for the word it is abandoned with, and the word so far.
  let leaving = $state(null);
  let reason = $state('');
  let lit = $state(null);

  function askReason(sc) {
    leaving = sc.key;
    reason = '';
  }

  // Another row opened lets go of the word being asked, and of the chooser.
  $effect(() => {
    void open;
    leaving = null;
    joining = null;
  });

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

  function labelKey(e) {
    if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
  }

  // A field that opens is where the typing goes.
  const focused = (input) => {
    input.focus();
  };

  // A scene asked for (the bar, the pill, the To-do) is brought into view and lit a
  // moment, its group unfolded when it was abandoned.
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

  // A press anywhere else gives the keys back to the player.
  $effect(() => {
    if (!node) return;
    const press = (event) => {
      const focused = document.activeElement;
      if (!node.contains(event.target) && focused && node.contains(focused)) focused.blur();
    };
    window.addEventListener('pointerdown', press, true);
    return () => window.removeEventListener('pointerdown', press, true);
  });

  /** A scene still to prove as its counts read it: a picture gives itself, a scene of the clip its frames. */
  const counted = (sc) => ({ ...sc, file_kind: picture ? 'image' : 'video', footage: footage.get(sc.key) ?? 0 });

  const proved = (sc) => (sc.points?.length > 1 ? `${sc.points.length} places` : 'Proved');
  /** A gone row's name: the label, or the proof's title. */
  const goneName = (sc) => (sc.kind === 'proof' ? sceneTitle(sc) : sc.label);
  /** A closed row's name: the label or the proof's title, else its time says what it is. */
  const named = (sc) => (sc.kind === 'proof' ? sceneTitle(sc) : sc.label.trim());

  // What the editor says in Inspect, where the bar moves the time too.
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
    instant: 'Or drag its pin on the bar',
    passage: 'Or drag its ends on the bar',
  });
</script>

{#snippet where(sc)}
  <div class="standing" data-testid="scene-state">
    <SceneCounts scene={counted(sc)} live={!!sc.geolocating} />
  </div>
{/snippet}

<!-- Where a proof stands: Proved with its place, or In progress while it states none. -->
{#snippet proofState(sc)}
  {#if unplaced(sc)}
    <span class="standing found" title={INSPECT_HELP.proofUnplaced} data-testid="scene-state">
      <span class="ring" aria-hidden="true"></span><span class="words">In progress · no place</span>
    </span>
  {:else}
    <span class="proved"><Icon name="check" size={11} /> {proved(sc)}</span>
  {/if}
{/snippet}

{#snippet leave(sc)}
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
{/snippet}

<!-- What a scene still to prove can become: its place found on the map, then a proof. -->
{#snippet acts(sc)}
  {#if leaving === sc.key}
    {@render leave(sc)}
  {:else}
    <div class="state-line">
      {@render where(sc)}
      <button class="quiet" onclick={() => askReason(sc)} title={INSPECT_HELP.sceneAbandon}>Abandon</button>
    </div>
    <div class="acts">
      {#if !picture && !isWholeVideo(sc)}
        <button class="btn btn-ghost btn-xs" onclick={() => onend?.(sc.id)} title={INSPECT_HELP.sceneEnd}>End here</button>
      {/if}
      <button
        class="btn btn-ghost btn-xs make"
        onclick={() => onmakeproof?.(sc)}
        title={picture ? INSPECT_HELP.pictureMakeProof : INSPECT_HELP.sceneMakeProof}
        aria-label="Make the proof"
      >
        <Icon name="proof" size={12} /> <span class="make-words">Make the proof</span>
      </button>
      <!-- a switch: pressed again on the scene in hand, it stops -->
      <button
        class="btn btn-xs locate"
        class:on={sc.geolocating}
        aria-pressed={!!sc.geolocating}
        onclick={() => ongeolocate?.(sc)}
        title={sc.geolocating ? INSPECT_HELP.sceneStopGeolocating : picture ? INSPECT_HELP.pictureGeolocate : INSPECT_HELP.sceneGeolocate}
      >
        <Icon name="crosshair" size={12} /> {sc.geolocating ? 'Stop' : 'Geolocate'}
      </button>
    </div>
  {/if}
{/snippet}

<!-- What a proof's open row offers: the proof, and while it states no place, Abandon. -->
{#snippet proofActs(sc)}
  {#if leaving === sc.key}
    {@render leave(sc)}
  {:else}
    {#if unplaced(sc)}
      <div class="state-line">
        {@render proofState(sc)}
        <button class="quiet" onclick={() => askReason(sc)} title={INSPECT_HELP.sceneAbandon}>Abandon</button>
      </div>
    {/if}
    <div class="acts">
      <button class="btn btn-ghost btn-xs make" onclick={() => onopenproof?.(sc)} title={picture ? INSPECT_HELP.pictureProof : INSPECT_HELP.sceneProof}>
        <Icon name="proof" size={12} /> Open the proof
      </button>
    </div>
  {/if}
{/snippet}

{#snippet collageLines(sc)}
  {@const held = collages.get(sc.key) ?? []}
  {#if held.length}
    <ul class="collage-lines" style:--scene={sc.color} aria-label="Collages in this scene">
      {#each held as col (col.collage)}
        <li>
          <button class="collage-line" onclick={() => onopencollage?.(col)} title={INSPECT_HELP.collageOpen} data-testid="scene-collage">
            <Icon name="grid" size={11} />
            <span class="collage-title" dir="auto">{col.title}</span>
            <span class="collage-when">{col.end != null ? spanLabel(col.start, col.end) : shortClock(col.start)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

{#snippet labelField(sc)}
  <input
    class="input scene-label"
    dir="auto"
    value={sc.label}
    oninput={(e) => onlabel?.(sc.id, e.currentTarget.value)}
    maxlength={SCENE_LABEL_MAX}
    placeholder="What to find here"
    aria-label="Scene label"
    title={INSPECT_HELP.sceneLabel}
    onkeydown={labelKey}
  />
  <button class="icon-btn" onclick={() => onremove?.(sc.id)} title={INSPECT_HELP.sceneRemove} aria-label="Remove scene">
    <Icon name="x" size={12} />
  </button>
{/snippet}

<div class="scenes" bind:this={node} data-scene-panel>
  {#if picture}
    {#if !scenes.length}
      <div class="mark-picture">
        <button class="btn mark" onclick={() => onmark?.()} title={INSPECT_HELP.markPicture}>
          <Icon name="pin" size={14} /> Mark to geolocate
        </button>
        <p class="note">It waits in the To-do until a proof lays it out.</p>
      </div>
    {/if}
    {#each listed as sc (sc.key)}
      {#if sc.kind === 'proof'}
        {#if unplaced(sc)}
          <div class="scene-row open" class:lit={lit === sc.key} style:--scene={sceneColorAt(0)} role="group"
            aria-label="The picture's proof" data-testid="scene-row" data-scene-key={sc.key}>
            <span class="swatch" aria-hidden="true"></span>
            <div class="head"><span class="title" dir="auto">{sceneTitle(sc)}</span></div>
            {@render proofActs(sc)}
          </div>
        {:else}
          <button class="proved-row" onclick={() => onopenproof?.(sc)} title={INSPECT_HELP.pictureProof} data-testid="scene-row" data-scene-key={sc.key} class:lit={lit === sc.key}>
            <Icon name="check" size={12} />
            <span class="proved-words">{proved(sc)} · <span class="proved-title" dir="auto">{sceneTitle(sc)}</span></span>
            <Icon name="chevronRight" size={12} />
          </button>
        {/if}
      {:else}
        <div
          class="scene-row open"
          class:active={sc.geolocating}
          class:lit={lit === sc.key}
          style:--scene={sceneColorAt(0)}
          role="group"
          aria-label="The picture's scene"
          data-testid="scene-row"
          data-scene-key={sc.key}
        >
          <span class="swatch" aria-hidden="true"></span>
          <div class="head">{@render labelField(sc)}</div>
          {@render acts(sc)}
        </div>
      {/if}
    {/each}
  {:else}
    {#if read && !listed.length}
      <div class="choose" role="group" aria-labelledby="scene-choose-ask" data-testid="scene-choice">
        <span class="none-mark" aria-hidden="true"><Icon name="pin" size={15} /></span>
        <div class="choose-body">
          <p class="choose-ask" id="scene-choose-ask">One place or several?</p>
          <button class="btn btn-sm choice" onclick={() => onwhole?.()} title={INSPECT_HELP.inviteWhole}>
            <Icon name="video" size={13} /> <span class="choice-words"><span class="part">The whole video:</span> <span class="part">one place</span></span>
          </button>
          <button class="btn btn-sm choice several" onclick={() => onseveral?.()} title={INSPECT_HELP.inviteSeveral}>
            <Icon name="pin" size={13} /> <span class="choice-words"><span class="part">Several places:</span> <span class="part">mark them as you watch</span></span> <kbd>S</kbd>
          </button>
        </div>
      </div>
    {/if}
    {#if twins.length > 1 && onjoinwhole}
      <p class="twins" data-testid="whole-twins">
        <span>{twins.length} scenes for the whole video</span>
        <span class="twins-dot" aria-hidden="true">·</span>
        <button class="twins-join" onclick={() => onjoinwhole?.(twins)} title={INSPECT_HELP.wholeJoin}>Join them</button>
      </p>
    {/if}
    {#each listed as sc (sc.key)}
      {@const loop = scenePassage(sc)}
      {@const mixed = mixedWhole(scenes, sc)}
      {#if sc.key === open}
        <div
          class="scene-row open"
          class:active={sc.geolocating}
          class:lit={lit === sc.key}
          style:--scene={sc.color}
          role="group"
          aria-label={`Scene, ${sceneWhen(sc)}`}
          data-testid="scene-row"
          data-scene-key={sc.key}
        >
          <span class="swatch" aria-hidden="true"></span>
          <div class="head">
            {#if sc.kind === 'proof'}
              <span class="title" dir="auto">{sceneTitle(sc)}</span>
              {#if !unplaced(sc)}{@render proofState(sc)}{/if}
            {/if}
            {#if loop}
              <button class="icon-btn play" onclick={() => onplay?.(sc)} title={INSPECT_HELP.scenePlay} aria-label="Play scene">
                <Icon name="play" size={11} />
              </button>
            {/if}
            {#if sc.kind !== 'proof'}{@render labelField(sc)}{/if}
          </div>
          {#if mixed && leaving !== sc.key}
            <div class="mixed" role="note" data-testid="whole-mixed">
              <p class="mixed-says"><Icon name="alert" size={12} /> This video also has scenes at a time</p>
              <div class="mixed-acts">
                <button class="btn btn-ghost btn-xs" onclick={() => ongivetime?.(sc)} title={INSPECT_HELP.wholeGiveTime}>Give it a time</button>
                <button class="btn btn-ghost btn-xs" onclick={() => askReason(sc)} title={INSPECT_HELP.sceneAbandon}>Abandon…</button>
              </div>
            </div>
          {/if}
          {#if edit?.key === sc.key}
            {@const choices = onjoin ? samePlaceChoices(scenes, sc) : []}
            <!-- beside Another passage: the other scenes still to prove that show this place -->
            {#snippet samePlace()}
              <button
                class="btn btn-ghost btn-xs"
                bind:this={joinButton}
                aria-haspopup="menu"
                aria-expanded={joining === sc.key}
                onclick={() => (joining = joining === sc.key ? null : sc.key)}
                title={INSPECT_HELP.samePlace}
              >
                <Icon name="link" size={11} /> Same place as…
              </button>
            {/snippet}
            <SceneTimeEditor
              {edit}
              help={HELP}
              tips={tips(sc)}
              wholeOff={sc.kind === 'draft' ? WHOLE_OFF[wholeBarred(scenes, sc)] ?? '' : ''}
              autofocus={false}
              actsWhenChanged
              {onhere}
              {onkind}
              {onnudge}
              {onaddmoment}
              {onapply}
              {oncancel}
              besides={choices.length ? samePlace : undefined}
            />
          {/if}
          {#if sc.kind === 'proof'}
            {@render proofActs(sc)}
          {:else}
            {@render acts(sc)}
          {/if}
        </div>
      {:else}
        {@const name = named(sc)}
        <button
          class="scene-row closed"
          class:active={sc.geolocating}
          class:lit={lit === sc.key}
          style:--scene={sc.color}
          onclick={() => onopen?.(sc)}
          title={INSPECT_HELP.sceneOpen}
          aria-expanded="false"
          data-testid="scene-row"
          data-scene-key={sc.key}
        >
          <span class="swatch" aria-hidden="true"></span>
          <span class="row-main">
            <span class="row-title" dir="auto">{name || sceneWhen(sc)}</span>
            {#if name}<span class="row-when" data-testid="scene-when">{sceneWhen(sc)}</span>{/if}
          </span>
          {#if mixed}
            <span class="mixed-mark" title={INSPECT_HELP.wholeMixed} data-testid="whole-mixed-mark">
              <Icon name="alert" size={12} />
            </span>
          {/if}
          {#if sc.kind === 'proof'}
            {@render proofState(sc)}
          {:else}
            {@render where(sc)}
          {/if}
        </button>
      {/if}
      {@render collageLines(sc)}
    {/each}
  {/if}

  <!-- Same place as…: the clip's other scenes still to prove, each in its colour with its time. -->
  {#if joining && joinButton}
    {@const from = scenes.find((s) => s.key === joining)}
    {#if from}
      <FloatingMenu anchor={joinButton} width={264} label="Same place as" onclose={() => (joining = null)}>
        <p class="fm-head">Same place as</p>
        {#each samePlaceChoices(scenes, from) as other (other.key)}
          {@const name = other.label.trim()}
          <button
            class="fm-item same-choice"
            role="menuitem"
            style:--scene={other.color}
            onclick={() => join(from, other)}
            title={INSPECT_HELP.samePlaceAs}
            data-testid="same-place-choice"
          >
            <span class="choice-swatch" aria-hidden="true"></span>
            <span class="fm-grow" dir="auto">{name || sceneTime(other)}</span>
            {#if name}<span class="choice-when">{sceneTime(other)}</span>{/if}
          </button>
        {/each}
      </FloatingMenu>
    {/if}
  {/if}

  <!-- Given up on, kept where it was in the clip: folded at the foot of the tab. -->
  {#if given.length}
    <div class="given" class:shown={showGiven}>
      <button class="given-head" onclick={() => (showGiven = !showGiven)} aria-expanded={showGiven} title={INSPECT_HELP.scenesAbandoned}>
        <Icon name={showGiven ? 'chevronDown' : 'chevronRight'} size={12} />
        Abandoned ({given.length})
      </button>
      {#if showGiven}
        {#each given as sc (sc.key)}
          <div class="gone-row" class:lit={lit === sc.key} data-testid="scene-row-abandoned" data-scene-key={sc.key}>
            <div class="gone-line">
              <span class="gone-swatch" aria-hidden="true"></span>
              {#if !picture}
                <button
                  class="gone-time mono"
                  class:whole={isWholeVideo(sc)}
                  onclick={() => ongo?.(sc)}
                  title={INSPECT_HELP.sceneGo}
                  aria-label={`Go to the scene, ${sceneTime(sc)}`}
                >{sceneTime(sc)}</button>
              {/if}
              <span class="gone-title" class:unnamed={!goneName(sc)} dir="auto">{goneName(sc) || 'No label'}</span>
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

<style>
  /* A scene's collages, hung under its row on a rule in its colour. */
  .collage-lines {
    display: flex;
    flex-direction: column;
    gap: 1px;
    margin: -1px 0 3px 10px;
    padding: 0 0 0 8px;
    border-left: 2px solid color-mix(in srgb, var(--scene, var(--accent)) 55%, transparent);
    list-style: none;
  }
  .collage-line {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-width: 0;
    padding: 3px 6px;
    border: 0;
    border-radius: var(--r-sm);
    background: none;
    color: var(--text-2);
    font-size: var(--fs-xs);
    text-align: left;
  }
  .collage-line:hover {
    background: var(--bg-2);
    color: var(--text-1);
  }
  .collage-line :global(svg) {
    flex: none;
    color: var(--text-3);
  }
  .collage-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .collage-when {
    flex: none;
    color: var(--text-3);
    font-variant-numeric: tabular-nums;
  }
  .scenes {
    display: flex;
    flex-direction: column;
    gap: 4px;
    container-type: inline-size;
    color: var(--text-1);
    font-size: var(--fs-xs);
  }
  .note {
    margin: 0;
    color: var(--text-3);
    font-size: 11.5px;
    line-height: 1.45;
  }
  /* No live scene yet: one place or several, the pin a scene leaves on the bar beside it. */
  .choose {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 4px 10px;
  }
  .choose-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
  }
  .choose-ask {
    margin: 4px 0 2px;
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  /* each choice whole, its words wrapping on a narrow panel rather than cut */
  .choice {
    justify-content: flex-start;
    gap: 7px;
    min-width: 0;
    padding-top: 4px;
    padding-bottom: 4px;
    text-align: left;
    white-space: normal;
  }
  .choice :global(svg) {
    flex: none;
    color: var(--text-2);
  }
  .choice.several :global(svg) {
    color: var(--accent);
  }
  .choice-words {
    flex: 1;
    min-width: 0;
    line-height: 1.35;
  }
  /* a narrow panel breaks a choice between its two halves, never inside one */
  .choice-words .part {
    white-space: nowrap;
  }
  .choice kbd {
    flex: none;
    padding: 0 4px;
    border: 1px solid currentColor;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 10px;
    opacity: 0.6;
  }
  .none-mark {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* An older case's scenes about the whole video, more than one: a quiet line over the list. */
  .twins {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 5px;
    margin: 0 0 2px;
    padding: 2px 4px 4px 14px;
    color: var(--text-2);
    font-size: 11.5px;
  }
  .twins-dot {
    color: var(--text-3);
  }
  .twins-join {
    padding: 1px 5px;
    border-radius: var(--r-sm);
    color: var(--accent);
    font-size: 11.5px;
    font-weight: 600;
  }
  .twins-join:hover {
    background: var(--accent-soft);
  }
  /* One about the whole video beside scenes at a time: said in its open row, marked when closed. */
  .mixed {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 5px 6px 4px 8px;
    border-radius: var(--r-sm);
    background: color-mix(in srgb, var(--warn) 9%, transparent);
  }
  .mixed-says {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0;
    color: var(--text-1);
    font-size: 11.5px;
    line-height: 1.35;
  }
  .mixed-says :global(svg),
  .mixed-mark {
    flex: none;
    color: var(--warn);
  }
  .mixed-acts {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    margin-left: 12px;
  }
  .mixed-mark {
    display: inline-grid;
    place-items: center;
  }

  /* A row: the scene's colour down its left edge, its name, its time, where it stands. */
  .scene-row {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    padding: 7px 8px 7px 14px;
    border-radius: var(--r-md);
    color: inherit;
    text-align: left;
  }
  .swatch {
    position: absolute;
    left: 4px;
    top: 7px;
    bottom: 7px;
    width: 3px;
    border-radius: 2px;
    background: var(--scene);
  }
  .scene-row.closed {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    cursor: pointer;
  }
  .scene-row.closed:hover {
    background: color-mix(in srgb, var(--text-1) 5%, transparent);
  }
  .scene-row.closed:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .row-title,
  .row-when,
  .title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-title {
    color: var(--text-1);
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .row-when {
    color: var(--text-3);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  /* The open row: the scene in hand, set in the panel like a sheet. */
  .scene-row.open {
    margin: 2px 0;
    padding: 9px 10px 10px 16px;
    gap: 8px;
    background: var(--bg-0);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .scene-row.open .swatch {
    left: 5px;
    top: 9px;
    bottom: 9px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
  }
  .title {
    flex: 1;
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .scene-label {
    flex: 1;
    min-width: 0;
    padding: 4px 7px;
    font-size: var(--fs-sm);
    font-weight: 600;
  }
  .scene-label::placeholder {
    font-weight: 400;
  }
  .icon-btn {
    flex-shrink: 0;
    display: inline-grid;
    place-items: center;
    width: 24px;
    height: 26px;
    border-radius: var(--r-sm);
    color: var(--text-3);
  }
  .icon-btn:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .icon-btn.play {
    color: var(--text-2);
  }
  .proved {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    color: var(--ok);
    font-size: 10.5px;
    font-weight: 600;
  }
  /* The scene being geolocated, ringed in the accent; one asked for, lit a moment. */
  .scene-row.active {
    background: color-mix(in srgb, var(--accent) 6%, var(--bg-0));
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .scene-row.closed.active {
    background: color-mix(in srgb, var(--accent) 6%, transparent);
  }
  .lit {
    animation: lit 1.6s var(--ease);
  }
  @keyframes lit {
    0%, 35% { background: color-mix(in srgb, var(--scene, var(--accent)) 22%, transparent); }
  }
  /* Where a scene still to prove stands, small. */
  .standing {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 100%;
    color: var(--text-3);
    font-size: 10.5px;
  }
  .standing.found {
    color: var(--text-2);
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
  .state-line {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .quiet {
    flex-shrink: 0;
    margin-left: auto;
    padding: 2px 5px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: 10.5px;
  }
  .quiet:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .acts {
    display: flex;
    align-items: center;
    gap: 4px;
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
  /* The word it is abandoned with, asked in its row. */
  .leave {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .why-field {
    flex: 1;
    min-width: 0;
    padding: 3px 6px;
    font-size: var(--fs-xs);
  }

  /* A picture, marked whole from here. */
  .mark-picture {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 8px;
    padding: 4px 0 6px;
  }
  .mark {
    gap: 6px;
    font-weight: 600;
  }
  .mark :global(svg) {
    color: var(--accent);
  }
  .proved-row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 8px 10px;
    border-radius: var(--r-md);
    background: var(--ok-soft);
    color: var(--ok);
    font-size: var(--fs-sm);
    font-weight: 600;
    text-align: left;
  }
  .proved-row:hover {
    box-shadow: inset 0 0 0 1px var(--ok);
  }
  .proved-words {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .proved-title {
    color: var(--text-1);
  }

  /* The abandoned, folded at the foot. */
  .given {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 6px;
    padding-top: 8px;
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
  .gone-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px 4px 2px 6px;
    border-radius: var(--r-sm);
  }
  .gone-line {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    min-height: 26px;
  }
  .gone-swatch {
    flex-shrink: 0;
    width: 3px;
    height: 16px;
    border-radius: 2px;
    box-shadow: inset 0 0 0 1px var(--text-3);
  }
  .gone-time {
    flex-shrink: 0;
    padding: 2px 5px;
    border-radius: var(--r-sm);
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  .gone-time.whole {
    font-family: inherit;
  }
  .gone-time:hover {
    color: var(--text-1);
    background: var(--bg-2);
  }
  .gone-title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
    font-size: var(--fs-sm);
  }
  .gone-title.unnamed {
    color: var(--text-3);
    font-style: italic;
  }
  .why {
    margin: 0 0 2px 9px;
    color: var(--text-3);
    font-size: 11px;
    font-style: italic;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }
  /* Same place as…'s choices: each scene by the colour the bar draws it in, its time after. */
  .choice-swatch {
    flex: none;
    width: 3px;
    height: 16px;
    border-radius: 2px;
    background: var(--scene);
  }
  .choice-when {
    flex: none;
    color: var(--text-3);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  /* a narrow panel keeps Make the proof's mark and drops its words */
  @container (max-width: 290px) {
    .make-words {
      display: none;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .lit {
      animation: none;
      box-shadow: inset 0 0 0 1px var(--scene, var(--accent));
    }
  }
</style>
