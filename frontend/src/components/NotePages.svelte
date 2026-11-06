<script>
  /**
   * A note in a narrow place (the note on the side, the extension's panel): its
   * text, the editor given as `children`, or with `page` the PDF it prints to in
   * its place (`tools/notebook/PagePane.svelte`), in the look the Notebook gave it.
   *
   * The editor stays mounted under the pages, hidden and out of reach, so Write
   * finds it as it was left: its cursor, its scroll, its Undo. The pages are only
   * there while they are shown: Write lets go of the PDF and its canvases, and draws
   * and asks for nothing. A press on a page or a warning hands its line to `onjump`.
   *
   * The pictures' size marks are left out: on a page this narrow their bar does not fit.
   *
   * The look is read here each time the pages are shown, unless the surface keeps it
   * (`look`, where it sets it from a Look beside the note): null while that surface
   * reads it, which draws nothing yet.
   */
  import { untrack } from 'svelte';
  import { CASE_NOTES } from '../lib/notes/noteDoc.svelte.js';
  import { normaliseLook, readLook } from '../lib/notes/look.js';
  import PagePane from '../tools/notebook/PagePane.svelte';

  let { page = false, caseId, noteId = null, title = '', doc, entities = [], look: kept = undefined, onjump = () => {}, children } = $props();

  // how the note prints, read each time its pages are shown
  let read = $state(null);
  const look = $derived(kept !== undefined ? kept : read);
  $effect(() => {
    const id = caseId;
    const note = noteId;
    read = null;
    if (!page || !id || untrack(() => kept !== undefined)) return;
    let live = true;
    untrack(() => readLook(id, note))
      .then((value) => { if (live) read = value; })
      .catch(() => { if (live) read = normaliseLook(null); });
    return () => { live = false; };
  });
</script>

<div class="note-pages">
  <div class="writing" class:away={page} inert={page}>{@render children?.()}</div>
  {#if page}
    <div class="pages">
      {#if look && doc?.loaded}
        <PagePane {caseId} note={noteId ?? CASE_NOTES} {title} text={doc.text} {look} {entities} {onjump} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .note-pages { flex: 1; min-height: 0; display: grid; grid-template: minmax(0, 1fr) / minmax(0, 1fr); }
  .writing, .pages { grid-area: 1 / 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .writing > :global(.note-editor) { flex: 1; }
  /* laid out still, so its scroll is kept for Write */
  .writing.away { visibility: hidden; }
  .pages { background: var(--bg-0); }
  .pages > :global(.page-pane) { flex: 1; border-left: none; }
</style>
