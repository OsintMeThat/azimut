<script>
  /**
   * The links the case proposed by itself, read and settled in one list.
   *
   * Who posted a file is written in its address, and two points a few hundred metres
   * apart are usually one site, so the case files those as proposals
   * (`engine/proposals.py`) instead of waiting for somebody to type them. This is where
   * they are confirmed or dropped, one line each, without hunting dashed edges across a
   * drawing. A dropped proposal does not come back.
   *
   * The pass runs by itself after an import; **Find links** runs it now, which is what a
   * case filed before this existed needs once. It is offered only until the case has been
   * read, since after that every import reads it again and the count is the only news.
   */
  import Icon from './Icon.svelte';
  import { api } from '../lib/api.js';
  import { closeOnOutsidePointer } from '../lib/dismiss.js';
  import { isTopOverlay, joinOverlays } from '../lib/overlayStack.js';
  import { filedWords, proposalSentence, waitingCount } from '../lib/proposalReview.js';
  import { caseState, reloadCase, toast, uiState } from '../lib/state.svelte.js';

  let { caseId } = $props();

  let data = $state(null);
  let open = $state(false);
  let busy = $state(false);
  let box = $state(null);

  $effect(() => {
    const id = caseId;
    void caseState.rev;
    if (!id) return;
    let live = true;
    api
      .get(`/api/cases/${id}/proposals`)
      .then((answer) => live && (data = answer))
      .catch(() => live && (data = null));
    return () => (live = false);
  });

  $effect(() => (open && box ? closeOnOutsidePointer(box, () => (open = false)) : undefined));

  // Escape closes it like every other panel, and only when nothing sits above it.
  const self = {};
  $effect(() => (open ? joinOverlays(self) : undefined));
  function onkeydown(e) {
    if (open && e.key === 'Escape' && isTopOverlay(self)) open = false;
  }

  const waiting = $derived(waitingCount(data?.pending));
  /** Never read for links yet: a case filed before the pass existed. */
  const unread = $derived(Boolean(data) && !data.through);

  async function look() {
    if (busy || !caseId) return;
    busy = true;
    try {
      const answer = await api.post(`/api/cases/${caseId}/proposals`, {});
      data = answer;
      toast(filedWords(answer.filed));
      if (waitingCount(answer.pending)) open = true;
      await reloadCase();
    } catch (error) {
      toast(error.message || 'The case could not be read for links.', 'danger');
    } finally {
      busy = false;
    }
  }

  async function confirm(item) {
    if (busy) return;
    busy = true;
    try {
      await api.patch(`/api/cases/${caseId}/links/${item.id}`, { status: 'confirmed' });
      data = await api.get(`/api/cases/${caseId}/proposals`);
      await reloadCase();
    } catch (error) {
      toast(error.message || 'This link could not be confirmed.', 'danger');
    } finally {
      busy = false;
    }
  }

  async function drop(item) {
    if (busy) return;
    busy = true;
    try {
      data = await api.del(`/api/cases/${caseId}/proposals/${item.id}`);
      await reloadCase();
    } catch (error) {
      toast(error.message || 'This link could not be dropped.', 'danger');
    } finally {
      busy = false;
    }
  }

  function show(item) {
    uiState.openGraphEntity = item.to.id;
  }
</script>

<svelte:window {onkeydown} />

<div class="review" bind:this={box}>
  {#if waiting}
    <button class="count proposed" class:on={open} aria-expanded={open}
            title="Links the case proposed by itself, to confirm or drop"
            onclick={() => (open = !open)}>
      {waiting} proposed
    </button>
  {:else if unread}
    <button class="btn btn-ghost btn-sm" disabled={busy || !caseId} onclick={look}
            title="Read who posted each file and which points share a site">
      <Icon name="link" size={13} /> {busy ? 'Looking' : 'Find links'}
    </button>
  {/if}

  {#if open}
    <div class="panel card" role="dialog" aria-label="Proposed links">
      <div class="head">
        <strong>Proposed links</strong>
        <button class="btn btn-ghost btn-xs" disabled={busy} onclick={look}>Look again</button>
      </div>
      <p class="note">
        Who posted a file, read off its address, and points under {data?.radius ?? 300} m
        apart. Confirm what holds and drop the rest.
      </p>
      <ul>
        {#each data?.items ?? [] as item (item.id)}
          <li>
            <button class="say" onclick={() => show(item)} title="Show it in the graph">
              {proposalSentence(item)}
            </button>
            <button class="btn btn-ghost btn-xs" disabled={busy} onclick={() => confirm(item)}>
              Confirm
            </button>
            <button class="btn btn-ghost btn-xs" disabled={busy} onclick={() => drop(item)}>
              Drop
            </button>
          </li>
        {:else}
          <li class="note">Nothing left to review.</li>
        {/each}
      </ul>
      {#if waiting > (data?.listed ?? 0)}
        <p class="note">The first {data.listed} of {waiting}. Settling these brings up the rest.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .review { position: relative; display: inline-flex; }
  .count {
    font-size: var(--fs-xs); padding: 2px 8px; border-radius: 999px;
    border: 1px solid var(--accent); color: var(--accent); background: var(--accent-soft);
  }
  .count.on { background: var(--accent); color: var(--bg-1); }
  .panel {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: 40;
    width: min(460px, 90vw); max-height: 60vh; overflow: auto; padding: 10px 12px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .head strong { font-size: var(--fs-sm); }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
  li { display: flex; align-items: center; gap: 4px; }
  .say {
    flex: 1; min-width: 0; text-align: left; padding: 3px 4px; border-radius: var(--r-sm);
    color: var(--text-1); font-size: var(--fs-xs);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .say:hover { background: var(--bg-2); }
  .note { color: var(--text-3); font-size: var(--fs-xs); line-height: 1.5; margin: 0; }
</style>
