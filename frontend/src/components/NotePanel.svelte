<script>
  /**
   * The note in the extension's side panel (`lib/notes/panel.js`): the app's own note,
   * framed beside any site. Its bar picks the case and the note, and shows the note
   * or, in its place, the PDF it prints to (Write | Page, `NotePages`). What the
   * extension sends from a page (the page cited, a passage quoted, a capture) is put
   * in through the seam every tool uses (`putInNote`), so it lands with the same
   * light, toast and Undo; while the pages show, the text comes back first.
   *
   * Mounted in place of the app (`main.js`): a panel has no rail and no tools. The
   * extension names the case, else the one last open in the app; and the note, else
   * the one pinned to the side in the app, else Case notes. Another case picked in
   * the bar shows the note pinned for it the same way.
   *
   * The bar also holds the note's Look, set as the Notebook sets it, and Add: what the
   * browser tab in front can give (its map, its page, the words selected there), asked
   * of the extension when the menu opens and done by it, then a source to cite as the
   * note on the side offers. What the extension does comes back as a put.
   */
  import { flushSync, onDestroy, onMount, untrack } from 'svelte';
  import { fetchAllEntities } from '../lib/catalog.js';
  import { caseState, initSession, openCase, toast } from '../lib/state.svelte.js';
  import { loadEntityTypes } from '../lib/entityTypes.svelte.js';
  import { buildHash, splitHash } from '../lib/hash.js';
  import { CASE_NOTES, flush, openNote, releaseNote } from '../lib/notes/noteDoc.svelte.js';
  import { dockNote } from '../lib/notes/noteDock.svelte.js';
  import { keepPageView, readPageView } from '../lib/notes/pageView.js';
  import { pinNote, pinnedNote, putInNote } from '../lib/notes/putInNote.svelte.js';
  import { coverChoice, normaliseLook, ownCover, readLook, writeLook } from '../lib/notes/look.js';
  import { askTab, receivePuts, receiveTab, runTab, tellPanel } from '../lib/notes/panel.js';
  import { panelOffer } from '../lib/notes/panelPuts.js';
  import { quotePreview, tabHost } from '../lib/notes/panelTab.js';
  import AddSource from './AddSource.svelte';
  import CasePicker from './CasePicker.svelte';
  import FloatingMenu from './FloatingMenu.svelte';
  import Icon from './Icon.svelte';
  import NoteEditor from './NoteEditor.svelte';
  import NotePages from './NotePages.svelte';
  import NotePicker from './NotePicker.svelte';
  import NoteSaved from './NoteSaved.svelte';
  import Toasts from './Toasts.svelte';
  import LookControl from '../tools/notebook/LookControl.svelte';
  import ViewModes from '../tools/notebook/ViewModes.svelte';

  /** How long the Add menu waits for the extension to say what the tab is, before it offers to allow it. */
  const TAB_WAIT = 1000;
  const UNREAD = { access: 'closed', url: '', title: '', selection: '', post: false };

  const asked = splitHash(location.hash).params;

  let started = $state(false);
  let noteId = $state(null);
  let doc = $state(null);
  let editor = $state(null);
  let entities = $state([]);
  let picking = $state(null);
  let casing = $state(null);
  // the note's pages in place of its text, as last left in this browser
  let page = $state(readPageView('panel'));
  // how the note prints, as the Notebook keeps it: read with the note, set from the bar's Look
  let look = $state(null);
  let lookWrites = 0;
  // the Add menu: its opener, what the tab in front said (null until it does), and the source asked for
  let adding = $state(null);
  let sourcing = $state(null);
  let tab = $state(null);
  let waiting;

  const caseId = $derived(caseState.current?.id ?? '');
  const title = $derived(noteId ? entities.find((entity) => entity.id === noteId)?.label ?? 'Note' : 'Case notes');

  loadEntityTypes();
  initSession(asked.get('case') || null)
    .catch((error) => toast(`Could not open this case: ${error?.message ?? 'case not found'}`, 'danger', 8000))
    .finally(() => { started = true; });

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

  // The note asked for in the address, once its case is open. It names a note of the
  // case the panel opened on: another case picked since shows the note pinned for it.
  let askedNote = asked.get('note') ?? '';
  $effect(() => {
    const id = caseId;
    untrack(() => {
      if (!id) { if (doc) show('', null); return; }
      if (doc?.caseId === id) return;
      const note = askedNote;
      askedNote = '';
      show(id, note === CASE_NOTES ? null : note || dockNote(id));
    });
  });
  onDestroy(() => {
    clearTimeout(waiting);
    if (doc) void releaseNote(doc);
  });

  // the look of the note shown, read with it
  $effect(() => {
    const id = caseId;
    const key = noteId;
    look = null;
    if (!id || !doc) return;
    let live = true;
    untrack(() => readLook(id, key))
      .then((value) => { if (live) look = value; })
      .catch(() => { if (live) look = normaliseLook(null); });
    return () => { live = false; };
  });

  /** A look picked in the bar: shown at once, kept beside the note. */
  async function changeLook(next) {
    const id = caseId;
    const key = noteId;
    const mine = ++lookWrites;
    look = next;
    try {
      const saved = await writeLook(id, key, next);
      if (mine === lookWrites && id === caseId && noteId === key) look = saved;
    } catch (error) {
      toast(`Look not saved: ${error.message}`, 'danger');
    }
  }

  /** Turned to Your own page, a note with no cover gets one at its top, so what page 1 prints is there to write. */
  function pickLook(next) {
    if (coverChoice(next) === 'own' && coverChoice(look) !== 'own') editor?.cover();
    void changeLook(next);
  }

  /** `/` › Cover page wrote the page: the look prints it alone on page 1. */
  function coverWritten() {
    if (look && coverChoice(look) !== 'own') void changeLook(ownCover(look));
  }

  function show(id, note) {
    const previous = doc;
    doc = id ? openNote(id, note) : null;
    noteId = id ? note ?? null : null;
    editor = null;
    if (previous) void releaseNote(previous);
    if (id) keepPlace(id, noteId);
  }

  /** The note shown, in the address, so a reload of the panel opens it again. Not a step Back retraces. */
  function keepPlace(id, note) {
    const params = splitHash(location.hash).params;
    params.set('case', id);
    params.set('note', note ?? CASE_NOTES);
    history.replaceState(history.state, '', `${location.pathname}${location.search}${buildHash('notebook', params)}`);
  }

  function pick(id) {
    picking = null;
    if (caseId) show(caseId, id && id !== CASE_NOTES ? id : null);
  }

  /** Another case, in place: the note shown is written first, then the case opened shows its own. */
  async function pickCase(id) {
    casing = null;
    if (!id || id === caseId) return;
    const leaving = doc;
    try {
      if (leaving) await flush(leaving);
      if (leaving?.saveError) {
        toast(`The note is not saved, so this case stays open: ${leaving.saveError}`, 'danger', 8000);
        return;
      }
      await openCase(id);
    } catch (error) {
      toast(`Could not open this case: ${error?.message ?? 'case not found'}`, 'danger', 8000);
    }
  }

  function setPage(on) {
    page = on;
    keepPageView('panel', on);
  }

  /** Back to the text, drawn before what lands in it or is gone to there. */
  function toWrite() {
    if (!page) return;
    setPage(false);
    flushSync();
  }

  function jump(line) {
    toWrite();
    editor?.jump(line);
  }

  // this note is the one a put from the extension writes to
  $effect(() => {
    if (!caseId || !doc || !editor) return;
    return pinNote({ caseId, noteId, title, editor });
  });

  // What the panel holds, said to the extension's page: a note once it can be written
  // to, none without a case. Nothing while a note is still being read.
  const holding = $derived.by(() => {
    if (!started) return undefined;
    if (!caseId || !doc || doc.error) return null;
    if (!doc.loaded || !editor) return undefined;
    return { caseId, noteId, title };
  });
  let told = '';
  $effect(() => {
    const note = holding;
    if (note === undefined) return;
    const said = JSON.stringify(note);
    if (said === told) return;
    told = said;
    tellPanel(note);
  });

  onMount(() => {
    const gone = () => tellPanel(null);
    window.addEventListener('pagehide', gone);
    const stop = receivePuts(put);
    const stopTab = receiveTab((said) => {
      clearTimeout(waiting);
      tab = said;
    });
    return () => {
      window.removeEventListener('pagehide', gone);
      stop();
      stopTab();
    };
  });

  // whether the page in front is a map the extension can capture: the extension asks the app's own map sites
  const isMap = $derived(tab?.access === 'open' && tab.map === true);
  const host = $derived(tab?.access === 'open' ? tabHost(tab.url) : '');

  /** Open the Add menu, and ask what the tab in front is. No answer in time leaves the first part offering to allow it. */
  function openAdding(anchor) {
    if (adding) { closeAdding(); return; }
    sourcing = null;
    tab = null;
    adding = anchor;
    askTab();
    clearTimeout(waiting);
    waiting = setTimeout(() => { if (tab === null) tab = UNREAD; }, TAB_WAIT);
  }

  function closeAdding() {
    clearTimeout(waiting);
    adding = null;
  }

  /** An item of the tab's part: the extension does it, and what it brings comes back as a put. */
  function fromTab(action) {
    runTab(action);
    closeAdding();
  }

  function askSource() {
    const anchor = adding;
    closeAdding();
    sourcing = anchor;
  }

  /** What a source asked for here is put in as every tool's offer is. */
  function addSource(offer) {
    sourcing = null;
    void putInNote(offer);
  }

  /**
   * The case's records read again, before what was filed for a put lands, so its chip
   * or picture is drawn at once. Read here rather than on the case's reload, which
   * would draw the note again after the picture's caption field opened, and close it.
   */
  async function refresh() {
    const id = caseId;
    const list = await fetchAllEntities(id);
    if (id === caseId) entities = list;
  }

  /** A put from the extension, made here and put in the note shown: `{ ok, error? }`. */
  async function put(sent) {
    const id = caseId;
    if (!id || !pinnedNote()) return { ok: false, error: 'No note is open in the panel' };
    // its banner offers Edit here, which takes it back
    if (doc?.elsewhere) return { ok: false, error: 'This note is open in another tab' };
    const offer = panelOffer(id, sent, { reload: refresh });
    let problem = '';
    const landed = await putInNote({
      ...offer,
      put: async (options) => {
        try {
          return await offer.put(options);
        } catch (error) {
          problem = error?.message ?? '';
          throw error;
        }
      },
    });
    return landed ? { ok: true } : { ok: false, error: problem || 'Nothing was put in the note' };
  }

  /** A chip pressed in the panel opens what it cites on the web, when it is a page. */
  function openSource(entity) {
    const address = [entity?.attrs?.url, entity?.attrs?.source_url].find((value) => typeof value === 'string' && /^https?:\/\//i.test(value));
    if (address) window.open(address, '_blank', 'noopener');
  }
</script>

<div class="note-panel">
  {#if caseId && doc}
    <header class="panel-bar">
      <button type="button" class="case" title="Pick the case shown here" aria-haspopup="menu"
        onclick={(event) => { picking = null; casing = casing ? null : event.currentTarget; }}>
        <span>{caseState.current?.name}</span><Icon name="chevronDown" size={11} />
      </button>
      <span class="slash" aria-hidden="true">/</span>
      <button type="button" class="which" title="Pick the note shown here" aria-haspopup="menu"
        onclick={(event) => { casing = null; picking = picking ? null : event.currentTarget; }}>
        <span>{title}</span><Icon name="chevronDown" size={12} />
      </button>
      <span class="spacer"></span>
      <NoteSaved {doc} />
      <LookControl {look} onchange={pickLook} {entities} disabled={!look} />
      <ViewModes {page} inPlace onchange={setPage} />
      <button type="button" class="btn btn-ghost btn-sm add" title="Add from the tab in front, or cite a source" aria-haspopup="menu"
        aria-label="Add" aria-expanded={Boolean(adding)} onclick={(event) => openAdding(event.currentTarget)}>
        <Icon name="plus" size={14} /><span>Add</span></button>
    </header>
    <NotePages {page} {caseId} {noteId} {title} {doc} {entities} {look} onjump={jump}>
      {#key doc}
        <NoteEditor {doc} {caseId} {entities} compact tools={false} onopen={openSource} onnote={pick} oncover={coverWritten}
          onready={(handle) => (editor = handle)} onarrive={toWrite} placeholder="Write as you read. Type @ to cite, / for more." />
      {/key}
    </NotePages>
  {:else if started}
    <p class="none"><Icon name="note" size={28} />
      <span>Open a case in Azimut, or pick one in the extension's map panel, then open the note again.</span></p>
  {/if}
</div>

{#if picking}
  <NotePicker {caseId} anchor={picking} current={noteId} onpick={pick} onclose={() => (picking = null)} />
{/if}

{#if casing}
  <CasePicker anchor={casing} current={caseId} onpick={pickCase} onclose={() => (casing = null)} />
{/if}

{#if adding}
  <FloatingMenu anchor={adding} width={260} align="end" label="Add to this note" onclose={closeAdding}>
    {#if tab === null}
      <p class="fm-note" role="status">Reading the tab…</p>
    {:else if tab.access === 'open'}
      <div class="fm-head">From this tab{host ? ` · ${host}` : ''}</div>
      {#if isMap}
        <button type="button" class="fm-item" role="menuitem" title="Capture this map as a picture: draw its area on the page" onclick={() => fromTab('capture')}>
          <Icon name="camera" size={13} /><span class="fm-grow">This map<small>Draw the area to capture</small></span></button>
      {/if}
      <button type="button" class="fm-item" role="menuitem" title={tab.post ? 'Cite this post in the note' : 'Cite this page in the note'} onclick={() => fromTab('cite')}>
        <Icon name="link" size={13} /><span class="fm-grow">{tab.post ? 'This post' : 'This page'}<small>{host}</small></span></button>
      <button type="button" class="fm-item" role="menuitem" disabled={!tab.selection}
        title={tab.selection ? 'Quote the words selected, linked to the passage' : 'Select words on the page to quote them'} onclick={() => fromTab('quote')}>
        <Icon name="quote" size={13} /><span class="fm-grow">The passage selected<small>{tab.selection ? quotePreview(tab.selection) : 'Select words on the page to quote them'}</small></span></button>
    {:else if tab.access === 'closed'}
      <div class="fm-head">From this tab</div>
      <button type="button" class="fm-item" role="menuitem" title="Asked once: Azimut reads a page only when you add from it" onclick={() => fromTab('allow')}>
        <Icon name="unlock" size={13} /><span class="fm-grow">Allow Azimut on this tab…<small>Asked once: Azimut reads a page only when you add from it</small></span></button>
    {:else}
      <p class="fm-note">Nothing to add from this tab</p>
    {/if}
    <div class="fm-sep" role="separator"></div>
    <button type="button" class="fm-item" role="menuitem" title="Cite a web page or a post, found in the case or kept" onclick={askSource}>
      <Icon name="link" size={13} /><span class="fm-grow">A source…</span></button>
  </FloatingMenu>
{/if}

{#if sourcing}
  <AddSource {caseId} anchor={sourcing} onpick={addSource} onclose={() => (sourcing = null)} />
{/if}

<Toasts />

<style>
  .note-panel { height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--bg-1); container-type: inline-size; }
  .panel-bar {
    display: flex; align-items: center; gap: 4px; min-height: 38px; padding: 4px 10px; border-bottom: 1px solid var(--border);
  }
  .case, .which {
    display: inline-flex; align-items: center; min-width: 0; padding: 4px 6px; border: none; border-radius: var(--r-sm);
    background: none; font: inherit; font-size: var(--fs-sm); cursor: pointer;
  }
  .case { flex: 0 1 auto; max-width: 40%; gap: 3px; color: var(--text-3); }
  .which { gap: 6px; color: var(--text-1); font-weight: 600; }
  .case span, .which span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .case :global(svg), .which :global(svg) { flex: none; }
  .case:hover, .which:hover { background: var(--bg-3); }
  .case:hover { color: var(--text-1); }
  .slash { flex: none; color: var(--text-3); }
  .spacer { flex: 1; }
  .add { display: inline-flex; align-items: center; gap: 4px; flex: none; }
  /* narrow: the case and the note keep their room; Add is its plus, Look its brush */
  @container (max-width: 440px) { .panel-bar :global(.look-open .current) { display: none; } }
  @container (max-width: 400px) { .add span { display: none; } }
  @container (max-width: 340px) { .panel-bar { gap: 2px; padding-left: 6px; padding-right: 6px; } .panel-bar :global(.look-open .word) { display: none; } }
  /* two lines to an item of the tab's part: what it does, then what it holds */
  .fm-grow small { display: block; margin-top: 1px; color: var(--text-3); font-size: 11px; line-height: 1.3; white-space: normal; overflow-wrap: anywhere; }
  .none {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; height: 100%; margin: 0;
    padding: 0 28px; color: var(--text-3); text-align: center; line-height: 1.5;
  }
</style>
