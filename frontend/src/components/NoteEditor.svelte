<script>
  /**
   * One note, written in place (`lib/notes/liveMarkdown.js`), on the shared copy
   * of it (`lib/notes/noteDoc.svelte.js`). The Notebook shows it wide, the panel
   * beside the tools `compact`.
   *
   * `where` names the editor to `lib/notes/noteDock.svelte.js`, so "Cite in note"
   * from Details lands at this cursor while it is the one being written in.
   *
   * A note can include another as a chapter (`/` Include a note); `notes` are the
   * case's notes as the home lists them, which a chapter is drawn from. A
   * `template` is written with guidance lines of its own and no chapters.
   *
   * Without `tools` around it (the note in the extension's panel), a picture offers
   * no Open in… and a coordinate no way to the map, since there is none to open.
   *
   * `/` › Cover page writes the first page at the top and turns Look › Cover to
   * Your own page: through `oncover` where a Look is shown, else here, beside the
   * note. The picture picker offers the app's logo, the analyst's and their
   * signature beside the case's pictures (`lib/notes/reportParts.js`).
   */
  import { onDestroy, onMount, untrack } from 'svelte';
  import { Compartment, EditorState } from '@codemirror/state';
  import { EditorView } from '@codemirror/view';
  import { api } from '../lib/api.js';
  import { toast, reloadCase, prefs } from '../lib/state.svelte.js';
  import { foldText } from '../lib/textFold.js';
  import { mediaReference, entityReference, remoteImageUrls } from '../lib/markdown.js';
  import { createBookmark } from '../lib/bookmarks.js';
  import { openerFor } from '../lib/notes/openers.js';
  import '../lib/notes/openersLoaded.js';
  import { canStateSourceOf, lookupSource, stateSourceOf } from '../lib/notes/sources.js';
  import { gotoPoint } from '../lib/navigate.js';
  import { droppedMedia, carriesMedia } from '../lib/drag.js';
  import { CALLOUTS, calloutMarkdown } from '../lib/notes/callouts.js';
  import { uploadedImage } from '../lib/notes/syntax.js';
  import { BUILT_IN_PICTURES, builtInLine } from '../lib/notes/reportParts.js';
  import { ownCover, readLook, writeLook } from '../lib/notes/look.js';
  import { differing, editNote, takeBack } from '../lib/notes/noteDoc.svelte.js';
  import { offerWriter } from '../lib/notes/noteDock.svelte.js';
  import {
    captionAt, heldRange, holdRange, insertAtCursor, insertCover, insertInclude, jumpToLine, noteExtensions, placeText, releaseRange,
    resizePicture, setLinePrefix, setNoteCase, takeBackRange, toggleWrap,
  } from '../lib/notes/liveMarkdown.js';
  import { startCompletion } from '@codemirror/autocomplete';
  import Icon from './Icon.svelte';
  import FloatingMenu from './FloatingMenu.svelte';
  import Modal from './Modal.svelte';
  import SearchInput from './SearchInput.svelte';

  let {
    doc,
    caseId,
    entities = [],
    redirects = {},
    compact = false,
    where = '',
    placeholder = 'Write here. Type @ to cite something from the case, / to add a heading, a task, a picture or a diagram.',
    onopen = () => {},
    onready = () => {},
    /** Who keeps the text, when it is not a note (a template being edited from Settings). */
    onchange = null,
    /** The case's notes, as `notes/index` lists them: what a chapter shows and what Include offers. */
    notes = [],
    /** Open a note by its id (`case` for the case notes), from a chapter's Open. */
    onnote = null,
    template = false,
    /** Whether the app's tools are around the note, to open what it cites in. */
    tools = true,
    /** Called just before text from outside lands (a put, a citation, text that waited), so a surface showing its pages shows the text. */
    onarrive = () => {},
    /** Turn Look › Cover to Your own page, once `/` › Cover page wrote one; null to have the editor write the look itself. */
    oncover = null,
  } = $props();

  let host = $state(null);
  let view = null;
  const editable = new Compartment();
  let calloutAnchor = $state(null);
  let pictureOpen = $state(false);
  let pictureQuery = $state('');
  let picker = $state(null);
  let uploading = $state(false);
  let including = $state(false);
  let includeQuery = $state('');
  let fetchedNotes = $state(null);

  /** Whether this editor was written in since it opened: a put lands at its cursor then, at the end else. */
  let wrote = false;
  const readOnly = $derived(Boolean(doc?.elsewhere) || !doc?.loaded || Boolean(doc?.error));
  const remote = $derived(doc?.loaded ? remoteImageUrls(doc.text) : []);
  /** What the picture picker lists: the case's pictures, and its proofs, which print as one. */
  const PICTURE_TYPES = new Set(['media', 'capture', 'proof']);
  const pictures = $derived(entities
    .filter((entity) => PICTURE_TYPES.has(entity.type) && entity.attrs?.path)
    .filter((entity) => foldText(`${entity.label} ${entity.attrs?.folder ?? ''}`).includes(foldText(pictureQuery.trim())))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(0, 80));
  /** Who signs, as Settings › Publishing keeps it: what `{name}` shows, and whether the logo and the signature are set. */
  const identity = $derived({
    name: prefs.reportName, role: prefs.reportRole, organisation: prefs.reportOrganisation,
    logo: prefs.logoSet, signature: prefs.signatureSet, rev: prefs.picturesRev,
  });
  const BUILT_IN_ICONS = { logo: 'brand', 'my-logo': 'image', 'my-signature': 'edit' };
  /** The three pictures of the app's, beside the case's, found by the same words. */
  const builtIns = $derived(BUILT_IN_PICTURES
    .filter((picture) => foldText(picture.label).includes(foldText(pictureQuery.trim())))
    .map((picture) => ({ ...picture, missing: Boolean(picture.setting) && !identity[picture.setting] })));

  // what Include offers: every note of the case but this one
  const ownId = $derived(doc?.noteId ?? 'case');
  const includable = $derived((notes.length ? notes : fetchedNotes ?? [])
    .filter((row) => row.id !== ownId)
    .filter((row) => foldText(`${row.title} ${row.folder ?? ''}`).includes(foldText(includeQuery.trim()))));

  const handlers = {
    change: (text) => {
      if (onchange) onchange(text);
      else if (doc) editNote(doc, text);
    },
    open: (entity) => onopen(entity),
    note: (id) => {
      if (onnote) onnote(id);
      else {
        const entity = entities.find((item) => item.id === id);
        if (entity) onopen(entity);
      }
    },
    include: () => openIncludes(),
    get point() { return tools ? gotoPoint : null; },
    picture: () => { pictureOpen = true; },
    cover: () => writeCover(),
    upload: () => picker?.click(),
    image: (file) => upload(file),
    url: (url, from, to) => offerBookmark(url, from, to),
    media: (event, at) => dropMedia(event, at),
    opener: (entity) => (template || !tools ? null : openerFor(entity)),
    sourceable: (entity) => (template || !caseId ? false : canStateSourceOf(caseId, entity)),
    stateSource: (entity, url) => stateSourceOf(caseId, entity, url),
  };

  onMount(() => {
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: doc?.text ?? '',
        extensions: noteExtensions({ handlers, placeholder, readOnly, editable, template }),
      }),
    });
    view.dispatch({ effects: setNoteCase.of({ caseId, entities, redirects, notes, identity }) });
    view.contentDOM.addEventListener('focus', () => { wrote = true; });
    onready(api_);
  });
  onDestroy(() => {
    view?.destroy();
    view = null;
  });

  // The text changed outside this editor: read from disk, ticked from the To-do, appended,
  // or typed in the other editor showing the same note. Only the stretch that differs is
  // replaced, so the cursor and the drawing stay where they were.
  $effect(() => {
    const text = doc?.text ?? '';
    if (!view || !doc?.loaded) return;
    untrack(() => {
      const change = differing(view.state.doc.toString(), text);
      if (change) view.dispatch({ changes: change });
    });
  });
  $effect(() => {
    const info = { caseId, entities, redirects, notes, identity };
    if (view) view.dispatch({ effects: setNoteCase.of(info) });
  });
  $effect(() => {
    const locked = readOnly;
    if (view) view.dispatch({ effects: editable.reconfigure([EditorState.readOnly.of(locked), EditorView.editable.of(!locked)]) });
  });
  $effect(() => {
    if (!where || !doc) return;
    return offerWriter(where, (text) => arrive(text));
  });

  /** What the Notebook and the panel drive this editor with. */
  const api_ = {
    insert: (text, options) => arrive(text, options),
    jump: (line) => view && jumpToLine(view, line),
    /** Size, place or caption a picture from the Page pane: its line there, what it shows, `{ width }`, `{ align }` or `{ caption }`. */
    resize: (line, ref, changes) => Boolean(view && !readOnly && resizePicture(view, line, ref, changes)),
    focus: () => view?.focus(),
    // -- what a tool puts in the note (`lib/notes/putInNote.svelte.js`) --
    /** Whether the editor is still on screen. */
    alive: () => Boolean(view),
    /** Hold where a put lands: the cursor when the note was written in this visit, its end else. Null when it cannot be written. */
    spot: () => {
      if (!view || readOnly) return null;
      return holdRange(view, wrote ? view.state.selection.main.head : view.state.doc.length);
    },
    release: (spot) => view && releaseRange(view, spot),
    /** Put `text` where `spot` now is, light it, and answer what landed for Undo. */
    place: (spot, text, options) => {
      if (!view || readOnly) return null;
      onarrive();
      if (!view) return null;
      const held = heldRange(view, spot);
      releaseRange(view, spot);
      return held ? placeText(view, held.from, text, options) : null;
    },
    /** Open the caption of the picture that just landed. */
    caption: (landed, options) => {
      const held = view && landed ? heldRange(view, landed.id) : null;
      return held ? captionAt(view, held.from + (landed.text.length - landed.text.replace(/^\n+/, '').length), options) : Promise.resolve(false);
    },
    takeBack: (landed) => Boolean(view && takeBackRange(view, landed)),
    /** Write the cover page at the top, unless there is one: Look › Cover was turned to Your own page. */
    cover: () => Boolean(view && !readOnly && insertCover(view, { focus: false })),
  };

  /** `/` › Cover page: the page at the top, and the look that prints it alone on page 1. */
  async function writeCover() {
    if (!view || readOnly) return;
    insertCover(view);
    if (oncover) { oncover(); return; }
    if (!caseId || !doc || template) return;
    try {
      const noteId = doc.noteId ?? null;
      await writeLook(caseId, noteId, ownCover(await readLook(caseId, noteId)));
    } catch (error) {
      toast(`Look not saved: ${error.message}`, 'warn');
    }
  }

  /** Text from outside the editor, at its cursor: the surface shows the text first. */
  function arrive(text, options) {
    if (!view || readOnly) return;
    onarrive();
    insert(text, options);
  }

  function insert(text, { block } = {}) {
    if (!view || readOnly) return;
    insertAtCursor(view, text, { block: block ?? text.startsWith('[[media:') });
  }

  function wrap(mark) { if (view && !readOnly) toggleWrap(view, mark); }
  function prefix(value) { if (view && !readOnly) setLinePrefix(view, value); }
  function cite() {
    if (!view || readOnly) return;
    insertAtCursor(view, '@');
    // the space insertAtCursor adds after a chip has no place after a bare @
    const head = view.state.selection.main.head;
    if (view.state.sliceDoc(head - 1, head) === ' ') view.dispatch({ changes: { from: head - 1, to: head }, selection: { anchor: head - 1 } });
    startCompletion(view);
  }
  function slash() {
    if (!view || readOnly) return;
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    const lead = line.text.slice(0, head - line.from).trim() ? ' /' : '/';
    view.dispatch({ changes: { from: head, insert: lead }, selection: { anchor: head + lead.length } });
    view.focus();
    startCompletion(view);
  }
  function callout(kind) {
    calloutAnchor = null;
    prefix(`${calloutMarkdown(kind)}`);
  }

  /** The note picker. The Notebook hands its list over; the panel beside the tools asks for one. */
  function openIncludes() {
    includeQuery = '';
    including = true;
    if (!notes.length && caseId) {
      api.get(`/api/cases/${caseId}/notes/index`)
        .then((result) => { fetchedNotes = result.items ?? []; })
        .catch((error) => toast(`Could not list the notes: ${error.message}`, 'warn'));
    }
  }

  function pickInclude(row) {
    including = false;
    if (view && !readOnly) insertInclude(view, row.id);
  }

  function pickBuiltIn(picture) {
    pictureOpen = false;
    pictureQuery = '';
    insert(builtInLine(picture.id), { block: true });
  }

  function pickPicture(entity) {
    pictureOpen = false;
    pictureQuery = '';
    insert(entity.attrs?.kind === 'video' ? entityReference(entity) : mediaReference(entity), { block: entity.attrs?.kind !== 'video' });
  }

  async function upload(file) {
    if (!file || !file.type?.startsWith('image/') || uploading) return;
    uploading = true;
    try {
      const form = new FormData();
      form.append('file', file, file.name || 'pasted-image.png');
      const result = await api.post(`/api/cases/${caseId}/media/upload`, form);
      await reloadCase();
      insert(uploadedImage(caseId, result.item, result.entity), { block: true });
      toast(result.duplicate ? 'Image linked from case media' : 'Image added to case media', 'ok', 1800);
    } catch (error) {
      toast(`Image not added: ${error.message}`, 'danger');
    } finally {
      uploading = false;
    }
  }

  function chosenFile(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) upload(file);
  }

  /**
   * A pasted link, looked up in the case: an item already filed for it is offered to
   * cite in its place, else a bookmark named from the address. Nothing is fetched.
   */
  async function offerBookmark(url, from, to) {
    let answer = null;
    try {
      answer = await lookupSource(caseId, url);
    } catch { /* named from its address below, as before the case could be asked */ }
    const swap = (entity) => {
      if (view && view.state.sliceDoc(from, to) === url) {
        view.dispatch({ changes: { from, to, insert: entityReference(entity) } });
      } else insert(entityReference(entity));
    };
    const [found] = answer?.found ?? [];
    if (found) {
      toast(`Already in the case as “${found.label}”`, 'info', 6000, { label: 'Cite it', onClick: () => swap(found) });
      return;
    }
    let title = answer?.title || url;
    if (!answer) {
      try {
        const parsed = new URL(url);
        title = `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname === '/' ? '' : parsed.pathname}`.slice(0, 120);
      } catch { /* the address itself */ }
    }
    toast('Link pasted', 'info', 6000, {
      label: 'Bookmark it',
      onClick: async () => {
        try {
          const entity = await createBookmark(caseId, { title, url });
          await reloadCase();
          swap(entity);
          toast(`Bookmark “${title}” filed`, 'ok', 2200);
        } catch (error) {
          toast(error.message, 'danger');
        }
      },
    });
  }

  /** Files dragged from the media library land as pictures where they are dropped. */
  function dropMedia(event, at) {
    if (!carriesMedia(event)) return false;
    const dropped = droppedMedia(event);
    const byPath = new Map(entities.filter((entity) => entity.attrs?.path).map((entity) => [entity.attrs.path, entity]));
    const found = dropped.map((item) => byPath.get(item.attrs.path)).filter(Boolean);
    if (!found.length || !view) return false;
    view.dispatch({ selection: { anchor: at } });
    for (const entity of found) insert(entity.attrs?.kind === 'video' ? entityReference(entity) : mediaReference(entity), { block: true });
    return true;
  }
</script>

<div class="note-editor" class:compact>
  <div class="toolbar" role="toolbar" aria-label="Formatting" data-guide="notebook.toolbar">
    <button type="button" class="tb" title="Heading" aria-label="Heading" disabled={readOnly} onclick={() => prefix('## ')}>H</button>
    <button type="button" class="tb strong" title="Bold (Ctrl+B)" aria-label="Bold" disabled={readOnly} onclick={() => wrap('**')}>B</button>
    <button type="button" class="tb em" title="Italic (Ctrl+I)" aria-label="Italic" disabled={readOnly} onclick={() => wrap('*')}>I</button>
    <span class="rule" role="presentation"></span>
    <button type="button" class="tb" title="Bulleted list" aria-label="Bulleted list" disabled={readOnly} onclick={() => prefix('- ')}><Icon name="list" size={14} /></button>
    <button type="button" class="tb" title="To-do" aria-label="To-do" disabled={readOnly} onclick={() => prefix('- [ ] ')}><Icon name="check" size={14} /></button>
    <button type="button" class="tb" title="Callout: confirmed, unverified, lead…" aria-label="Callout" aria-haspopup="menu"
      disabled={readOnly} onclick={(event) => (calloutAnchor = calloutAnchor ? null : event.currentTarget)}><Icon name="quote" size={14} /></button>
    <span class="rule" role="presentation"></span>
    <button type="button" class="tb" title="Cite a case item (@)" aria-label="Cite a case item" disabled={readOnly} onclick={cite} data-guide="notebook.cite"><Icon name="at" size={14} /></button>
    <button type="button" class="tb" title="Put in a case picture" aria-label="Put in a case picture" class:on={pictureOpen} disabled={readOnly}
      onclick={() => (pictureOpen = !pictureOpen)}><Icon name="image" size={14} /></button>
    <button type="button" class="tb" title="More: table, diagram, log entry… (/)" aria-label="More blocks" disabled={readOnly} onclick={slash}><Icon name="plus" size={14} /></button>
    {#if uploading}<span class="busy">Adding the image…</span>{/if}
    <input type="file" accept="image/*" hidden bind:this={picker} onchange={chosenFile} />
    {#if pictureOpen}
      <div class="picture-menu" role="dialog" aria-label="Case pictures">
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input" bind:value={pictureQuery} placeholder="Find a picture…" autofocus
          onkeydown={(event) => { if (event.key === 'Escape') pictureOpen = false; }} />
        <div class="picture-list">
          {#each builtIns as picture (picture.id)}
            <button type="button" class="picture-row built-in" title={picture.missing ? picture.unset : 'From this computer, never a case file'}
              onclick={() => pickBuiltIn(picture)}>
              <Icon name={BUILT_IN_ICONS[picture.id]} size={13} /><span>{picture.label}</span>
              {#if picture.missing}<small>Not set</small>{/if}
            </button>
          {/each}
          {#if builtIns.length && pictures.length}<div class="picture-sep" role="presentation"></div>{/if}
          {#each pictures as entity (entity.id)}
            <button type="button" class="picture-row" onclick={() => pickPicture(entity)}>
              <Icon name={entity.attrs?.kind === 'video' ? 'video' : 'image'} size={13} /><span>{entity.label}</span>
              {#if entity.attrs?.folder}<small>{entity.attrs.folder}</small>{/if}
            </button>
          {/each}
          {#if !pictures.length && !builtIns.length}<p class="none">No matching picture.</p>{/if}
        </div>
        <button type="button" class="btn btn-ghost btn-sm" onclick={() => { pictureOpen = false; picker?.click(); }}>
          <Icon name="upload" size={13} /> From a file</button>
      </div>
    {/if}
  </div>

  {#if doc?.elsewhere}
    <div class="banner">
      <Icon name="external" size={13} /><span>Open in another tab, so it is read-only here.</span>
      <button type="button" class="btn btn-sm" onclick={() => takeBack(doc)}>Edit here</button>
    </div>
  {:else if doc?.error}
    <div class="banner warn"><Icon name="alert" size={13} /><span>Could not open this note: {doc.error}</span></div>
  {:else if remote.length}
    <div class="banner warn" title={remote.join('\n')}>
      <Icon name="alert" size={13} />
      <span>{remote.length === 1 ? 'An image here comes' : `${remote.length} images here come`} from the web, so its host is contacted each time the note opens.</span>
    </div>
  {/if}

  <div class="page" bind:this={host} data-guide="notebook.write"></div>
</div>

{#if including}
  <Modal title="Include a note" onclose={() => { including = false; view?.focus(); }} width="520px" align="top">
    <p class="include-said">It prints as a chapter, in this note's look.</p>
    <SearchInput bind:value={includeQuery} placeholder="Find a note…" width="100%" />
    <div class="include-list">
      {#each includable as row (row.id)}
        <button type="button" class="include-row" onclick={() => pickInclude(row)}>
          <span class="include-name"><Icon name="note" size={13} /> {row.title}{#if row.folder}<small>{row.folder}</small>{/if}</span>
          {#if row.excerpt}<span class="include-excerpt">{row.excerpt}</span>{/if}
        </button>
      {/each}
      {#if !includable.length}<p class="none">{fetchedNotes === null && !notes.length ? 'Reading the notes…' : 'No other note to include.'}</p>{/if}
    </div>
  </Modal>
{/if}

{#if calloutAnchor}
  <FloatingMenu anchor={calloutAnchor} width={300} label="Callouts" onclose={() => (calloutAnchor = null)}>
    {#each CALLOUTS as item (item.kind)}
      <button type="button" class="fm-item" onclick={() => callout(item.kind)}>
        <span class="swatch" style:background={item.colour}></span><span class="fm-grow">{item.label}</span><small>{item.hint}</small>
      </button>
    {/each}
  </FloatingMenu>
{/if}

<style>
  .note-editor { display: flex; flex-direction: column; min-height: 0; height: 100%; position: relative; }
  .toolbar {
    display: flex; align-items: center; gap: 2px; padding: 4px 10px; border-bottom: 1px solid var(--border);
    position: relative; flex-wrap: wrap; background: var(--bg-1);
  }
  .note-editor:not(.compact) .toolbar { justify-content: center; }
  .tb {
    min-width: 28px; height: 26px; border: 1px solid transparent; border-radius: var(--r-sm); background: none;
    color: var(--text-2); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; font: inherit;
    font-size: var(--fs-sm);
  }
  .tb:hover:not(:disabled) { background: var(--bg-3); color: var(--text-1); }
  .tb.on { color: var(--accent); border-color: var(--border); }
  .tb:disabled { opacity: 0.4; cursor: default; }
  .tb.strong { font-weight: 700; }
  .tb.em { font-style: italic; font-family: var(--font-sans); }
  .rule { width: 1px; height: 16px; background: var(--border); margin: 0 4px; }
  .busy { margin-left: 8px; color: var(--text-3); font-size: var(--fs-xs); }
  .picture-menu {
    position: absolute; top: calc(100% + 4px); z-index: 30; width: min(340px, 90vw); left: 50%; transform: translateX(-50%);
    background: var(--bg-2); border: 1px solid var(--border-strong); border-radius: var(--r-lg); box-shadow: var(--shadow-2);
    padding: 8px; display: flex; flex-direction: column; gap: 6px;
  }
  .compact .picture-menu { left: 8px; transform: none; }
  .picture-list { max-height: 260px; overflow: auto; display: flex; flex-direction: column; }
  .picture-row {
    display: flex; align-items: center; gap: 8px; padding: 5px 6px; border: none; background: none; color: var(--text-1);
    text-align: left; cursor: pointer; border-radius: var(--r-sm); font: inherit; font-size: var(--fs-sm);
  }
  .picture-row:hover { background: var(--bg-3); }
  .picture-row span { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .picture-row small, .none { color: var(--text-3); font-size: var(--fs-xs); }
  .picture-sep { height: 1px; margin: 4px 2px; background: var(--border); flex: none; }
  /* the app's logo prints dark on the white page: on the dark theme the editor draws it light */
  :global(:root:not([data-theme='light']) .cm-block img.builtin-logo) { filter: invert(1) hue-rotate(180deg); }
  /* the analyst's logo and signature are of any colour, dark ink most often: drawn on the paper they print on */
  :global(:root:not([data-theme='light']) .cm-block img:is(.builtin-my-logo, .builtin-my-signature)) {
    background: #fff; padding: 6px; border-radius: 4px; box-sizing: border-box;
  }
  .banner {
    display: flex; align-items: center; gap: 8px; padding: 6px 14px; font-size: var(--fs-sm); color: var(--text-2);
    background: var(--info-soft); border-bottom: 1px solid var(--border);
  }
  .banner.warn { background: color-mix(in srgb, var(--warn) 12%, transparent); }
  .banner span { flex: 1; }
  .page { flex: 1; min-height: 0; overflow: hidden; }
  .page :global(.cm-editor) { height: 100%; }
  .compact .page { --note-pad: 14px 0 30vh; --note-gutter: 14px; --note-size: 14px; --note-width: none; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; flex: none; }
  .include-said { margin: 0 0 10px; color: var(--text-3); font-size: var(--fs-xs); }
  .include-list { display: flex; flex-direction: column; gap: 2px; max-height: 340px; overflow: auto; margin-top: 8px; }
  .include-row {
    display: flex; flex-direction: column; gap: 2px; padding: 7px 8px; border: none; border-radius: var(--r-sm); background: none;
    color: var(--text-1); text-align: left; cursor: pointer; font: inherit; font-size: var(--fs-sm);
  }
  .include-row:hover, .include-row:focus-visible { background: var(--bg-3); }
  .include-name { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; }
  .include-name small { font-weight: 400; margin-left: 4px; }
  .include-excerpt { color: var(--text-2); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  small { color: var(--text-3); font-size: var(--fs-xs); }
</style>
