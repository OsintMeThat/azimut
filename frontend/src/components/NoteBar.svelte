<script>
  /**
   * Add an event from wherever the analyst is: one line, anchored over the bottom of
   * the tool on screen.
   *
   * Nothing is visible until it is asked for, by the pencil in the topbar or Alt+N;
   * no tool gains a button of its own (D19). What the tool is looking at is already
   * seated (`lib/noteHere.svelte.js`): the video playing cites itself, and its one
   * confirmed place is where it happened. The date stays empty (D3), with the file's
   * own dates said beside it. It closes after Add, on Escape, and when the analyst
   * moves to another tool, since what it seated belonged to this one.
   */
  import { tick } from 'svelte';
  import { api } from '../lib/api.js';
  import { caseState, uiState } from '../lib/state.svelte.js';
  import { noteDatesFor, noteEntityFor, placeOf } from '../lib/noteHere.svelte.js';
  import { portal } from '../lib/fullscreen.js';
  import { isTopOverlay, joinOverlays } from '../lib/overlayStack.js';
  import { claimActionTitle } from '../lib/quickClaim.js';
  import EntryLine, { claimSeat } from './EntryLine.svelte';
  import Icon from './Icon.svelte';

  let line = $state(null);
  let also = $state([]);

  const caseId = $derived(caseState.current?.id ?? '');
  const entity = $derived(uiState.noting ? noteEntityFor(uiState.tool) : null);
  const dates = $derived(uiState.noting ? noteDatesFor(uiState.tool) : []);
  const seat = $derived(entity ? claimSeat(entity) : null);
  /** How the thing on screen sits on the event, in the heading's words. */
  const SEAT_WORDS = { about: 'about', at: 'at', cites: 'seen in' };
  const about = $derived(seat ? SEAT_WORDS[seat.slot] ?? '' : '');

  function close() {
    uiState.noting = false;
  }

  // What was seated belonged to the tool it was opened over.
  let openedOn = null;
  $effect(() => {
    const tool = uiState.tool;
    if (!uiState.noting) {
      openedOn = null;
      return;
    }
    if (openedOn && openedOn !== tool) close();
    else openedOn = tool;
  });

  // A file's one confirmed place is seated beside it, read off its chain.
  $effect(() => {
    const id = entity?.id;
    also = [];
    if (!id || !caseId || !['media', 'capture', 'proof'].includes(entity.type)) return;
    let live = true;
    api.get(`/api/cases/${caseId}/entities/${id}/chain`)
      .then((chain) => {
        const place = placeOf(chain);
        if (live && place) also = [place];
      })
      .catch(() => {});
    return () => { live = false; };
  });

  // Straight to the sentence, which is what the press was for.
  $effect(() => {
    if (!uiState.noting) return;
    entity?.id;
    void tick().then(() => line?.focus?.());
  });

  // Over the tool's own overlays too (a file's Details, the lightbox), since that is
  // where a file is watched; so it takes its turn in the Escape order like a modal.
  const self = {};
  $effect(() => (uiState.noting ? joinOverlays(self) : undefined));

  function onkeydown(event) {
    if (event.key !== 'Escape' || event.defaultPrevented || !isTopOverlay(self)) return;
    event.preventDefault();
    close();
  }
</script>

{#if uiState.noting && caseId}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div class="note-bar" use:portal role="dialog" aria-modal="false" aria-label="Add an event" tabindex="-1" {onkeydown}>
    <header>
      <Icon name="edit" size={13} />
      <strong>Add an event</strong>
      {#if entity && seat}
        <span class="about" title={claimActionTitle(seat.slot)}>
          {about} <bdi>{entity.label}</bdi>
        </span>
      {/if}
      <span class="keys">Enter adds · Esc closes</span>
      <button class="btn btn-ghost btn-sm" aria-label="Close" title="Close (Esc)" onclick={close}>
        <Icon name="x" size={13} />
      </button>
    </header>
    {#key `${uiState.tool}:${entity?.id ?? ''}`}
      <EntryLine
        bind:this={line}
        {caseId}
        {entity}
        {also}
        {dates}
        draftKey={`note:${uiState.tool}:${entity?.id ?? ''}`}
        onsaved={close}
        oncancel={close}
      />
    {/key}
  </div>
{/if}

<style>
  /* Over the bottom of the screen, above the tool's own overlays (a modal is 900, the
     lightbox 950) and under the topbar and the toasts, and wide enough for the line to
     sit on one row where it can. */
  .note-bar {
    position: fixed;
    left: calc(50% + var(--rail-w) / 2);
    bottom: 20px;
    z-index: 960;
    width: min(920px, calc(100vw - var(--rail-w) - 48px));
    transform: translateX(-50%);
    display: grid;
    gap: 8px;
    padding: 10px 12px 12px;
    border: 1px solid var(--border-strong);
    border-radius: var(--r-lg);
    background: var(--bg-1);
    box-shadow: var(--shadow-2);
    animation: rise 140ms var(--ease);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translate(-50%, 8px);
    }
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--text-3);
    font-size: var(--fs-xs);
  }
  header strong {
    color: var(--text-1);
    font-weight: 600;
  }
  .about {
    overflow: hidden;
    color: var(--text-2);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .keys {
    margin-left: auto;
    white-space: nowrap;
  }
</style>
