<script module>
  import { ensureSceneQueue, readSceneQueue } from '../../lib/geolocating.svelte.js';

  // The sidebar and the Overview can both show the group, and every trigger below
  // fires in each of them: one read answers all. Mounting asks only for a queue that
  // is up to date, which the sidebar's count may already hold; a reload reads it again.
  let timer = null;
  let target = null;
  let again = false;
  let holders = 0;

  function reread(caseId, fresh = true) {
    if (timer !== null && target === caseId) {
      again ||= fresh;
      return;
    }
    clearTimeout(timer);
    target = caseId;
    again = fresh;
    timer = setTimeout(() => {
      timer = null;
      (again ? readSceneQueue : ensureSceneQueue)(caseId);
    });
  }

  function hold() {
    holders += 1;
    return () => {
      holders -= 1;
      if (holders || timer === null) return;
      clearTimeout(timer);
      timer = null;
    };
  }
</script>

<script>
  /**
   * The scenes still to geolocate, at the top of the To-do: every scene kept in
   * Inspect that no proof takes up yet, by file, the file worked on last first
   * (`GET /scenes/queue`, `engine/geolocate.py`). Files with no scene stay in Sheet.
   * A picture marked to geolocate is a row like any other, Whole picture, with no bar
   * to mark it on.
   *
   * Absent while the case has nothing to geolocate, and a few rows when it has, so
   * the analyst's own lists stay in reach. Geolocate is the row's act; the scene's
   * name opens it in Inspect; Abandon asks for a word, which may stay empty.
   */
  import { onDestroy, tick, untrack } from 'svelte';
  import {
    abandonScene, geolocateScene, geolocating, holdSceneQueue, restoreScene, sceneQueue, stopGeolocating,
  } from '../../lib/geolocating.svelte.js';
  import {
    abandonedScenes, firstScenes, isPicture, openScenes, queueColor, queueMark, queueName, queueState, queueTime, sceneCount,
  } from '../../lib/sceneQueue.js';
  import { caseState, toast, uiState } from '../../lib/state.svelte.js';
  import Icon from '../../components/Icon.svelte';

  let { caseId } = $props();

  /** Rows shown before the rest are counted. */
  const SHOWN = 3;

  const files = $derived(sceneQueue.caseId === caseId ? (sceneQueue.files ?? []) : []);
  const failed = $derived(sceneQueue.caseId === caseId && !sceneQueue.files ? sceneQueue.error : '');
  const live = $derived(geolocating.caseId === caseId ? geolocating.scene : null);

  const keyOf = (scene) => `${scene.video}#${scene.id}`;
  const isLive = (scene) => Boolean(live && live.video === scene.video && live.id === scene.id);

  const open = $derived(openScenes(files));
  const left = $derived(abandonedScenes(files));
  const total = $derived(sceneCount(open));
  const leftCount = $derived(sceneCount(left));

  let all = $state(false);
  let leftOpen = $state(false);
  // The one row asking why it is abandoned, and the word typed so far.
  let leaving = $state(null);
  let reason = $state('');
  let reasonInput = $state(null);
  let busy = $state(false);

  // The first rows across the files, and the one being geolocated wherever it falls.
  const shown = $derived(all ? open : firstScenes(open, SHOWN, isLive));
  const rest = $derived(total - sceneCount(shown));

  // Read on mount, for another case, and after any write the case was reloaded for
  // (a file renamed, a proof made or deleted). The view switch remounts it. A scene
  // kept in Inspect, a proof's time stated, a deletion or a restore anywhere arrive
  // as nudges, which the shared module answers (`scenes`, `saved`, `geolocating`).
  onDestroy(hold());
  // kept in step by the module's nudges while it is shown, and only then
  onDestroy(holdSceneQueue());
  let mounted = null;
  $effect(() => {
    const id = caseId;
    void caseState.rev;
    if (!id) return;
    untrack(() => {
      reread(id, mounted === id);
      mounted = id;
    });
  });
  // What was unfolded or half-typed belonged to the case before.
  $effect(() => {
    void caseId;
    untrack(() => {
      all = false;
      leftOpen = false;
      stayed();
    });
  });

  const SEP = ' · ';
  const nameOf = queueName;
  const said = (scene) => queueState(scene, isLive(scene));
  /** The row's small print in pieces that each stay whole, so a narrow sidebar
   *  wraps it between them rather than cutting the capture count off. */
  const saidParts = (scene) => [
    ...(scene.label ? [{ text: queueTime(scene), time: !isPicture(scene) }] : []),
    ...said(scene).split(SEP).map((text) => ({ text, time: false })),
  ];
  /** The word a scene was abandoned with, if one was given. */
  const whyOf = (scene) => scene.abandoned?.reason ?? '';

  /** One press at a time; a refusal is said, and the queue read again. */
  async function act(run) {
    if (busy) return;
    busy = true;
    try {
      await run();
    } catch (e) {
      toast(e.message, 'warn');
      reread(caseId);
    } finally {
      busy = false;
    }
  }

  // Geolocate is a switch: pressed again on the scene in hand, it stops, the captures kept.
  const go = (scene) => act(() => (isLive(scene) ? stopGeolocating(caseId) : geolocateScene(caseId, scene)));

  function openInInspect(scene) {
    uiState.inspectScene = { video: scene.video, draft: scene.id };
    uiState.tool = 'inspect';
  }

  async function askWhy(scene) {
    leaving = keyOf(scene);
    reason = '';
    await tick();
    reasonInput?.focus();
  }

  function stayed() {
    leaving = null;
    reason = '';
  }

  function leave(event, scene) {
    event.preventDefault();
    const word = reason.trim();
    return act(async () => {
      await abandonScene(caseId, scene.video, scene.id, word);
      stayed();
    });
  }

  const restore = (scene) => act(() => restoreScene(caseId, scene.video, scene.id));
</script>

<!-- the scene as its video's bar draws it, in the colour Inspect gives it -->
{#snippet mark(scene)}
  {#if queueMark(scene)}<span class="mark {queueMark(scene)}" style:background={queueColor(scene)} aria-hidden="true"></span>{/if}
{/snippet}

{#snippet fileHead(file)}
  <span class="file-title" title={file.title}><Icon name={isPicture(file) ? 'image' : 'video'} size={11} /><span dir="auto">{file.title}</span></span>
{/snippet}

{#if open.length || left.length}
  <section class="geo" aria-label="To geolocate" data-guide="todo.geolocate">
    {#if open.length}
      <h4>To geolocate <span class="count">{total}</span></h4>
      {#each shown as file (file.video)}
        <div class="file">
          {@render fileHead(file)}
          <ul aria-label={file.title}>
            {#each file.scenes as scene (scene.id)}
              <li class="scene" class:live={isLive(scene)} class:progress={scene.state === 'progress'}>
                <span class="pip" aria-hidden="true"></span>
                <button type="button" class="open" title="Open in Inspect" onclick={() => openInInspect(scene)}>
                  <span class="name" dir="auto">{#if !scene.label}{@render mark(scene)}{/if}{nameOf(scene)}</span>
                  <span class="meta">{#each saidParts(scene) as part, i (i)}{#if i}{SEP}{/if}<span class="part" class:time={part.time}>{#if part.time}{@render mark(scene)}{/if}{part.text}</span>{/each}</span>
                </button>
                <button type="button" class="btn btn-ghost btn-sm why-btn" title="Abandon this scene" aria-label={`Abandon ${nameOf(scene)}`}
                  aria-expanded={leaving === keyOf(scene)} disabled={busy} onclick={() => (leaving === keyOf(scene) ? stayed() : askWhy(scene))}>
                  <Icon name="x" size={13} />
                </button>
                <button type="button" class="btn btn-xs go" class:on={isLive(scene)} disabled={busy} aria-pressed={isLive(scene)}
                  aria-label={isLive(scene) ? `Stop geolocating ${nameOf(scene)}` : `Geolocate ${nameOf(scene)}`}
                  title={isLive(scene) ? 'Stop geolocating it; its captures stay' : `Find it on the map, its ${isPicture(scene) ? 'picture' : 'video'} beside it`} onclick={() => go(scene)}>
                  {isLive(scene) ? 'Stop' : 'Geolocate'}
                </button>
              </li>
              {#if leaving === keyOf(scene)}
                <li class="why">
                  <form onsubmit={(event) => leave(event, scene)}>
                    <input class="input" aria-label="Why it is abandoned" placeholder="Why? (optional)" maxlength="200" dir="auto"
                      bind:value={reason} bind:this={reasonInput}
                      onkeydown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); stayed(); } }} />
                    <button class="btn btn-xs" disabled={busy}>Abandon</button>
                    <button type="button" class="btn btn-ghost btn-xs" onclick={stayed}>Cancel</button>
                  </form>
                </li>
              {/if}
            {/each}
          </ul>
        </div>
      {/each}
      {#if rest > 0}
        <button type="button" class="more" onclick={() => (all = true)}>{rest} more</button>
      {:else if all && total > SHOWN}
        <button type="button" class="more" onclick={() => (all = false)}>Show fewer</button>
      {/if}
    {/if}
    {#if left.length}
      <button type="button" class="fold" aria-expanded={leftOpen} onclick={() => (leftOpen = !leftOpen)}>
        <Icon name={leftOpen ? 'chevronDown' : 'chevronRight'} size={12} />Abandoned ({leftCount})
      </button>
      {#if leftOpen}
        {#each left as file (file.video)}
          <div class="file">
            {@render fileHead(file)}
            <ul aria-label={`Abandoned in ${file.title}`}>
              {#each file.scenes as scene (scene.id)}
                <li class="scene gone">
                  <span class="pip" aria-hidden="true"></span>
                  <button type="button" class="open" title="Open in Inspect" onclick={() => openInInspect(scene)}>
                    <span class="name" dir="auto">{#if !scene.label}{@render mark(scene)}{/if}{nameOf(scene)}</span>
                    <span class="meta">{#if scene.label}<span class="part" class:time={!isPicture(scene)}>{@render mark(scene)}{queueTime(scene)}</span>{/if}{#if scene.label && whyOf(scene)}{SEP}{/if}{#if whyOf(scene)}<q dir="auto">{whyOf(scene)}</q>{:else if !scene.label}Abandoned{/if}</span>
                  </button>
                  <button type="button" class="btn btn-ghost btn-xs" disabled={busy} aria-label={`Restore ${nameOf(scene)}`}
                    title="Back among the scenes to geolocate" onclick={() => restore(scene)}>Restore</button>
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      {/if}
    {/if}
  </section>
{:else if failed}
  <p class="geo-error" role="alert">
    The scenes to geolocate could not be read. <button type="button" class="btn btn-ghost btn-xs" onclick={() => reread(caseId)}>Retry</button>
  </p>
{/if}

<style>
  /* The "In the notes" vocabulary (NoteTasks.svelte): a small-caps heading, the
     file in small print, then flat rows with a hairline between them. */
  .geo { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
  h4 { margin: 0; display: flex; align-items: baseline; gap: 6px; color: var(--text-3); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .count { font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text-2); }
  .file { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .file-title { display: flex; align-items: center; gap: 5px; min-width: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .file-title :global(svg) { flex: none; }
  .file-title span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  ul { list-style: none; margin: 0; padding: 0; }

  .scene {
    display: flex; align-items: center; gap: 6px; padding: 3px 2px 3px 6px;
    border-bottom: 1px solid var(--border); border-left: 2px solid transparent;
    transition: background 0.14s var(--ease), border-color 0.14s var(--ease);
  }
  .scene:last-child { border-bottom: 0; }
  .scene:hover, .scene:focus-within { background: var(--bg-2); border-left-color: var(--border-strong); }
  .scene.live { border-left-color: var(--accent); background: var(--accent-soft); }

  /* To geolocate is an empty ring, In progress a ring with something in it, the
     scene being geolocated the solid amber; an abandoned one a dashed ring. */
  .pip { flex: none; width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid var(--text-3); box-sizing: border-box; }
  .progress .pip { border-color: var(--accent); background: radial-gradient(circle, var(--accent) 0 1.5px, transparent 2px); }
  .live .pip { border-color: var(--accent); background: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .gone .pip { border-style: dashed; }

  .open {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; padding: 2px 0;
    border: 0; background: none; color: inherit; font: inherit; text-align: start; cursor: pointer;
  }
  .name {
    display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
    overflow-wrap: anywhere; color: var(--text-1); font-size: var(--fs-sm); line-height: 1.35;
  }
  .open:hover .name { color: var(--accent); }
  .meta { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.3; overflow-wrap: anywhere; }
  .part { white-space: nowrap; }
  /* a word given on abandoning runs up to two hundred characters */
  .gone .meta { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden; }
  .time { font-variant-numeric: tabular-nums; color: var(--text-2); }
  .live .meta { color: var(--accent); }
  .gone .name { color: var(--text-3); }
  /* a band for a passage, a pin for an instant, as the bar draws them */
  .mark { display: inline-block; vertical-align: middle; margin: -2px 5px 0 0; border-radius: 2px; }
  .mark.passage { width: 11px; height: 5px; }
  .mark.instant { width: 3px; height: 10px; }
  .gone .mark { opacity: 0.45; }
  q { quotes: '“' '”'; font-style: italic; }

  .go { flex: none; }
  .scene:hover .go, .scene:focus-within .go, .live .go { border-color: var(--accent); }
  .go.on { background: var(--accent-soft); color: var(--accent); }
  .why-btn { flex: none; padding: 3px 4px; color: var(--text-3); opacity: 0; }
  .scene:hover .why-btn, .scene:focus-within .why-btn, .why-btn[aria-expanded='true'] { opacity: 1; }
  .why-btn:hover { color: var(--text-1); }
  @media (hover: none) { .why-btn { opacity: 1; } }

  .why { padding: 4px 2px 6px 16px; border-bottom: 1px solid var(--border); }
  .why form { display: flex; align-items: center; gap: 6px; }
  .why .input { flex: 1; min-width: 0; padding: 4px 8px; font-size: var(--fs-xs); }

  .more, .fold {
    align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; padding: 2px 0;
    border: 0; background: none; color: var(--text-3); font: inherit; font-size: var(--fs-xs); cursor: pointer;
  }
  .more { padding-left: 16px; }
  .more:hover, .fold:hover { color: var(--text-1); }
  .fold { margin-top: 2px; }
  .geo-error { margin: 0 0 10px; color: var(--danger); font-size: var(--fs-xs); }
</style>
