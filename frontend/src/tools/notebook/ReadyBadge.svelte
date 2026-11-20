<script>
  /**
   * Ready to publish? for a note outside the Notebook: the extension's panel
   * (`components/NotePanel.svelte`). The badge says how many lines the panel would list,
   * read once the note is loaded and again a while after each change, as the Notebook's
   * does; a press opens the same panel (`ReadyPanel.svelte`) over the note.
   *
   * The check is the one the export would make in the Notebook, in the format and
   * edition it would open on (`lib/notes/readyPanel.js`). Its fixes are the Notebook's,
   * those that write in the note as one Undo each, *Archive every link…* and *Bookmark
   * them*; nothing exports here, so the panel's foot opens the note in Azimut (`onexport`).
   */
  import { onDestroy, untrack } from 'svelte';
  import Icon from '../../components/Icon.svelte';
  import ArchiveLinks from './ArchiveLinks.svelte';
  import ReadyPanel from './ReadyPanel.svelte';
  import { toast } from '../../lib/state.svelte.js';
  import { CASE_NOTES, flush } from '../../lib/notes/noteDoc.svelte.js';
  import { badgeWords, checkReady, issueCount, readyLines, runFix } from '../../lib/notes/readyPanel.js';
  import { readFormat } from '../../lib/notes/formats.js';
  import { editionOf } from '../../lib/notes/editions.svelte.js';
  import { readAddress } from '../../lib/notes/webAddress.js';
  import { chartRows } from '../../lib/notes/editor/chartFigure.js';
  import { bookmarkLinks } from '../../lib/notes/sources.js';
  import { onEnded, readPlan } from '../../lib/notes/linkArchive.svelte.js';
  import { jumpFor } from '../../lib/notes/warnings.js';

  let {
    caseId,
    /** The note, null for the case notes. */
    noteId = null,
    title = 'Case notes',
    /** Its shared copy (`noteDoc.svelte.js`): the badge is read once it is loaded, and after it changes. */
    doc,
    /** The note editor's handle, which a fix writes through. */
    editor = null,
    /** The foot's Open in Azimut, to export the note there. */
    onexport = () => {},
    /** Go to: the note at `line`, with `editor.jump`'s options. */
    ongo = () => {},
  } = $props();

  /** How long the badge waits once typing stops before it asks the check again: a long note's check lays its page out whole. */
  const QUIET_MS = 15000;

  const id = $derived(noteId ?? CASE_NOTES);
  const key = $derived(caseId && doc?.loaded && !doc.error ? `${caseId}/${id}` : '');
  /** What the badge says, for the note it was read for: `{ key, issues }`. */
  let badge = $state(null);
  let open = $state(false);
  let answer = $state(null);
  let checking = $state(false);
  let failed = $state('');
  let busy = $state('');
  let archiving = $state(false);
  let timer;
  let badgeController = null;
  let panelController = null;

  /** The format and edition the export would open on, in this browser. */
  const choice = (note) => ({ format: readFormat('export'), edition: editionOf(caseId, note), address: readAddress(caseId, note) });
  const count = (said) => issueCount(readyLines(said, { tools: false }));

  // read once the note is loaded, then a while after each change; never while the panel asks
  $effect(() => {
    const now = key;
    void doc?.text;
    clearTimeout(timer);
    if (!now) return;
    const first = untrack(() => badge?.key) !== now;
    timer = setTimeout(() => untrack(() => readBadge(now)), first ? 400 : QUIET_MS);
    return () => clearTimeout(timer);
  });

  async function readBadge(now) {
    if (open || now !== key) return;
    badgeController?.abort();
    const mine = new AbortController();
    badgeController = mine;
    const note = id;
    try {
      if (doc) await flush(doc);
      const said = await checkReady(caseId, note, { ...choice(note), signal: mine.signal });
      if (badgeController === mine && now === key) badge = { key: now, issues: count(said) };
    } catch {
      // a check that fails leaves the badge as it was
    } finally {
      if (badgeController === mine) badgeController = null;
    }
  }

  function openReady() {
    badgeController?.abort();
    open = true;
    answer = null;
    failed = '';
    void ask();
  }

  function closeReady() {
    panelController?.abort();
    panelController = null;
    open = false;
    checking = false;
  }

  /** The check for the panel, from the note as saved; the badge follows it. */
  async function ask() {
    if (!open || !key) return;
    panelController?.abort();
    const mine = new AbortController();
    panelController = mine;
    checking = true;
    const now = key;
    try {
      if (doc) await flush(doc);
      const said = await checkReady(caseId, id, { ...choice(id), signal: mine.signal });
      if (panelController !== mine) return;
      answer = said;
      failed = '';
      if (now === key) badge = { key: now, issues: count(said) };
    } catch (error) {
      if (panelController === mine && error?.name !== 'AbortError') failed = error.message;
    } finally {
      if (panelController === mine) {
        panelController = null;
        checking = false;
      }
    }
  }

  const canEdit = $derived(Boolean(open && editor && doc?.loaded && !doc.elsewhere));

  /** One change the panel worked out, written into the note as one Undo step. */
  function write(change, missing) {
    if (!change || !editor?.replace(change.from, change.to, change.insert, change.expected)) {
      toast(missing, 'warn', 4500);
      return false;
    }
    return true;
  }

  async function fix(line) {
    if (!open || !line?.fix || busy) return;
    busy = line.key;
    try {
      const again = await runFix(line, {
        noteId: id,
        caseId,
        text: () => editor?.text() ?? '',
        write,
        rows: chartRows,
        archive: () => (archiving = true),
        bookmark: async (links) => {
          const plan = await readPlan(caseId, id).catch(() => null);
          const { filed, failed: missed } = await bookmarkLinks(caseId, links, { folder: plan?.folder ?? '' });
          if (filed) toast(`${filed} ${filed === 1 ? 'bookmark' : 'bookmarks'} filed${plan?.folder ? ` in ${plan.folder}` : ''}`, 'ok', 3500);
          if (missed) toast(missed, 'warn', 5000);
        },
        // only the Notebook offers these (`readyLines`, `tools`)
        round: () => {},
        open: () => {},
      });
      if (again) await ask();
    } catch (error) {
      toast(error.message, 'danger');
    } finally {
      busy = '';
    }
  }

  function go(line) {
    closeReady();
    ongo(line.line, jumpFor(line));
  }

  /** The archive dialog closed: the panel counts the links again. */
  function closeArchive() {
    archiving = false;
    if (open) void ask();
  }
  // a run that ends while the panel is open drops its count there
  $effect(() => onEnded(() => { if (open) void ask(); }));

  onDestroy(() => {
    clearTimeout(timer);
    badgeController?.abort();
    panelController?.abort();
  });
</script>

{#if badge && badge.key === key}
  <button type="button" class="btn btn-ghost btn-xs ready-badge" class:clear={!badge.issues}
    title="Ready to publish? What the check before export says, in one place" aria-label={`Ready to publish? ${badgeWords(badge.issues)}`}
    aria-haspopup="dialog" onclick={openReady}>
    {#if badge.issues}<span class="ready-dot" aria-hidden="true"></span><span>{badge.issues}<span class="ready-words">{' to look at'}</span></span>
    {:else}<Icon name="check" size={12} /><span class="ready-words">Ready</span>{/if}</button>
{/if}

{#if open}
  <ReadyPanel {title} ready={answer} {checking} {failed} {canEdit} {busy} tools={false}
    onfix={fix} ongo={go} onclose={closeReady} onexport={() => { closeReady(); onexport(); }} />
{/if}

{#if archiving}
  <ArchiveLinks {caseId} noteId={id} {title} onclose={closeArchive} />
{/if}

<style>
  .ready-badge { flex: none; gap: 5px; color: var(--text-2); font-weight: 500; white-space: nowrap; }
  .ready-badge.clear :global(svg) { color: var(--ok); }
  .ready-dot { flex: none; width: 6px; height: 6px; border-radius: 50%; background: color-mix(in srgb, var(--warn) 75%, var(--text-3)); }
</style>
