<script>
  /**
   * A note beside whatever tool is open (`lib/notes/noteDock.svelte.js`).
   *
   * The same copy of the note the Notebook writes, so typing here and there is
   * one note. Its bar picks which note, opens it in the Notebook or in a tab of its
   * own, and holds the note's "+": what the tool on screen can put in it, in one
   * order everywhere (cite what it shows, its own offers, a source).
   *
   * While it is open it is the pinned note (`lib/notes/putInNote.svelte.js`), the
   * one every tool's `Put in “…”` names and writes to.
   */
  import { onDestroy, untrack } from 'svelte';
  import { fetchAllEntities } from '../lib/catalog.js';
  import { caseState, uiState, toast } from '../lib/state.svelte.js';
  import { buildHash } from '../lib/hash.js';
  import { noteEntityFor, putsFor } from '../lib/noteHere.svelte.js';
  import { pinNote, putInNote } from '../lib/notes/putInNote.svelte.js';
  import { openEntity, openNotebook } from '../lib/navigate.js';
  import { citation } from '../lib/notes/syntax.js';
  import { CASE_NOTES, flush, openNote, releaseNote } from '../lib/notes/noteDoc.svelte.js';
  import { dockNote, dockWidth, firstOpening, noteDock, setDockNote, setDockOpen, takePending } from '../lib/notes/noteDock.svelte.js';
  import Icon from './Icon.svelte';
  import NoteEditor from './NoteEditor.svelte';
  import PanelEdge from './PanelEdge.svelte';
  import NotePicker from './NotePicker.svelte';
  import FloatingMenu from './FloatingMenu.svelte';
  import AddSource from './AddSource.svelte';

  const caseId = $derived(caseState.current?.id ?? '');
  let noteId = $state(null);
  let doc = $state(null);
  let editor = $state(null);
  let entities = $state([]);
  let picking = $state(null);
  /** The "+" menu: its anchor and what the tool on screen offered when it opened. */
  let adding = $state(null);
  let sourcing = $state(null);
  // the first time it opens, the panel says what it is for and how it comes back
  let told = $state(firstOpening());

  $effect(() => {
    const id = caseId;
    caseState.rev;
    if (!id) {
      entities = [];
      return;
    }
    let live = true;
    fetchAllEntities(id).then((list) => { if (live) entities = list; }).catch(() => {});
    return () => { live = false; };
  });

  // the note follows the case, and a pick made from the Notebook or a menu
  $effect(() => {
    const id = caseId;
    const picked = noteDock.noteFor;
    untrack(() => {
      const wanted = picked?.caseId === id ? picked.noteId : dockNote(id);
      if (!id) { show(null, null); return; }
      if (!doc || doc.caseId !== id || (doc.noteId ?? null) !== (wanted ?? null)) show(id, wanted);
    });
  });
  onDestroy(() => { if (doc) void releaseNote(doc); });

  function show(id, wanted) {
    const previous = doc;
    doc = id ? openNote(id, wanted) : null;
    noteId = wanted ?? null;
    editor = null;
    if (previous) void releaseNote(previous);
  }

  // text sent here before the editor was there (a citation that opened the panel)
  $effect(() => {
    if (!editor || !doc?.loaded || !noteDock.pending) return;
    const text = takePending();
    queueMicrotask(() => editor?.insert(text));
  });

  const title = $derived(noteId ? entities.find((entity) => entity.id === noteId)?.label ?? 'Note' : 'Case notes');
  const here = $derived(noteEntityFor(uiState.tool));

  // this note is the one every tool's "Put in" writes to while the panel shows it
  $effect(() => {
    if (!caseId || !doc || !editor) return;
    return pinNote({ caseId, noteId, title, editor });
  });

  /** The most of a tool's own offers the "+" lists, so it stays a short menu. */
  const MOST_OFFERS = 4;

  function pick(id) {
    picking = null;
    setDockNote(caseId, id);
  }

  function openAdding(anchor) {
    if (adding) { adding = null; return; }
    sourcing = null;
    adding = { anchor, here, offers: putsFor(uiState.tool).slice(0, MOST_OFFERS) };
  }

  function put(offer) {
    adding = null;
    sourcing = null;
    void putInNote(offer);
  }

  function citeHere(entity) {
    const text = citation(entity);
    const picture = text.startsWith('[[media:');
    put({ id: 'cite', label: 'Cite', picture, put: async () => ({ text, inline: !picture }) });
  }

  function askSource() {
    const anchor = adding?.anchor;
    adding = null;
    sourcing = anchor ?? null;
  }

  async function inNotebook() {
    if (doc) await flush(doc);
    setDockOpen(false);
    openNotebook(noteId);
  }

  async function ownTab() {
    const tab = window.open('', '_blank');
    if (!tab) { toast('The browser refused a new tab. Allow pop-ups for this page', 'warn', 8000); return; }
    if (doc) await flush(doc);
    tab.location.href = `${location.pathname}${location.search}${buildHash('notebook', { case: caseId, note: noteId ?? CASE_NOTES, solo: '1' })}`;
    setDockOpen(false);
  }

  const saveSaid = $derived(!doc?.loaded ? '' : doc.saveError ? 'Not saved' : doc.saving || !doc.saved ? 'Saving…' : 'Saved');
</script>

{#if caseId && doc}
  <aside class="note-dock" style:width="{noteDock.width}px" aria-label="Note on the side" data-guide="notes.dock">
    <PanelEdge bind:width={noteDock.width} helpers={dockWidth} side="left" label="Resize the note" />
    <header class="dock-bar">
      <button type="button" class="which" title="Pick the note shown here" aria-haspopup="menu"
        onclick={(event) => (picking = picking ? null : event.currentTarget)}>
        <Icon name="note" size={14} /><span>{title}</span><Icon name="chevronDown" size={12} />
      </button>
      <span class="said" class:error={doc.saveError}>{saveSaid}</span>
      <div class="spacer"></div>
      <button type="button" class="btn btn-ghost btn-sm add" title="Put what is on screen in this note, or cite a source" aria-haspopup="menu"
        aria-expanded={Boolean(adding)} data-guide="notes.add" onclick={(event) => openAdding(event.currentTarget)}>
        <Icon name="plus" size={14} /><span>Add</span></button>
      <button type="button" class="btn btn-ghost btn-sm" title="Open in the Notebook" aria-label="Open in the Notebook" onclick={inNotebook}>
        <Icon name="maximize" size={14} /></button>
      <button type="button" class="btn btn-ghost btn-sm" title="Open in its own tab, for another screen" aria-label="Open in its own tab" onclick={ownTab}>
        <Icon name="external" size={14} /></button>
      <button type="button" class="btn btn-ghost btn-sm" title="Close the note" aria-label="Close the note" onclick={() => setDockOpen(false)}>
        <Icon name="x" size={14} /></button>
    </header>
    {#if told}
      <p class="told">It stays open as you switch tools. Notes in the sidebar brings it back.
        <button type="button" class="btn btn-ghost btn-sm" aria-label="Got it" title="Got it" onclick={() => (told = false)}><Icon name="x" size={12} /></button></p>
    {/if}
    {#key doc}
      <NoteEditor {doc} {caseId} {entities} compact where="dock" onopen={openEntity} onready={(handle) => (editor = handle)}
        placeholder="Write as you look. Type @ to cite, / for more." />
    {/key}
  </aside>

  {#if picking}
    <NotePicker {caseId} anchor={picking} current={noteId} onpick={pick} onclose={() => (picking = null)} />
  {/if}

  {#if adding}
    {@const menu = adding}
    <FloatingMenu anchor={menu.anchor} width={260} align="end" label="Add to this note" onclose={() => (adding = null)}>
      {#if menu.here}
        <button type="button" class="fm-item" role="menuitem" title="Cite what this tool is showing" onclick={() => citeHere(menu.here)}>
          <Icon name="at" size={13} /><span class="fm-grow">Cite “{menu.here.label}”</span></button>
      {/if}
      {#each menu.offers as offer (offer.id)}
        <button type="button" class="fm-item" role="menuitem" title={offer.hint} onclick={() => put(offer)}>
          <Icon name={offer.icon || 'plus'} size={13} /><span class="fm-grow">{offer.label}</span></button>
      {/each}
      {#if menu.here || menu.offers.length}<div class="fm-sep" role="separator"></div>{/if}
      <button type="button" class="fm-item" role="menuitem" title="Cite a web page or a post, found in the case or kept" onclick={askSource}>
        <Icon name="link" size={13} /><span class="fm-grow">A source…</span></button>
    </FloatingMenu>
  {/if}

  {#if sourcing}
    <AddSource {caseId} anchor={sourcing} onpick={put} onclose={() => (sourcing = null)} />
  {/if}
{/if}

<style>
  .note-dock {
    position: relative; flex: none; display: flex; flex-direction: column; min-height: 0;
    border-left: 1px solid var(--border); background: var(--bg-1);
  }
  .dock-bar { display: flex; align-items: center; gap: 4px; padding: 4px 6px 4px 10px; border-bottom: 1px solid var(--border); min-height: 38px; }
  .which {
    display: inline-flex; align-items: center; gap: 6px; border: none; background: none; color: var(--text-1); font: inherit;
    font-weight: 600; font-size: var(--fs-sm); cursor: pointer; padding: 4px 6px; border-radius: var(--r-sm); min-width: 0;
  }
  .which span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 170px; }
  .which:hover { background: var(--bg-3); }
  .said { color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap; }
  .said.error { color: var(--danger); }
  .spacer { flex: 1; }
  .add { display: inline-flex; align-items: center; gap: 4px; }
  .note-dock > :global(.note-editor) { flex: 1; }
  .told {
    display: flex; align-items: center; gap: 6px; margin: 0; padding: 6px 6px 6px 12px; border-bottom: 1px solid var(--border);
    background: var(--bg-2); color: var(--text-2); font-size: var(--fs-xs); line-height: 1.4;
  }
  .told .btn { flex: none; margin-left: auto; }
</style>
