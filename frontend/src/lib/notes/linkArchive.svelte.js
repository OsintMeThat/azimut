/**
 * Archive every link of a note (`engine/linkarchive.py`): what a press would do, the
 * press, the run as it goes, and the words the dialog says them in.
 *
 * Reading the plan or the run asks the server only; the press is the one call that
 * has the server reach the Internet Archive. A run started in this tab is followed
 * tab-wide (`follow`), whichever tool or note is on screen, so the note's header can
 * say *Archiving 12 of 70…* and a toast says when it ends; nothing is followed on
 * mount.
 */
import { api } from '../api.js';
import { toast } from '../state.svelte.js';

/** How often a run under way is read again. */
export const POLL_MS = 2000;
/** A copy younger than this many days is reused unless fresh copies are asked for. */
export const REUSE_DAYS = 30;
const ACTIVE = ['queued', 'running', 'stopping'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** What the dialog says before the press, once: what goes out, to whom, and that it is free. */
export const SENDS = 'Sends each address to the Internet Archive (web.archive.org), which keeps a copy anyone can open, '
  + 'then reads each page\'s title and date back from that copy for the sources list. '
  + 'Free, no account. The archive learns which pages the note cites; nothing else leaves this computer.';

const base = (caseId, noteId) => `/api/cases/${encodeURIComponent(caseId)}/notes/${encodeURIComponent(noteId)}/archive`;

/** What a press would do: the links, the counts, the folder, the last run. Reaches nothing. */
export function readPlan(caseId, noteId, { internal = false } = {}) {
  return api.get(`${base(caseId, noteId)}${internal ? '?internal=true' : ''}`);
}

/** The note's run as it stands, or null. */
export async function readRun(caseId, noteId) {
  return (await api.get(`${base(caseId, noteId)}/run`))?.run ?? null;
}

/** The press: queue the run, and follow it. */
export async function startArchive(caseId, noteId, { internal = false, fresh = false, title = '' } = {}) {
  const run = (await api.post(base(caseId, noteId), { internal, fresh }))?.run ?? null;
  if (run) follow(caseId, noteId, run, { title });
  return run;
}

/** Stop the run, after the link under way. */
export async function stopArchive(caseId, noteId) {
  const run = (await api.post(`${base(caseId, noteId)}/stop`, {}))?.run ?? null;
  if (run) runs[keyOf(caseId, noteId)] = run;
  return run;
}

export function isActive(run) {
  return ACTIVE.includes(run?.state);
}

// -- the runs this tab follows -----------------------------------------------------

/** Each run followed, by `case/note`: as last read. */
export const runs = $state({});
const timers = new Map();
const listeners = new Set();

const keyOf = (caseId, noteId) => `${caseId}/${noteId}`;

/** The run this tab follows for a note, or null. */
export function followed(caseId, noteId) {
  return runs[keyOf(caseId, noteId)] ?? null;
}

/** Hear every followed run that ends: `(caseId, noteId, run)`. Returns how to stop hearing. */
export function onEnded(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Follow a run until it ends, reading it every `POLL_MS`; once ended, a toast says how
 * and the listeners hear it. Following one already followed only refreshes it.
 */
export function follow(caseId, noteId, run, { title = '', wait = POLL_MS } = {}) {
  const key = keyOf(caseId, noteId);
  runs[key] = run;
  if (!isActive(run) || timers.has(key)) return;
  const tick = async () => {
    let next = null;
    try {
      next = await readRun(caseId, noteId);
    } catch {
      next = runs[key];
    }
    if (next) runs[key] = next;
    if (next && isActive(next)) {
      timers.set(key, setTimeout(tick, wait));
      return;
    }
    timers.delete(key);
    if (next) {
      const [words, kind] = endedToast(next, title);
      toast(words, kind, 6500);
    }
    for (const listener of listeners) listener(caseId, noteId, next);
  };
  timers.set(key, setTimeout(tick, wait));
}

/** Forget every followed run (tests, a case closed). */
export function forgetRuns() {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  for (const key of Object.keys(runs)) delete runs[key];
}

// -- words ----------------------------------------------------------------------------

const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** `18 Nov` for a day, `18 Nov 09:30` with its time, in this browser's time; '' when unread. */
export function dayWords(value, { time = false } = {}) {
  const text = String(value ?? '');
  const when = new Date(text.length === 10 ? `${text}T12:00:00Z` : text);
  if (!text || Number.isNaN(when.getTime())) return '';
  const day = `${when.getDate()} ${MONTHS[when.getMonth()]}`;
  if (!time || text.length === 10) return day;
  const clock = `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`;
  return `${day} ${clock}`;
}

/** `about 12 minutes left`, from the run's own guess in seconds. */
export function leftWords(seconds) {
  const left = Number(seconds);
  if (!Number.isFinite(left) || left <= 0) return '';
  if (left < 60) return 'under a minute left';
  const minutes = Math.round(left / 60);
  if (minutes === 1) return 'about a minute left';
  if (minutes < 90) return `about ${minutes} minutes left`;
  return `about ${Math.round(minutes / 60)} hours left`;
}

/** What a press would do, said once: `88 to archive · 2 archived already · 85 filed as new bookmarks`. */
export function planWords(plan) {
  if (!plan) return '';
  const said = [`${plural(plan.todo ?? 0, 'link')} to archive`];
  if (plan.archived) said.push(`${plan.archived} archived already`);
  if (plan.titles) said.push(`${plural(plan.titles, 'page title')} to read`);
  if (plan.filed) said.push(`${plan.filed} filed as ${plan.filed === 1 ? 'a bookmark' : 'bookmarks'}`);
  return said.join(' · ');
}

/** What the press button says: the links it archives, else the titles it reads. */
export function pressWords(plan) {
  const todo = plan?.todo ?? 0;
  const titles = plan?.titles ?? 0;
  if (todo) return `Archive ${plural(todo, 'link')}`;
  if (titles) return `Read ${plural(titles, 'page title')}`;
  return 'Every link is archived';
}

/** The run's head: `34 of 88 archived`, and failures when there are some. */
export function countWords(run) {
  const counts = run?.counts ?? {};
  const said = `${counts.archived ?? 0} of ${counts.total ?? 0} archived`;
  return counts.failed ? `${said} · ${counts.failed} failed` : said;
}

/** The note header's line while a run goes: `Archiving 34 of 88…`. */
export function progressWords(run) {
  const counts = run?.counts ?? {};
  if (run?.state === 'stopping') return 'Stopping the archiving…';
  return `Archiving ${counts.archived ?? 0} of ${counts.total ?? 0}…`;
}

/** What one link's row says, by its state. */
export function rowWords(link) {
  switch (link?.state) {
    case 'new': return `new copy, ${dayWords(link.made, { time: true })}`;
    case 'kept': return `copy of ${dayWords(link.made)} kept (under ${REUSE_DAYS} days)`;
    case 'older': return link.gone ? `no longer online · copy of ${dayWords(link.made)} linked`
      : `no new copy · copy of ${dayWords(link.made)} linked`;
    case 'failed': return link.reason || 'no copy';
    case 'saving': return 'saving…';
    case 'archived': return `${link.made ? `archived ${dayWords(link.made)}` : 'archived'}${link.untitled ? ' · title to read' : ''}`;
    case 'todo':
      if (link.reason) return `last time: ${link.reason.charAt(0).toLowerCase()}${link.reason.slice(1)}`;
      return link.held ? 'to archive' : 'to archive · new bookmark';
    default: return 'waiting';
  }
}

/** Which mark a row shows: done, warned, failed, under way or waiting. */
export function rowMark(link) {
  if (['new', 'kept', 'archived'].includes(link?.state)) return 'done';
  if (link?.state === 'older') return 'warn';
  if (link?.state === 'failed') return 'failed';
  if (link?.state === 'saving') return 'busy';
  return 'waiting';
}

/** What a toast says once a followed run ends, and its kind. */
export function endedToast(run, title = '') {
  const of = title ? ` of “${title}”` : '';
  const counts = run?.counts ?? {};
  if (run?.state === 'stopped') return [`Archiving the links${of} stopped: ${countWords(run)}. ${run.reason ?? ''}`.trim(), 'warn'];
  if (counts.failed) return [`Links${of} archived: ${countWords(run)}. Archive every link tries the rest again.`, 'warn'];
  return [`Links${of} archived: ${countWords(run)}.`, 'ok'];
}
