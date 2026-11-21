<script>
  /**
   * The Notebook: the case's notes on a home of cards, and one note open at a time,
   * written in place (`components/NoteEditor.svelte`).
   *
   * A note opened here is the same copy the panel beside the tools and a tab of its
   * own show (`lib/notes/noteDoc.svelte.js`), so it can be put beside a map, sent
   * to another screen, and come back without two copies writing over each other.
   * A note template from Settings is edited here too, as a plate template is in
   * the Map plate.
   *
   * A note prints in a look of its own (`lib/notes/look.js`), set from the header
   * and kept beside it, never in its Markdown; the Page pane shows the PDF it
   * makes as the note is typed. The home picks several notes at once, to export
   * them or to make a report that includes them as chapters.
   *
   * The export dialog opens at once and asks the server what the files would warn
   * about (`lib/notes/warnings.js`). What it finds is listed before anything is
   * written, each with a way to the line it is about; a check that fails says
   * nothing and never holds the export back. It writes a PDF or one HTML page per
   * note (`lib/notes/formats.js`); for HTML the check also says what the file would
   * weigh, which clips go out as a link, and where a filmer stood, which can be
   * rounded for that file. When a note picked holds an internal passage, the dialog
   * asks which edition to write, Internal or Public, the choice kept per note
   * (`lib/notes/editions.svelte.js`). Every export is a new file, and a note's ⋯
   * lists its editions, each with Show and Check; a public HTML page after an earlier
   * one asks what changed, which it prints at its end. The editions' What changed
   * compares two public texts and drafts that line, which waits in the field.
   *
   * A web folder is the public edition as a folder to put online (`engine/notes_web.py`):
   * the dialog asks the address it will live at, kept per note (`lib/notes/webAddress.js`),
   * which gives X its picture card, and once written offers Open the folder and How to
   * publish (`lib/githubPagesSetup.js`). With GitHub Pages set up in Settings, the
   * address is the site's own plus a short name, and **Publish to GitHub Pages** beside
   * the export puts the folder online in one commit, then watches the page being built
   * until it is live (`notebook/GitHubPublish.svelte`, `notebook/GitHubLive.svelte`).
   * A WordPress draft has its own branch.
   *
   * **Archive every link…**, on the check's line of links with no archived copy and in a
   * note's ⋯, opens `notebook/ArchiveLinks.svelte`: one press sends the note's outside
   * links to the Internet Archive while the header says how far it got; the check
   * counts them again once the dialog closes or the run ends.
   *
   * **Ready to publish?** gathers what the check before export says of one note in one
   * panel (`notebook/ReadyPanel.svelte`, `lib/notes/readyPanel.js`), grouped, each line
   * with its own fix where one exists. The open note's header shows how many lines are
   * to look at, read once the note opens and again a while after typing stops, in the
   * format and edition the export would write; the export dialog of one note links to it
   * at its top. Each fix is the action that exists elsewhere, one Undo step where it
   * writes in the note, and the panel asks the check again after it.
   *
   * To Post, in the open note's ⋯, opens Post on a Free post thread made of the note's
   * public edition, or of the stretch selected in it (`lib/notes/toPost.js`); nothing is
   * posted from here.
   */
  import { onDestroy, untrack } from 'svelte';
  import { api } from '../lib/api.js';
  import { fetchAllEntities } from '../lib/catalog.js';
  import { offerNote, withdrawNote } from '../lib/noteHere.svelte.js';
  import { onBackForward, settlePlace } from '../lib/backButton.js';
  import { buildHash, readSolo, splitHash } from '../lib/hash.js';
  import {
    caseState, uiState, toast, reloadCase, templatesState, saveTemplate, loadTemplates,
  } from '../lib/state.svelte.js';
  import { createNote, deleteNote, resetCaseNotes } from '../lib/notes.js';
  import {
    coverChoice, isPlainLook, normaliseLook, ownCover, readLook, reportBody, reportLook, styleLabel, templateLook, writeLook,
  } from '../lib/notes/look.js';
  import { keepPageView, readPageView } from '../lib/notes/pageView.js';
  import { exportNotes, revealExports } from '../lib/notesExport.js';
  import { checkNotes, isLeftOut, isNoAddress, jumpFor } from '../lib/notes/warnings.js';
  import {
    HTML, HTML_BUDGET, PDF, PUBLIC_ONLY, WEB, WORDPRESS, keepFormat, readFormat, weightWords,
  } from '../lib/notes/formats.js';
  import {
    correctionFor, editionOf, editionOfAll, keepCorrection, keepEdition, listEditions, PUBLIC, showEdition,
  } from '../lib/notes/editions.svelte.js';
  import { badgeWords, checkReady, issueCount, readyLines, runFix } from '../lib/notes/readyPanel.js';
  import { bookmarkLinks } from '../lib/notes/sources.js';
  import { addressProblem, keepAddress, readAddress } from '../lib/notes/webAddress.js';
  import { LOOK_HELP } from '../lib/notes/lookHelp.js';
  import { destinationLabel, readDestinations } from '../lib/exportDest.js';
  import { assignFolder, renameEntity } from '../lib/filing.js';
  import { openEntity } from '../lib/navigate.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import { CASE_NOTES, flush, noteReady, openNote, releaseNote, retrySave } from '../lib/notes/noteDoc.svelte.js';
  import { openInDock } from '../lib/notes/noteDock.svelte.js';
  import { READY_NOTES, filledBody, freeTitle } from '../lib/notes/ready.js';
  import Icon from '../components/Icon.svelte';
  import BackButton from '../components/BackButton.svelte';
  import NoteEditor from '../components/NoteEditor.svelte';
  import NotesHome from './notebook/NotesHome.svelte';
  import NewNoteDialog from './notebook/NewNoteDialog.svelte';
  import { makeWebMap } from '../lib/notes/webMap.js';
  import LookControl from './notebook/LookControl.svelte';
  import PagePane from './notebook/PagePane.svelte';
  import InfographicBuilder from './notebook/InfographicBuilder.svelte';
  import ViewModes from './notebook/ViewModes.svelte';
  import EditionSwitch from './notebook/EditionSwitch.svelte';
  import FormatSwitch from './notebook/FormatSwitch.svelte';
  import EditionsDialog from './notebook/EditionsDialog.svelte';
  import PublishSteps from './notebook/PublishSteps.svelte';
  import LinkList from './notebook/LinkList.svelte';
  import ArchiveLinks from './notebook/ArchiveLinks.svelte';
  import { followed, isActive, onEnded, progressWords, readPlan } from '../lib/notes/linkArchive.svelte.js';
  import ReadyPanel from './notebook/ReadyPanel.svelte';
  import ToPostItem from './notebook/ToPostItem.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import WordPressDraft from './notebook/WordPressDraft.svelte';
  import GitHubPublish from './notebook/GitHubPublish.svelte';
  import GitHubLive from './notebook/GitHubLive.svelte';
  import ExportFolderPicker from '../components/ExportFolderPicker.svelte';
  import FloatingMenu from '../components/FloatingMenu.svelte';
  import Modal from '../components/Modal.svelte';
  import FolderSelect from '../components/FolderSelect.svelte';
  import NoCase from '../components/NoCase.svelte';

  /** The note on screen: `{ noteId }`, null for the case notes; or null for the home. */
  let opened = $state(null);
  let doc = $state(null);
  let editor = $state(null);
  // the stretch selected in the note, which To Post sends in its place: { from, to } or null
  let noteSelection = $state(null);
  let pendingLine = $state(null);
  /** How the line asked for is gone to (`editor.jump`'s options): a warning's lands under a heading. */
  let pendingJump = {};
  let rows = $state([]);
  let rowsLoading = $state(false);
  let titleField = $state('');
  let titleInput = $state(null);
  let folderField = $state('');
  let menu = $state(null); // { row, anchor } for a card's ⋯, or { anchor } for the open note's
  let noteModal = $state(null); // the New note dialog: { start }
  let noteAction = $state(null);
  let noteActionBusy = $state(false);
  let naming = $state(null); // keep as template: { value }
  let exportOpen = $state(false);
  let exportIds = $state([]);
  let exportBusy = $state(false);
  let exportDir = $state('');
  let exportPicker = $state(false);
  // what the export would warn about: null, { checking: true }, or { found: [...], internal } by note
  let exportCheck = $state(null);
  // the edition the export writes, internal or public
  let exportEdition = $state('internal');
  // what it writes, a PDF or an HTML page, as last picked in this browser
  let exportFormat = $state(readFormat('export'));
  // an HTML page's points of view rounded to about 150 m, in that file only
  let roundPov = $state(false);
  /** A web folder's maps kept as the HTML page draws them, rather than live over OpenFreeMap once online. */
  let offlineMaps = $state(false);
  // what changed since an earlier public edition, printed at the page's end
  let exportChanges = $state('');
  // the address a web folder will live at, kept per note, and whether it was typed in this dialog
  let webAddress = $state('');
  let webAddressTyped = false;
  // the web folders written, which the dialog stays open on: { written, path }
  let webDone = $state(null);
  let stepsOpen = $state(false);
  // the note whose editions are listed: { noteId, title }
  let editionsOf = $state(null);
  // the note whose links are being archived, in the dialog: { noteId, title }
  let archiveOf = $state(null);
  // Ready to publish?: the panel open on { noteId, title, fromExport }, what its check said, and the fix under way
  let readyOf = $state(null);
  let readyAnswer = $state(null);
  let readyChecking = $state(false);
  let readyFailed = $state('');
  let readyBusy = $state('');
  let readyController = null;
  // the open note's badge: how many lines the panel would list, for the note it was read for
  let readyBadge = $state(null);
  let badgeTimer;
  let badgeController = null;
  // the note whose next export rounds its points of view, pressed from the panel
  let roundNext = $state('');
  let checkController = null;
  // the WordPress branch of the dialog: its Send, and what WordPress answered
  let wordpressDraft = $state(null);
  let draftBusy = $state(false);
  let draftReady = $state(false);
  let draftSent = $state(null);
  // GitHub Pages, in the Web folder branch: its Publish, and the page once published
  let githubPublish = $state(null);
  let githubSet = $state(false);
  let githubProblem = $state('');
  let githubBusy = $state(false);
  let githubDone = $state(null);
  // the notes picked on the home, in the order they were picked
  let selected = $state([]);
  // the PDF beside the note, as the analyst last left it
  let pageMode = $state(readPageView('notebook'));
  // the infographic builder beside the note: `{ from, panel, noteId }` while it is open, null else
  let builder = $state(null);
  $effect(() => { if (builder && builder.noteId !== (opened?.noteId ?? null)) builder = null; });
  // how the open note prints, null while it is read
  let look = $state(null);
  let lookWrites = 0;
  // a template from Settings, edited in place of a note
  let template = $state(null);
  let templateDoc = $state(null);
  let templateTimer;

  const caseId = $derived(caseState.current?.id ?? '');

  // Every record of the case: what `@` offers, what a chip is drawn from.
  let graphEntities = $state([]);
  let referenceRedirects = $state({});
  $effect(() => {
    const id = caseId;
    caseState.rev;
    if (!id) {
      graphEntities = [];
      return;
    }
    let live = true;
    fetchAllEntities(id)
      .then((list) => { if (live) graphEntities = list; })
      .catch(() => { if (live) graphEntities = []; });
    return () => { live = false; };
  });
  // a record merged into another since a note cited it is drawn as the one it became
  $effect(() => {
    const id = caseId;
    const text = doc?.text ?? '';
    caseState.rev;
    const ids = [...new Set([...text.matchAll(/\[\[entity:([A-Za-z0-9_-]+)\|/g)].map((match) => match[1]))];
    if (!id || !ids.length) {
      referenceRedirects = {};
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api.post(`/api/cases/${id}/entities/redirects`, { ids: ids.slice(0, 2000) })
        .then((result) => { if (live) referenceRedirects = result.redirects ?? {}; })
        .catch(() => {});
    }, 400);
    return () => { live = false; clearTimeout(timer); };
  });

  const noteEntities = $derived(graphEntities.filter((entity) => entity.type === 'note'));
  const noteEntity = $derived(opened?.noteId ? noteEntities.find((entity) => entity.id === opened.noteId) ?? null : null);

  // the filed note open here is what the topbar's Add event seats; the case notes offer nothing
  $effect(() => { offerNote('notebook', noteEntity); });
  onDestroy(() => withdrawNote('notebook'));

  // -- the home ----------------------------------------------------------------

  async function refreshRows() {
    const id = caseId;
    if (!id) return;
    rowsLoading = true;
    try {
      const result = await api.get(`/api/cases/${id}/notes/index`);
      if (id === caseId) rows = result.items ?? [];
    } catch (error) {
      toast(`Could not list the notes: ${error.message}`, 'warn');
    } finally {
      rowsLoading = false;
    }
  }
  // read again on the home and on each note opened, which shows the others as chapters
  $effect(() => {
    caseState.rev;
    void opened;
    if (caseId) untrack(refreshRows);
  });

  // -- one note ------------------------------------------------------------------

  /** Show a note (`case` or null for the case notes), at a line if one is given. */
  function show(noteId, { line = null, navigate = true, jump = {} } = {}) {
    if (!caseId) return;
    const id = noteId && noteId !== CASE_NOTES ? noteId : null;
    leaveTemplate({ quiet: true });
    if (!opened || opened.noteId !== id || doc?.caseId !== caseId) {
      const previous = doc;
      doc = openNote(caseId, id);
      if (previous) void releaseNote(previous);
      opened = { noteId: id };
      editor = null;
    }
    pendingLine = Number.isInteger(line) ? line : null;
    pendingJump = jump;
    uiState.openNotebook = { noteId: id };
    settlePlace('notebook', place(), { navigate });
  }

  function home({ navigate = true } = {}) {
    const previous = doc;
    doc = null;
    opened = null;
    editor = null;
    if (previous) void releaseNote(previous);
    uiState.openNotebook = { home: true };
    settlePlace('notebook', place(), { navigate });
  }

  $effect(() => {
    titleField = noteEntity?.label ?? '';
    folderField = noteEntity?.attrs?.folder ?? '';
  });

  // a line asked for (a search hit, a citation) is gone to once the note is read
  $effect(() => {
    const ready = editor && doc?.loaded;
    if (!ready || pendingLine === null) return;
    const line = pendingLine;
    const options = pendingJump;
    pendingLine = null;
    queueMicrotask(() => editor?.jump(line, options));
  });

  // a note asked for from elsewhere: a sidebar row, Details, a search, a citation
  let requestedCase = null;
  $effect(() => {
    const request = uiState.openNotebook;
    const id = caseId;
    if (!id) {
      untrack(() => { if (doc) home({ navigate: false }); });
      requestedCase = null;
      return;
    }
    const caseChanged = requestedCase !== id;
    requestedCase = id;
    untrack(() => {
      if (caseChanged && doc && doc.caseId !== id) home({ navigate: false });
      if (!request) return;
      // the home asked for from elsewhere (Notes in the sidebar) while a note is open
      if (request.home) { if (opened) home({ navigate: !caseChanged }); return; }
      const wanted = request.noteId ?? null;
      if (!opened || opened.noteId !== wanted || Number.isInteger(request.line)) show(wanted, { line: request.line ?? null, navigate: !caseChanged });
    });
  });

  // Where the tab is, in the address. Choosing a note is a step Back retraces; a tab
  // of its own also names its case, so a reload opens the same note again.
  const opening = splitHash(location.hash);
  const solo = readSolo(opening.params);
  const place = () => {
    const note = template ? '' : opened ? opened.noteId ?? CASE_NOTES : '';
    return solo ? { case: caseId, note, solo: '1' } : { note };
  };
  $effect(() => {
    if (uiState.tool !== 'notebook' || !caseId) return;
    place();
    untrack(() => settlePlace('notebook', place()));
  });
  onDestroy(onBackForward('notebook', (to) => {
    const id = to.note ?? '';
    if (!id) home({ navigate: false });
    else if (id === CASE_NOTES) show(null, { navigate: false });
    else if (!graphEntities.length || noteEntities.some((entity) => entity.id === id)) show(id, { navigate: false });
    return true;
  }));

  // -- a tab of its own ----------------------------------------------------------

  let soloWaiting = solo && opening.route === 'notebook' && opening.params.get('note')
    ? { caseId: opening.params.get('case'), note: opening.params.get('note') } : null;
  $effect(() => {
    if (!soloWaiting || !caseId) return;
    const { caseId: owner, note } = soloWaiting;
    soloWaiting = null;
    if (!owner || owner === caseId) untrack(() => show(note, { navigate: false }));
  });

  /** The note in a tab of its own, for another screen. This tab goes back to the notes. */
  async function detach(noteId = opened?.noteId ?? null) {
    const tab = window.open('', '_blank');
    if (!tab) { toast('The browser refused a new tab. Allow pop-ups for this page', 'warn', 8000); return; }
    if (doc && (doc.noteId ?? null) === (noteId ?? null)) await flush(doc);
    tab.location.href = `${location.pathname}${location.search}${buildHash('notebook', { case: caseId, note: noteId ?? CASE_NOTES, solo: '1' })}`;
    if (opened && (opened.noteId ?? null) === (noteId ?? null)) home();
    toast('The note is open in its own tab', 'info', 3000);
  }

  function beside(noteId = opened?.noteId ?? null) {
    openInDock(caseId, noteId);
    toast('Pinned to the side', 'info', 2600);
  }

  // -- how it prints --------------------------------------------------------------

  function setPageMode(on) {
    pageMode = on;
    keepPageView('notebook', on);
  }

  $effect(() => {
    const id = caseId;
    const key = opened ? opened.noteId ?? CASE_NOTES : '';
    look = null;
    if (!id || !key) return;
    let live = true;
    readLook(id, key === CASE_NOTES ? null : key)
      .then((value) => { if (live) look = value; })
      .catch(() => { if (live) look = normaliseLook(null); });
    return () => { live = false; };
  });

  /**
   * A look picked in the header. Turned to Your own page, a note with no cover gets
   * one at its top, so what page 1 prints is there to write.
   */
  function pickLook(next) {
    if (coverChoice(next) === 'own' && coverChoice(look) !== 'own') editor?.cover();
    void changeLook(next);
  }

  /** `/` › Cover page wrote the page: the look prints it alone on page 1. */
  function coverWritten() {
    if (look && coverChoice(look) !== 'own') void changeLook(ownCover(look));
  }

  /** A look picked in the header: shown at once, kept beside the note. */
  async function changeLook(next) {
    const id = caseId;
    const key = opened?.noteId ?? null;
    const mine = ++lookWrites;
    look = next;
    try {
      const saved = await writeLook(id, key, next);
      if (mine === lookWrites && id === caseId && (opened?.noteId ?? null) === key) look = saved;
    } catch (error) {
      toast(`Look not saved: ${error.message}`, 'danger');
    }
  }

  // -- naming and filing ---------------------------------------------------------

  async function commitTitle() {
    const name = titleField.trim();
    if (!noteEntity || !name || name === noteEntity.label) {
      titleField = noteEntity?.label ?? '';
      return;
    }
    try {
      await flush(doc);
      await renameEntity(caseId, noteEntity, name);
      await reloadCase();
    } catch (error) {
      toast(error.message, 'danger');
      titleField = noteEntity.label;
    }
  }

  $effect(() => {
    const wanted = folderField;
    const entity = untrack(() => noteEntity);
    if (!entity || wanted === (entity.attrs?.folder ?? '')) return;
    untrack(async () => {
      try {
        await flush(doc);
        await assignFolder(caseId, entity, wanted);
        await reloadCase();
      } catch (error) {
        toast(error.message, 'danger');
      }
    });
  });

  // -- making notes --------------------------------------------------------------

  /** The New note dialog, on the start asked for (`'from-case'`), else on a blank page. */
  function newNote(start = 'blank') {
    noteModal = { start: typeof start === 'string' ? start : 'blank' };
  }

  // `start` is the name a note gets when none is typed, which is also the one its thumbnail shows
  const starts = $derived([
    ...READY_NOTES.map((ready) => ({
      id: ready.id, name: ready.name, start: ready.id === 'blank' ? 'Note' : ready.name, note: ready.note,
      body: ready.body, folder: '', look: ready.look,
    })),
    ...templatesState.note.map((record) => ({
      id: `t:${record.id}`, name: record.name, start: record.name, note: styleLabel(record.data?.look?.style ?? 'plain'),
      body: record.data?.body ?? '', folder: record.data?.folder ?? '', look: record.data?.look ?? null,
    })),
  ]);

  async function make({ title, folder = '', body = '', look: start = null }) {
    const note = await createNote(caseId, { title, folder, content: filledBody(body) });
    // the look the template prints in goes with the note; a failure leaves the note plain
    if (!isPlainLook(start)) await writeLook(caseId, note.id, templateLook(start)).catch((error) => toast(`Look not saved: ${error.message}`, 'warn'));
    await reloadCase();
    show(note.id);
    return note;
  }

  /** What the New note dialog hands over; the dialog stays open when the note could not be made. */
  async function saveNewNote(start) {
    try {
      if (start.webmap) {
        // a web map: its map put first, its ground filed, then the note that is that map's page
        const note = await makeWebMap(caseId, { title: start.title, folder: start.folder, layers: start.webmap.layers });
        noteModal = null;
        show(note.id);
        return;
      }
      await make(start);
      noteModal = null;
    } catch (error) {
      toast(error.message, 'danger');
    }
  }

  /** A ready note or a template, started at once under a free name that is selected to retype. */
  async function startFrom({ name, body, folder, look: start = null }) {
    try {
      const note = await make({ title: freeTitle(name, noteEntities.map((entity) => entity.label)), folder, body, look: start });
      retitle = note.id;
    } catch (error) {
      toast(error.message, 'danger');
    }
  }

  /** A report of the notes picked on the home: one chapter each, in the order picked, opened beside its pages. */
  async function makeReport(ids) {
    if (!caseId || !ids.length) return;
    try {
      if (doc) await flush(doc);
      const note = await createNote(caseId, {
        title: freeTitle('Report', noteEntities.map((entity) => entity.label)), folder: '', content: reportBody(ids),
      });
      await writeLook(caseId, note.id, reportLook()).catch((error) => toast(`Look not saved: ${error.message}`, 'warn'));
      selected = [];
      setPageMode(true);
      await reloadCase();
      show(note.id);
      retitle = note.id;
    } catch (error) {
      toast(error.message, 'danger');
    }
  }

  // the name of a note just started is selected once it is there, to be typed over
  let retitle = $state(null);
  $effect(() => {
    if (!retitle || noteEntity?.id !== retitle || !titleInput || titleField !== noteEntity.label) return;
    retitle = null;
    titleInput.focus();
    titleInput.select();
  });

  async function keepAsTemplate() {
    const name = naming?.value.trim();
    if (!name || !doc) return;
    try {
      await saveTemplate('note', { name, data: { body: doc.text, folder: noteEntity?.attrs?.folder ?? '', look: templateLook(look) } });
      naming = null;
      toast(`“${name}” kept as a note template`, 'ok', 2600);
    } catch (error) {
      toast(error.message, 'danger');
    }
  }

  // -- the note menu ---------------------------------------------------------------

  /** The note a menu is for: the card it was opened from, or the note open. */
  function menuRow(open) {
    return open?.row ?? (opened ? { id: opened.noteId ?? CASE_NOTES, title: noteEntity?.label ?? 'Case notes' } : null);
  }

  /** Close the menu and act on its note, read first: once the menu is closed it no longer says which. */
  function fromMenu(action) {
    const row = menuRow(menu);
    menu = null;
    if (row) action(row);
  }

  // -- deleting --------------------------------------------------------------------

  function askRemove(row) {
    if (row.id === CASE_NOTES) noteAction = { kind: 'reset' };
    else noteAction = { kind: 'delete', noteId: row.id, label: row.title };
  }

  async function confirmNoteAction() {
    const action = noteAction;
    if (!action || !caseId) return;
    noteActionBusy = true;
    try {
      if (action.kind === 'delete') {
        const id = caseId;
        if (opened?.noteId === action.noteId) home({ navigate: false });
        const result = await deleteNote(id, action.noteId);
        await reloadCase();
        deletedToast(id, result, action.label);
      } else {
        if (doc && !doc.noteId) await flush(doc);
        await resetCaseNotes(caseId);
        if (opened && !opened.noteId) {
          const previous = doc;
          doc = openNote(caseId, null);
          void releaseNote(previous);
        }
        toast('Note content reset', 'ok', 1800);
        void refreshRows();
      }
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      noteActionBusy = false;
      noteAction = null;
    }
  }

  // -- export ----------------------------------------------------------------------

  async function runExport(noteIds) {
    if (!caseId || exportBusy) return;
    const id = caseId;
    // pressed before the check answered: the export does not wait for it
    if (exportCheck?.checking) stopCheck();
    // read before the dialog closes, which forgets what the check found
    const format = exportFormat;
    const edition = PUBLIC_ONLY.includes(format) ? PUBLIC : exportEdition;
    const said = exportCheck?.internal ? `${edition} ` : '';
    const address = format === WEB && noteIds.length === 1 ? webAddress.trim() : '';
    const options = format === HTML || format === WEB ? { edition, format, roundPov, changes: exportChanges, address, offlineMaps: format === WEB && offlineMaps } : { edition };
    if (address) keepAddress(id, noteIds[0], address);
    exportBusy = true;
    try {
      // the file is drawn from the note on disk, so what is still waiting is written first
      if (doc) await flush(doc);
      const result = await exportNotes(id, noteIds, options);
      // the line drafted from What changed has gone out with it, or was cleared on purpose
      if ((format === HTML || format === WEB) && noteIds.length === 1) keepCorrection(id, noteIds[0], '');
      if (format === WEB) {
        // the dialog stays on what was written, with the folder and the steps to put it online
        stopCheck();
        webDone = { written: result.written ?? [], path: result.path ?? '' };
        selected = [];
        for (const warning of result.warnings) toast(warning, 'warn', 6500);
        return;
      }
      closeExport();
      selected = [];
      const count = result.written.length;
      const what = format === HTML ? `HTML page${count > 1 ? 's' : ''}` : `PDF${count > 1 ? 's' : ''}`;
      toast(`${count} ${said}${what} written to ${destinationLabel(result.path)}`, 'ok', 5200, {
        label: 'Show',
        onClick: () => revealExports(id).catch((error) => toast(error.message, 'warn')),
      });
      for (const warning of result.warnings) toast(warning, 'warn', 6500);
    } catch (error) {
      toast(`Export failed: ${error.message}`, 'danger');
    } finally {
      exportBusy = false;
    }
  }

  function readExportDestination() {
    readDestinations().then((dirs) => (exportDir = dirs.notes)).catch(() => {});
  }

  /** The title of the one note in the export dialog, which a short name starts from. */
  const exportTitle = $derived(exportIds.length === 1
    ? rows.find((row) => row.id === exportIds[0])?.title
      ?? (opened && (opened.noteId ?? CASE_NOTES) === exportIds[0] ? noteEntity?.label ?? 'Case notes' : '')
    : '');

  /**
   * One note, or the notes picked on the home, each to a file of its own. A line drafted
   * from What changed waits in its What changed field; `correcting`, from the Editions
   * dialog, opens on the public HTML page that prints it.
   */
  function exportSome(noteIds, { correcting = false } = {}) {
    exportIds = noteIds.map((id) => id ?? CASE_NOTES);
    exportEdition = correcting ? PUBLIC : editionOfAll(caseId, exportIds);
    if (correcting && (exportFormat === PDF || exportFormat === WORDPRESS)) {
      exportFormat = HTML;
      keepFormat('export', HTML);
    }
    // Round them, pressed in the Ready panel, carries into this note's export
    roundPov = exportIds.length === 1 && roundNext === exportIds[0];
    offlineMaps = false;
    exportChanges = exportIds.length === 1 ? correctionFor(caseId, exportIds[0]) : '';
    webDone = null;
    githubDone = null;
    stepsOpen = false;
    readWebAddress(exportIds);
    exportOpen = true;
    readExportDestination();
    void checkExport(exportIds);
  }

  /**
   * The address one note's web folder was last given: kept in this browser, else the
   * one its latest web folder was made for, as its record of editions says.
   */
  function readWebAddress(noteIds) {
    webAddressTyped = false;
    webAddress = noteIds.length === 1 ? readAddress(caseId, noteIds[0]) : '';
    if (noteIds.length !== 1 || webAddress) return;
    const id = caseId;
    listEditions(id, noteIds[0])
      .then((list) => {
        const made = list.find((edition) => (edition.format === WEB || edition.format === 'github') && edition.address);
        // with GitHub set up, the address on the field was made from the title: the one published wins
        if (made && !webAddressTyped && (!webAddress || githubSet) && id === caseId && exportOpen) webAddress = made.address;
      })
      .catch(() => {});
  }

  function typeWebAddress(value) {
    webAddressTyped = true;
    webAddress = value;
    if (exportIds.length === 1 && !addressProblem(value)) keepAddress(caseId, exportIds[0], value);
  }

  /** Publish the one note to GitHub Pages; the dialog then stays on the page being built. */
  async function runPublish() {
    if (!caseId || !githubPublish || exportBusy) return;
    const id = caseId;
    const result = await githubPublish.publish({ roundPov, changes: exportChanges, offlineMaps });
    if (result && exportIds.length === 1) keepCorrection(id, exportIds[0], '');
    if (!result || id !== caseId || !exportOpen) return;
    stopCheck();
    githubDone = result;
    selected = [];
    for (const warning of result.warnings ?? []) toast(warning, 'warn', 6500);
  }

  /** The web folder just written, in the system's file manager. */
  async function openWebFolder() {
    const written = webDone?.written ?? [];
    try {
      if (written.length === 1) await showEdition(caseId, written[0].note, written[0]);
      else await revealExports(caseId);
    } catch (error) {
      toast(error.message, 'warn');
    }
  }

  /** PDF or HTML, picked in the dialog: kept for the next export, and the check asked again. */
  function chooseFormat(format) {
    exportFormat = format;
    keepFormat('export', format);
    void checkExport(exportIds);
  }

  /** The edition picked in the dialog: kept for each note, and the check asked again. */
  function chooseEdition(edition) {
    exportEdition = edition;
    keepEdition(caseId, exportIds, edition);
    void checkExport(exportIds);
  }

  /** Ask what the PDFs would warn about, from the notes as saved; a failure finds nothing. */
  async function checkExport(noteIds) {
    // the switch stays while the edition it shows is checked again: read before the stop forgets it
    const internal = exportCheck?.internal ?? 0;
    stopCheck();
    const id = caseId;
    const mine = new AbortController();
    checkController = mine;
    // the WordPress branch says what it checks itself
    if (exportFormat === WORDPRESS) {
      checkController = null;
      return;
    }
    exportCheck = { checking: true, internal };
    try {
      if (doc) await flush(doc);
      const answer = await checkNotes(id, noteIds, { signal: mine.signal, edition: exportEdition, format: exportFormat });
      if (checkController === mine) exportCheck = answer;
    } catch {
      if (checkController === mine) exportCheck = null;
    } finally {
      if (checkController === mine) checkController = null;
    }
  }

  function stopCheck() {
    checkController?.abort();
    checkController = null;
    exportCheck = null;
  }

  /** The archive dialog closed: the check before export, and the Ready panel's, count the links again. */
  function closeArchive() {
    archiveOf = null;
    if (exportOpen) void checkExport(exportIds);
    if (readyOf) void askReady();
  }

  // a run that ends while the export or the Ready panel is open drops its count there
  $effect(() => onEnded(() => {
    if (exportOpen) void checkExport(exportIds);
    if (readyOf) void askReady();
  }));

  function closeExport() {
    stopCheck();
    exportOpen = false;
    webDone = null;
    githubDone = null;
    stepsOpen = false;
  }

  /** Leave the export for the line a warning is about, in its note. */
  function goToWarning(noteId, line, jump = {}) {
    closeExport();
    show(noteId, { line, jump });
  }

  // -- Ready to publish? ------------------------------------------------------------

  /** The format and edition the panel checks: the export dialog's when it came from there, else what the export would open on. */
  function readyChoice(noteId, fromExport) {
    if (fromExport) return { format: exportFormat, edition: exportEdition, address: webAddress.trim() };
    return { format: readFormat('export'), edition: editionOf(caseId, noteId), address: readAddress(caseId, noteId) };
  }

  /** Open the panel on one note: from its header, or from the export dialog, which it goes back to. */
  function openReady({ noteId = opened?.noteId ?? CASE_NOTES, title = noteEntity?.label ?? 'Case notes', fromExport = false } = {}) {
    if (!caseId) return;
    if (fromExport) {
      // the dialog's choices stay as they are for the way back
      stopCheck();
      exportOpen = false;
    }
    readyOf = { noteId, title, fromExport };
    readyAnswer = null;
    readyFailed = '';
    void askReady();
  }

  function closeReady({ toExport = readyOf?.fromExport } = {}) {
    readyController?.abort();
    readyController = null;
    const was = readyOf;
    readyOf = null;
    readyChecking = false;
    if (toExport && was) {
      exportOpen = true;
      void checkExport(exportIds);
    }
  }

  /** Ask the check for the panel's note, from the note as saved; the open note's badge follows it. */
  async function askReady() {
    const of = readyOf;
    if (!of || !caseId) return;
    readyController?.abort();
    const mine = new AbortController();
    readyController = mine;
    readyChecking = true;
    try {
      if (doc && (doc.noteId ?? CASE_NOTES) === of.noteId) await flush(doc);
      const answer = await checkReady(caseId, of.noteId, { ...readyChoice(of.noteId, of.fromExport), signal: mine.signal });
      if (readyController !== mine) return;
      readyAnswer = answer;
      readyFailed = '';
      if (opened && (opened.noteId ?? CASE_NOTES) === of.noteId) readyBadge = { key: badgeKey(), issues: issueCount(readyLines(answer)) };
    } catch (error) {
      if (readyController === mine && error?.name !== 'AbortError') readyFailed = error.message;
    } finally {
      if (readyController === mine) {
        readyController = null;
        readyChecking = false;
      }
    }
  }

  /** The panel's Go to: the note at the line, the way a warning of the export takes it there. */
  function goReady(line) {
    const noteId = readyOf?.noteId;
    closeReady({ toExport: false });
    show(noteId, { line: line.line, jump: jumpFor(line) });
  }

  /** Whether the panel's note is the one in the editor, which a fix that writes in it needs. */
  const readyEditable = $derived(Boolean(readyOf && editor && doc?.loaded && opened && (opened.noteId ?? CASE_NOTES) === readyOf.noteId));

  /** Write one change the panel worked out into the note, as one Undo step. */
  function writeReady(change, missing) {
    if (!change || !editor?.replace(change.from, change.to, change.insert, change.expected)) {
      toast(missing, 'warn', 4500);
      return false;
    }
    return true;
  }

  /** A fix pressed in the panel: the action that exists elsewhere (`runFix`), then the check again. */
  async function fixReady(line) {
    const of = readyOf;
    if (!of || !line?.fix || readyBusy) return;
    readyBusy = line.key;
    try {
      const again = await runFix(line, {
        text: () => editor?.text() ?? '',
        write: writeReady,
        archive: () => (archiveOf = { noteId: of.noteId, title: of.title }),
        bookmark: async (links) => {
          const plan = await readPlan(caseId, of.noteId).catch(() => null);
          const { filed, failed } = await bookmarkLinks(caseId, links, { folder: plan?.folder ?? '' });
          if (filed) toast(`${filed} ${filed === 1 ? 'bookmark' : 'bookmarks'} filed${plan?.folder ? ` in ${plan.folder}` : ''}`, 'ok', 3500);
          if (failed) toast(failed, 'warn', 5000);
        },
        round: (on) => {
          if (of.fromExport) roundPov = on;
          roundNext = on ? of.noteId : roundNext === of.noteId ? '' : roundNext;
        },
        open: (id) => {
          const entity = graphEntities.find((item) => item.id === id);
          if (!entity) return;
          closeReady({ toExport: false });
          openEntity(entity);
        },
      });
      if (again) await askReady();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      readyBusy = '';
    }
  }

  const badgeKey = () => `${caseId}/${opened?.noteId ?? CASE_NOTES}`;
  /** How long the badge waits once typing stops before it asks the check again: a long note's check lays its page out whole. */
  const BADGE_QUIET_MS = 15000;

  // the open note's badge: read once it is loaded, then a while after each change; never while the panel asks
  $effect(() => {
    const ready = Boolean(caseId && opened && doc?.loaded && !template);
    void doc?.text;
    const key = ready ? badgeKey() : '';
    clearTimeout(badgeTimer);
    if (!ready) return;
    const first = untrack(() => readyBadge?.key) !== key;
    badgeTimer = setTimeout(() => untrack(() => readBadge(key)), first ? 400 : BADGE_QUIET_MS);
    return () => clearTimeout(badgeTimer);
  });

  async function readBadge(key) {
    if (readyOf || exportOpen || key !== badgeKey()) return;
    badgeController?.abort();
    const mine = new AbortController();
    badgeController = mine;
    const noteId = opened?.noteId ?? CASE_NOTES;
    try {
      if (doc) await flush(doc);
      const answer = await checkReady(caseId, noteId, { ...readyChoice(noteId, false), signal: mine.signal });
      if (badgeController === mine && key === badgeKey()) readyBadge = { key, issues: issueCount(readyLines(answer)) };
    } catch {
      // a check that fails leaves the badge as it was
    } finally {
      if (badgeController === mine) badgeController = null;
    }
  }
  onDestroy(() => {
    clearTimeout(badgeTimer);
    badgeController?.abort();
    readyController?.abort();
  });

  // -- a template from Settings ------------------------------------------------------

  $effect(() => {
    const id = uiState.openNoteTemplate;
    if (!id) return;
    untrack(async () => {
      if (!templatesState.note.length) await loadTemplates();
      const record = templatesState.note.find((item) => item.id === id);
      uiState.openNoteTemplate = null;
      if (!record) { toast('That template is no longer there', 'warn'); return; }
      if (doc) home({ navigate: false });
      template = { id: record.id, name: record.name, folder: record.data?.folder ?? '', look: templateLook(record.data?.look) };
      templateDoc = { text: record.data?.body ?? '', loaded: true, revision: 1, elsewhere: false, error: '' };
    });
  });

  function templateChanged(text) {
    if (!template || !templateDoc) return;
    templateDoc.text = text;
    clearTimeout(templateTimer);
    templateTimer = setTimeout(saveTemplateNow, 600);
  }

  async function saveTemplateNow() {
    clearTimeout(templateTimer);
    if (!template || !templateDoc) return;
    const name = template.name.trim() || 'Note template';
    try {
      await saveTemplate('note', { id: template.id, name, data: { body: templateDoc.text, folder: template.folder, look: templateLook(template.look) } });
    } catch (error) {
      toast(`Template not saved: ${error.message}`, 'danger');
    }
  }

  function changeTemplateLook(next) {
    if (!template) return;
    if (coverChoice(next) === 'own' && coverChoice(template.look) !== 'own') editor?.cover();
    template.look = templateLook(next);
    void saveTemplateNow();
  }

  async function leaveTemplate({ quiet = false } = {}) {
    if (!template) return;
    await saveTemplateNow();
    template = null;
    templateDoc = null;
    if (!quiet) {
      uiState.settingsTab = 'templates';
      uiState.tool = 'settings';
    }
  }

  // the open note's run, followed by this tab while its links are archived
  const archiving = $derived(opened ? followed(caseId, opened.noteId ?? CASE_NOTES) : null);
  const saveSaid = $derived(!doc ? '' : doc.saveError ? 'Not saved' : doc.saving || !doc.saved ? 'Saving…' : 'Saved');
</script>

{#if !caseState.current}
  <NoCase icon="note" what="write notes" />
{:else}
  <section class="notebook">
    {#if template && templateDoc}
      <header class="tool-header">
        <BackButton label="Settings" title="Back to the templates in Settings" onclick={() => leaveTemplate()} />
        <span class="kind">Template</span>
        <input class="input title-input" bind:value={template.name} onblur={saveTemplateNow} maxlength="120" aria-label="Template name"
          onkeydown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        <span class="hint">{'{today}'} and {'{now}'} are written in when a note starts from it; {'{title}'}, {'{date}'} and the signature's words when it prints. A ::: top-right block in the cover pins it to a corner.</span>
        <div class="spacer"></div>
        <LookControl look={template.look} template onchange={changeTemplateLook} text={templateDoc.text} />
        <ViewModes page={pageMode} guide="notebook.view" onchange={setPageMode} />
        <button class="btn btn-primary btn-sm" onclick={() => leaveTemplate()}><Icon name="check" size={14} /> Done</button>
      </header>
      <div class="body" class:split={pageMode}>
        <div class="writing">
          {#key template.id}
            <NoteEditor doc={templateDoc} {caseId} entities={graphEntities} onchange={templateChanged} onopen={openEntity} template
              onready={(handle) => (editor = handle)} oncover={() => template && changeTemplateLook(ownCover(template.look))}
              placeholder="What a note made from this template starts with. Type / and pick Guidance for grey words that say what goes where." />
          {/key}
        </div>
        {#if pageMode}
          <PagePane title={template.name} text={filledBody(templateDoc.text)} look={template.look} onjump={(line, options) => editor?.jump(line, options)}
            onresize={(picture, changes) => editor?.resize(picture.line, picture.ref, changes)} />
        {/if}
      </div>
    {:else if opened && doc}
      <header class="tool-header">
        <BackButton label="Notes" title="Back to the notes" onclick={() => home()} guide="notebook.home" />
        {#if opened.noteId}
          <input class="input title-input" bind:this={titleInput} bind:value={titleField} onblur={commitTitle} maxlength="300"
            aria-label="Note name" onkeydown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
          <div class="folder-pick" title="The folder this note is filed in">
            <FolderSelect bind:value={folderField} folders={caseState.current?.folders ?? []} emptyLabel="Unfiled" />
          </div>
        {:else}
          <span class="case-title"><Icon name="note" size={14} /> Case notes</span>
        {/if}
        <span class="status" class:error={doc.saveError}>
          {#if doc.saveError}<Icon name="alert" size={12} /> Not saved: {doc.saveError}
            <button class="btn btn-ghost btn-xs" onclick={() => retrySave(doc)}>Retry</button>
          {:else if doc.loaded}{#if saveSaid === 'Saved'}<Icon name="check" size={12} />{/if} {saveSaid}{/if}
        </span>
        {#if isActive(archiving)}
          <button type="button" class="btn btn-ghost btn-xs archiving" title="The links of this note are being archived; see how far"
            onclick={() => (archiveOf = { noteId: opened.noteId ?? CASE_NOTES, title: noteEntity?.label ?? 'Case notes' })}>
            <Icon name="clock" size={12} /> {progressWords(archiving)}</button>
        {/if}
        <div class="spacer"></div>
        {#if readyBadge && readyBadge.key === badgeKey()}
          <button type="button" class="btn btn-ghost btn-xs ready-badge" class:clear={!readyBadge.issues}
            title="Ready to publish? What the check before export says, in one place" aria-label={`Ready to publish? ${badgeWords(readyBadge.issues)}`}
            onclick={() => openReady()}>
            {#if readyBadge.issues}<span class="ready-dot" aria-hidden="true"></span><span>{readyBadge.issues}<span class="ready-words">{' to look at'}</span></span>
            {:else}<Icon name="check" size={12} /><span class="ready-words">Ready</span>{/if}</button>
        {/if}
        <LookControl {look} onchange={pickLook} entities={graphEntities} disabled={!look} text={doc.text} />
        <ViewModes page={pageMode} guide="notebook.view" onchange={setPageMode} />
        <button class="btn btn-ghost btn-sm" title="Stays open on the right as you switch tools" aria-label="Pin to the side"
          data-guide="notebook.dock" onclick={() => beside()}><Icon name="panelRight" size={15} /><span class="wide-only">Pin to the side</span></button>
        {#if !solo}
          <button class="btn btn-ghost btn-sm" title="Open in its own tab, for another screen" aria-label="Open in its own tab"
            data-guide="notebook.tab" onclick={() => detach()}><Icon name="external" size={15} /></button>
        {/if}
        <button class="btn btn-sm" title="Export this note as a PDF, an HTML page or a web folder" data-guide="notebook.pdf" onclick={() => exportSome([opened.noteId])}>
          <Icon name="download" size={14} /> Export</button>
        <button class="btn btn-ghost btn-sm" aria-label="More" title="More" onclick={(event) => (menu = { anchor: event.currentTarget })}>
          <Icon name="more" size={15} /></button>
      </header>
      <div class="body" class:split={pageMode || builder}>
        <div class="writing">
          {#key doc}
            <NoteEditor {doc} {caseId} entities={graphEntities} redirects={referenceRedirects} where="notebook" notes={rows}
              onopen={openEntity} onnote={(id) => show(id)} onready={(handle) => { editor = handle; noteSelection = null; }} oncover={coverWritten}
              onselect={(range) => (noteSelection = range)}
              oninfographic={(at) => (builder = { ...at, noteId: opened?.noteId ?? null, opened: (builder?.opened ?? 0) + 1 })} />
          {/key}
        </div>
        {#if builder && editor && doc.loaded}
          {#key builder.opened}
            <InfographicBuilder {caseId} noteId={opened?.noteId ?? null} text={doc.text} {editor} from={builder.from} panel={builder.panel}
              onclose={() => (builder = null)} />
          {/key}
        {/if}
        {#if pageMode && look && doc.loaded}
          <PagePane {caseId} note={opened.noteId ?? CASE_NOTES} title={noteEntity?.label ?? 'Case notes'} text={doc.text} {look} entities={graphEntities}
            onjump={(line, options) => editor?.jump(line, options)} onresize={(picture, changes) => editor?.resize(picture.line, picture.ref, changes)} />
        {/if}
      </div>
    {:else}
      <NotesHome {caseId} {rows} loading={rowsLoading} templates={templatesState.note} bind:selected
        onopen={(id, options) => show(id, options)} onnew={newNote} onstart={startFrom}
        onmenu={(row, anchor) => (menu = { row, anchor })} onexport={exportSome} onreport={makeReport} />
    {/if}
  </section>

  {#if menu}
    {@const row = menuRow(menu)}
    <FloatingMenu anchor={menu.anchor} align="end" width={230} label="Note actions" onclose={() => (menu = null)}>
      {#if menu.row}
        <button type="button" class="fm-item" onclick={() => fromMenu((note) => show(note.id))}><Icon name="edit" size={14} /><span class="fm-grow">Open</span></button>
        <button type="button" class="fm-item" onclick={() => fromMenu((note) => beside(note.id === CASE_NOTES ? null : note.id))}>
          <Icon name="panelRight" size={14} /><span class="fm-grow">Pin to the side</span></button>
        <button type="button" class="fm-item" onclick={() => fromMenu((note) => detach(note.id === CASE_NOTES ? null : note.id))}>
          <Icon name="external" size={14} /><span class="fm-grow">In its own tab</span></button>
        <button type="button" class="fm-item" onclick={() => fromMenu((note) => exportSome([note.id]))}>
          <Icon name="download" size={14} /><span class="fm-grow">Export</span></button>
      {:else}
        <button type="button" class="fm-item" onclick={() => { menu = null; naming = { value: noteEntity?.label ?? 'Case notes' }; }}
          title="Keep this note as it is, to start others from"><Icon name="save" size={14} /><span class="fm-grow">Keep as template</span></button>
        {#if doc}
          <ToPostItem {caseId} noteId={opened.noteId ?? CASE_NOTES} text={doc.text} selection={noteSelection} ready={doc.loaded}
            ondone={() => (menu = null)} />
        {/if}
      {/if}
      {#if row}
        <button type="button" class="fm-item" title="Every PDF, HTML page, web folder, WordPress draft and published page of this note, with Show and Check"
          onclick={() => fromMenu((note) => (editionsOf = { noteId: note.id, title: note.title }))}>
          <Icon name="file" size={14} /><span class="fm-grow">Editions</span></button>
        <button type="button" class="fm-item" title="Send each outside link to the Internet Archive and keep its copy"
          onclick={() => fromMenu((note) => (archiveOf = { noteId: note.id, title: note.title }))}>
          <Icon name="bookmark" size={14} /><span class="fm-grow">Archive every link…</span></button>
      {/if}
      {#if row}
        <div class="fm-sep"></div>
        <button type="button" class="fm-item danger" onclick={() => fromMenu(askRemove)}>
          <Icon name={row.id === CASE_NOTES ? 'reset' : 'trash'} size={14} />
          <span class="fm-grow">{row.id === CASE_NOTES ? 'Clear the case notes' : 'Delete'}</span></button>
      {/if}
    </FloatingMenu>
  {/if}

  {#if noteModal}
    <NewNoteDialog {caseId} {starts} start={noteModal.start} folders={caseState.current?.folders ?? []}
      taken={noteEntities.map((entity) => entity.label)} oncreate={saveNewNote} onclose={() => (noteModal = null)} />
  {/if}

  {#if naming}
    <Modal title="Keep as a note template" onclose={() => (naming = null)} width="460px">
      <label class="modal-label" for="notebook-template-name">Name</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input id="notebook-template-name" class="input" bind:value={naming.value} maxlength="120" autofocus
        onkeydown={(event) => { if (event.key === 'Enter') keepAsTemplate(); }} />
      <p class="export-note">New notes can start from it. Settings › Templates edits or deletes it.</p>
      <div class="modal-row">
        <div style="flex:1"></div>
        <button class="btn" onclick={() => (naming = null)}>Cancel</button>
        <button class="btn btn-primary" onclick={keepAsTemplate} disabled={!naming.value.trim()}>Keep</button>
      </div>
    </Modal>
  {/if}

  {#if exportOpen}
    {@const several = exportIds.length > 1}
    {@const html = exportFormat === HTML}
    {@const web = exportFormat === WEB}
    {@const wordpress = exportFormat === WORDPRESS}
    {@const publicOnly = PUBLIC_ONLY.includes(exportFormat)}
    {@const named = { [PDF]: 'PDF', [HTML]: 'HTML', [WEB]: several ? 'web folders' : 'a web folder', [WORDPRESS]: several ? 'WordPress drafts' : 'a WordPress draft' }[exportFormat] ?? 'PDF'}
    {@const checked = exportCheck?.found ?? []}
    {@const leftOut = checked.flatMap((item) => item.warnings.filter(isLeftOut).map((warning) => ({ ...warning, title: item.title })))}
    {@const noAddress = checked.flatMap((item) => item.warnings.filter(isNoAddress))[0] ?? null}
    {@const found = checked.map((item) => ({ ...item, warnings: item.warnings.filter((warning) => !isLeftOut(warning) && !isNoAddress(warning)) }))
      .filter((item) => item.warnings.length)}
    {@const page = (html || web) && exportCheck && !exportCheck.checking ? exportCheck : null}
    {@const shared = exportEdition === PUBLIC || publicOnly || !exportCheck?.internal}
    {@const problem = web && !several ? (githubSet ? githubProblem : addressProblem(webAddress)) : ''}
    <Modal title={several ? `Export notes as ${named}` : `Export note as ${named}`} onclose={closeExport} width="560px">
      {#if webDone}
        {@const count = webDone.written.length}
        <section class="web-done" aria-label="Web folder written">
          <p class="done-line" role="status"><Icon name="check" size={14} />
            {count === 1 ? `Folder written: web/${webDone.written[0].file}` : `${count} folders written in web/`}</p>
          {#if count === 1 && webDone.written[0].address}<p class="export-note">Made for {webDone.written[0].address}</p>{/if}
          <div class="done-actions">
            <button type="button" class="btn btn-sm" onclick={openWebFolder}><Icon name="folder" size={14} /> Open the folder</button>
            <button type="button" class="btn btn-sm" aria-expanded={stepsOpen} onclick={() => (stepsOpen = !stepsOpen)}>How to publish</button>
          </div>
          {#if stepsOpen}<PublishSteps />{/if}
        </section>
        <div class="modal-row">
          <div style="flex:1"></div>
          <button class="btn btn-primary" onclick={closeExport}>Done</button>
        </div>
      {:else if githubDone}
        <GitHubLive result={githubDone} />
        <div class="modal-row">
          <div style="flex:1"></div>
          <button class="btn btn-primary" onclick={closeExport}>Done</button>
        </div>
      {:else}
      {#if !several}
        <button type="button" class="ready-link" title="What the check says of this note, grouped, each with its fix"
          onclick={() => openReady({ noteId: exportIds[0], title: exportTitle || 'Case notes', fromExport: true })}>
          <Icon name="check" size={13} /> Ready to publish?
          <span class="ready-link-said">Everything to look at in one place, each with its fix</span>
          <Icon name="chevronRight" size={12} /></button>
      {/if}
      <div class="export-format">
        <span class="dest-label">Format</span>
        <FormatSwitch value={exportFormat} onchange={chooseFormat} />
      </div>
      {#if !wordpress}
        <div class="export-dest">
          <span class="dest-label">Destination</span>
          <span class="dest-path mono" title={exportDir || "The case's own exports folder"}>{exportDir || "the case's exports folder"}</span>
          <button class="btn btn-ghost btn-sm" onclick={() => (exportPicker = true)}>Change</button>
        </div>
      {/if}
      {#if exportCheck?.internal && !publicOnly}
        <div class="export-edition">
          <span class="dest-label">Edition</span>
          <EditionSwitch value={exportEdition} onchange={chooseEdition} />
          <span class="edition-said" role="status">
            {#if exportEdition !== PUBLIC}Internal passages print in marked boxes.
            {:else if exportCheck?.checking}&nbsp;
            {:else}{#each leftOut as item, index (index)}<span>{several ? `${item.title}: ` : ''}{item.text}</span>{/each}{/if}
          </span>
        </div>
      {:else if publicOnly && leftOut.length}
        <p class="export-note" role="status">Public edition. {#each leftOut as item, index (index)}<span>{several ? `${item.title}: ` : ''}{item.text} </span>{/each}</p>
      {/if}
      {#if web}
        <div class="web-fields">
          {#if !several}
            <GitHubPublish bind:this={githubPublish} bind:address={webAddress} bind:connected={githubSet}
              bind:problem={githubProblem} bind:busy={githubBusy} {caseId} noteId={exportIds[0]} title={exportTitle}
              prepare={async () => { if (doc) await flush(doc); }} onaddress={(value) => { webAddressTyped = true; keepAddress(caseId, exportIds[0], value); }}
              onleave={closeExport} />
          {/if}
          {#if !several && !githubSet}
            <label class="dest-label" for="export-address">Address it will live at</label>
            <input id="export-address" class="input mono" value={webAddress} maxlength="300" spellcheck="false" autocomplete="off"
              placeholder="https://your-name.github.io/articles/short-name/" title={LOOK_HELP.web_address}
              aria-invalid={problem ? 'true' : undefined} aria-describedby="export-address-said"
              oninput={(event) => typeWebAddress(event.currentTarget.value)} />
            <p id="export-address-said" class="address-said" class:bad={problem} role="status">
              {problem || (!webAddress.trim() && noAddress ? noAddress.text : '')}</p>
          {/if}
          <p class="export-note">{githubSet && !several ? 'Export writes it to web/ in the destination; Publish puts it online in your repository.'
            : 'Written to web/ in the destination, ready to put online. Exporting again replaces it.'}</p>
          {#if page?.live}
            <p class="export-note live-maps">Its maps load their base map from OpenFreeMap when read online.
              <label class="round" title={LOOK_HELP.offline_maps}><input type="checkbox" bind:checked={offlineMaps} /> Keep its maps offline</label></p>
          {/if}
        </div>
      {:else if wordpress}
        <!-- WordPress draft: its fields, its button and its result line, filled in by the WordPress branch. -->
        <WordPressDraft bind:this={wordpressDraft} bind:busy={draftBusy} bind:ready={draftReady} bind:sent={draftSent}
          {caseId} noteIds={exportIds} prepare={async () => { if (doc) await flush(doc); }} onleave={closeExport} />
        <!-- end of the WordPress branch -->
      {:else}
        <p class="export-note">
          {#if html}{several ? `${exportIds.length} HTML pages will be written, one per note.` : 'One HTML page will be written.'}
            It holds its pictures and short clips, and reads offline.
          {:else}{several ? `${exportIds.length} PDFs will be written, one per note.` : 'One PDF will be written.'}{/if}
          Earlier exports are kept.
        </p>
      {/if}
      {#if page}
        <section class="html-check" aria-label={web ? 'The web folder' : 'The HTML page'}>
          {#if page.weight}
            <p class="weight" class:over={page.weight > HTML_BUDGET} role="status">
              About {weightWords(page.weight)}{page.weight > HTML_BUDGET ? `, past the ${weightWords(HTML_BUDGET)} it aims under` : ''}.
            </p>
          {/if}
          {#if page.links.length}
            <div class="listed">
              <h5 class="listed-head">Played from a link, not inside the {web ? 'folder' : 'file'}</h5>
              <ul aria-label="Clips turned into a link">
                {#each page.links as item, index (index)}
                  <li>{several ? `${item.title}: ` : ''}{item.text}</li>
                {/each}
              </ul>
            </div>
          {/if}
          {#if page.pov.length}
            <div class="listed">
              <h5 class="listed-head">Where a filmer stood, shown to the metre</h5>
              <ul aria-label="Points of view">
                {#each page.pov as item, index (index)}
                  <li>
                    <span class="listed-words">{several ? `${item.title}: ` : ''}{item.text}</span>
                    {#if Number.isInteger(item.line)}
                      <button type="button" class="btn btn-ghost btn-xs" title="Open the note at this line"
                        onclick={() => goToWarning(item.note, item.line)}>Go to</button>
                    {/if}
                  </li>
                {/each}
              </ul>
              <label class="round" title="The note keeps its points as written">
                <input type="checkbox" bind:checked={roundPov} /> Round them to about 150 m in this {web ? 'folder' : 'file'}
              </label>
            </div>
          {/if}
          {#if (page.earlier || exportChanges) && shared}
            <div class="listed">
              <label class="listed-head" for="export-changes">What changed since the last public edition</label>
              <textarea id="export-changes" class="input" rows="2" bind:value={exportChanges} maxlength="300"
                placeholder="Printed at the end of the page, beside the earlier editions"></textarea>
            </div>
          {/if}
        </section>
      {/if}
      {#if exportCheck?.checking}
        <p class="checking" role="status">Checking…</p>
      {:else if found.length}
        <section class="before" aria-labelledby="export-before">
          <h4 id="export-before" class="before-head"><Icon name="alert" size={13} /> Before you export</h4>
          <div class="before-notes">
            {#each found as item, at (item.note)}
              {#if several}<h5 class="before-note">{item.title}</h5>{/if}
              <ul class="before-list" aria-label={several ? item.title : 'Warnings'}>
                {#each item.warnings as warning, index (index)}
                  <li class="before-item" data-kind={warning.kind}>
                    <span class="before-words" id={`export-warning-${at}-${index}`}>{warning.text}</span>
                    {#if Number.isInteger(warning.line)}
                      <button type="button" class="btn btn-ghost btn-xs" title="Open the note at this line"
                        aria-describedby={`export-warning-${at}-${index}`} onclick={() => goToWarning(item.note, warning.line, jumpFor(warning))}>Go to</button>
                    {/if}
                    {#if warning.kind === 'unarchived'}
                      <button type="button" class="btn btn-primary btn-xs" title="Send each outside link to the Internet Archive and keep its copy"
                        onclick={() => (archiveOf = { noteId: item.note, title: item.title })}>Archive every link…</button>
                    {/if}
                    {#if warning.items}<LinkList items={warning.items} label={warning.text} ongo={(line) => goToWarning(item.note, line)} />{/if}
                  </li>
                {/each}
              </ul>
            {/each}
          </div>
        </section>
      {/if}
      <div class="modal-row">
        <div style="flex:1"></div>
        <button class="btn" onclick={closeExport}>{wordpress && draftSent ? 'Close' : 'Cancel'}</button>
        {#if !wordpress}
          <button class={web && !several && githubSet ? 'btn' : 'btn btn-primary'} disabled={exportBusy || githubBusy || Boolean(problem)}
            onclick={() => runExport(exportIds)}>
            {exportBusy ? 'Exporting…' : found.length ? 'Export anyway' : web ? (several ? `Export ${exportIds.length} web folders` : 'Export web folder')
              : several ? `Export ${exportIds.length} ${html ? 'HTML pages' : 'PDFs'}` : `Export ${named}`}</button>
          {#if web && !several}
            <button class={githubSet ? 'btn btn-primary' : 'btn'} disabled={githubBusy || exportBusy || (githubSet && Boolean(problem))}
              onclick={runPublish} title={githubSet ? 'Put the folder online in your GitHub repository, one commit'
                : 'Publish to your own GitHub Pages site, once it is set up in Settings › Publishing'}>
              {githubBusy ? 'Publishing…' : 'Publish to GitHub Pages'}</button>
          {/if}
        {:else if draftSent?.edit}
          <a class="btn btn-primary" href={draftSent.edit} target="_blank" rel="noopener noreferrer"
            title="The draft in WordPress's editor, where you publish it">Open in WordPress</a>
        {:else}
          <button class="btn btn-primary" disabled={draftBusy || !draftReady} onclick={() => wordpressDraft?.send()}
            title="Upload the pictures and save the note as a draft; nothing is published">{draftBusy ? 'Sending…' : 'Send as a draft'}</button>
        {/if}
      </div>
      {/if}
    </Modal>
  {/if}

  {#if editionsOf}
    <EditionsDialog {caseId} noteId={editionsOf.noteId} title={editionsOf.title} onclose={() => (editionsOf = null)}
      onexport={() => { const id = editionsOf.noteId; editionsOf = null; exportSome([id], { correcting: true }); }} />
  {/if}

  {#if readyOf}
    <ReadyPanel title={readyOf.title} ready={readyAnswer} checking={readyChecking} failed={readyFailed} canEdit={readyEditable}
      rounded={readyOf.fromExport ? roundPov : roundNext === readyOf.noteId} busy={readyBusy} fromExport={readyOf.fromExport}
      onfix={fixReady} ongo={goReady} onclose={() => closeReady()}
      onexport={() => { const of = readyOf; closeReady({ toExport: false }); exportSome([of.noteId === CASE_NOTES ? null : of.noteId]); }} />
  {/if}

  {#if archiveOf}
    <ArchiveLinks {caseId} noteId={archiveOf.noteId} title={archiveOf.title} onclose={closeArchive} />
  {/if}

  {#if exportPicker}
    <ExportFolderPicker kind="notes" current={exportDir} onclose={() => (exportPicker = false)} onchosen={(path) => (exportDir = path)} />
  {/if}

  {#if noteAction}
    <ConfirmDialog
      title={noteAction.kind === 'delete' ? 'Delete this note?' : 'Clear the case notes?'}
      message={noteAction.kind === 'delete' ? `Are you sure you want to delete “${noteAction.label}”?` : 'Are you sure you want to clear the case notes?'}
      detail={noteAction.kind === 'delete' ? 'Moves the note and its contents to the case trash.' : 'The page stays, empty.'}
      restorable={noteAction.kind === 'delete' ? RESTORABLE : ''}
      impact={noteAction.kind === 'delete' ? { caseId, ids: [noteAction.noteId] } : null}
      confirmLabel={noteAction.kind === 'delete' ? 'Delete' : 'Clear'}
      tone="default"
      icon={noteAction.kind === 'delete' ? 'trash' : 'reset'}
      busy={noteActionBusy}
      onconfirm={confirmNoteAction}
      oncancel={() => (noteAction = null)}
    />
  {/if}
{/if}

<style>
  .notebook { position: relative; height: 100%; display: flex; flex-direction: column; min-height: 0; container: notebook / inline-size; }
  .tool-header { flex-wrap: nowrap; }
  .title-input { flex: 0 1 320px; min-width: 96px; font-weight: 600; }
  .case-title { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; color: var(--text-1); }
  .folder-pick { flex: 0 1 200px; min-width: 96px; }
  .kind { color: var(--accent); font-size: var(--fs-xs); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }
  .hint { color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status { color: var(--text-3); font-size: var(--fs-xs); display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
  .status.error { color: var(--danger); }
  .spacer { flex: 1; }
  .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .body.split { flex-direction: row; }
  .writing { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .writing > :global(.note-editor) { flex: 1; }
  .body.split > :global(.page-pane) { flex: 0 0 clamp(300px, 46%, 820px); }
  .body.split > :global(.ib) { flex: 0 0 clamp(320px, 34%, 400px); }
  @container notebook (max-width: 1180px) { .wide-only { display: none; } }
  /* the Ready badge keeps its count and its dot where the header is short of room */
  @container notebook (max-width: 1040px) { .ready-words { display: none; } }
  .fm-item.danger { color: var(--danger); }
  .ready-badge { gap: 6px; color: var(--text-2); font-weight: 500; white-space: nowrap; }
  .ready-badge.clear :global(svg) { color: var(--ok); }
  .ready-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: color-mix(in srgb, var(--warn) 75%, var(--text-3)); }
  .ready-link {
    display: flex; align-items: center; gap: 6px; width: 100%; margin: 0 0 10px; padding: 7px 10px; border: 1px solid var(--border);
    border-radius: var(--r-md); background: var(--bg-1); color: var(--text-1); font: inherit; font-size: var(--fs-sm); font-weight: 600;
    text-align: left; cursor: pointer;
  }
  .ready-link:hover { background: var(--bg-2); }
  .ready-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  .ready-link :global(svg:first-child) { color: var(--accent); }
  .ready-link-said { flex: 1; min-width: 0; color: var(--text-3); font-size: var(--fs-xs); font-weight: 400; }
  .export-dest { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: var(--fs-sm); }
  .export-format { display: flex; align-items: center; gap: 8px; margin-top: 2px; font-size: var(--fs-sm); }
  .web-fields { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; font-size: var(--fs-sm); }
  .web-fields .input { width: 100%; }
  .address-said { margin: 0; min-height: 1.2em; color: var(--text-3); font-size: var(--fs-xs); }
  .address-said.bad { color: var(--danger); }
  .web-done { display: flex; flex-direction: column; gap: 6px; font-size: var(--fs-sm); }
  .done-line { display: flex; align-items: center; gap: 6px; margin: 0; color: var(--text-1); font-weight: 600; overflow-wrap: anywhere; }
  .done-line :global(svg) { color: var(--ok); flex: none; }
  .done-actions { display: flex; gap: 8px; margin-top: 4px; }
  .html-check { margin-top: 10px; display: flex; flex-direction: column; gap: 8px; font-size: var(--fs-sm); }
  .weight { margin: 0; color: var(--text-2); }
  .weight.over { color: var(--warn); }
  .listed { border: 1px solid var(--border); border-radius: var(--r-md); padding: 6px 10px; background: var(--bg-1); }
  .listed-head { display: block; margin: 0 0 4px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; }
  .listed ul { list-style: none; margin: 0; padding: 0; max-height: 120px; overflow: auto; }
  .listed li { display: flex; align-items: center; gap: 8px; min-height: 24px; color: var(--text-1); }
  .listed-words { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .round { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: var(--text-2); font-size: var(--fs-xs); cursor: pointer; }
  .listed .input { width: 100%; }
  .listed textarea.input { resize: vertical; line-height: 1.45; }
  .dest-label { color: var(--text-3); }
  .dest-path { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .export-note { color: var(--text-3); font-size: var(--fs-xs); margin: 6px 0 0; }
  .live-maps { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; }
  .live-maps .round { margin-top: 0; }
  .export-edition { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: var(--fs-sm); }
  .edition-said { flex: 1; min-width: 0; display: flex; flex-direction: column; color: var(--text-3); font-size: var(--fs-xs); }
  .checking { color: var(--text-3); font-size: var(--fs-xs); margin: 10px 0 0; }
  .before {
    margin-top: 12px; border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--border)); border-radius: var(--r-md);
    background: color-mix(in srgb, var(--warn) 7%, var(--bg-1)); font-size: var(--fs-sm);
  }
  .before-head {
    display: flex; align-items: center; gap: 6px; margin: 0; padding: 7px 10px 5px; color: var(--warn); font-size: var(--fs-sm); font-weight: 600;
  }
  .before-notes { max-height: 260px; overflow: auto; padding: 0 0 5px; }
  .before-note { margin: 6px 10px 1px; color: var(--text-2); font-size: var(--fs-xs); font-weight: 600; }
  .before-list { list-style: none; margin: 0; padding: 0; }
  .before-item { display: flex; flex-wrap: wrap; align-items: center; gap: 0 8px; min-height: 26px; padding: 1px 6px 1px 10px; color: var(--text-1); }
  .before-item::before { content: ''; flex: none; width: 5px; height: 5px; border-radius: 50%; background: var(--warn); }
  .before-item[data-kind='missing']::before { background: var(--danger); }
  .before-words { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .before-item .btn { flex: none; }
  .modal-label { display: block; color: var(--text-2); font-size: var(--fs-sm); margin-bottom: 4px; }
  .modal-row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
  .mono { font-family: var(--font-mono); }
</style>
