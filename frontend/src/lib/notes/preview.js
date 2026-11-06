/**
 * The Page pane's PDF: the note as the server would print it, asked again a
 * moment after typing stops.
 *
 * The server draws the real document from the unsaved text (`notes/preview`, or
 * `templates/note/preview` for a template, which belongs to no case) and writes
 * nothing. A request the next one makes stale is cancelled. Mermaid only runs in
 * a browser, so the diagrams the server could not draw are drawn here once, kept
 * under the key it gave, and the page is asked for again with them.
 */
import { api } from '../api.js';
import { drawDiagrams } from '../notesExport.js';
import { warningKind } from './warnings.js';

export const PREVIEW_DELAY = 900;
const KEPT_DIAGRAMS = 30;
const SENT_DIAGRAMS = 24;

/** Diagrams drawn in this tab, as base64 PNGs by the server's key. */
const drawn = new Map();
/** Keys Mermaid could not draw: the server keeps their source in the page, and they are not tried again. */
const failed = new Set();

export function keepDiagram(key, png) {
  drawn.delete(key);
  drawn.set(key, png);
  while (drawn.size > KEPT_DIAGRAMS) drawn.delete(drawn.keys().next().value);
}

/** For tests: forget the diagrams drawn so far. */
export function forgetDiagrams() {
  drawn.clear();
  failed.clear();
}

/** A JSON list the server put in a header, or none when it is missing or unreadable. */
export function headerList(headers, name) {
  try {
    const value = JSON.parse(headers?.get?.(name) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/**
 * Ask the server for the PDF of `text`. With a `caseId`, as note `note` of that
 * case; without one, as a template, its pictures and chips drawn as stand-ins.
 * `edition` is `internal` or `public`, the second without the internal passages.
 */
export async function fetchPreview({ caseId = '', note = 'case', title = '', text = '', look, diagrams = {}, edition = 'internal' }, signal) {
  const url = caseId ? `/api/cases/${caseId}/notes/preview` : '/api/templates/note/preview';
  const body = { title, text, look, diagrams, edition };
  if (caseId) body.note = note || 'case';
  const { data, headers } = await api.postBytes(url, body, { signal });
  return {
    data,
    pages: headerList(headers, 'X-Note-Pages').map((line) => Math.max(0, Number(line) || 0)),
    diagrams: headerList(headers, 'X-Note-Diagrams').filter((item) => item && typeof item.key === 'string'),
    warnings: noteWarnings(headers),
    pictures: headerList(headers, 'X-Note-Pictures').filter(placedPicture),
    internal: internalHeader(headers),
  };
}

/** How many internal passages the note holds, chapters included, as `X-Note-Internal` says. */
export function internalHeader(headers) {
  const count = Number(headers?.get?.('X-Note-Internal') ?? 0);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

/**
 * What the page warns about, each with the 0-based line it is about, or null, and
 * its kind (`lib/notes/warnings.js`). `X-Note-Warning-Lines` and
 * `X-Note-Warning-Kinds` run beside `X-Note-Warnings`; a list that does not pair
 * up gives no warning a line, or a kind, rather than the wrong one.
 */
export function noteWarnings(headers) {
  const texts = headerList(headers, 'X-Note-Warnings').map(String);
  const lines = headerList(headers, 'X-Note-Warning-Lines');
  const kinds = headerList(headers, 'X-Note-Warning-Kinds');
  const paired = lines.length === texts.length;
  const kinded = kinds.length === texts.length;
  return texts.map((text, index) => {
    const line = paired ? lines[index] : null;
    return { text, line: Number.isInteger(line) && line >= 0 ? line : null, kind: warningKind(kinded ? kinds[index] : null) };
  });
}

const fraction = (value) => Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * A picture as the server placed it: its line, what it shows, its page and box as
 * fractions of the page, and when it was pushed to the next page, the gap it left
 * there (`[page, top, bottom, left, right]`) with the width that keeps it.
 */
export function placedPicture(item) {
  return Boolean(item) && typeof item.ref === 'string' && item.ref !== ''
    && Number.isInteger(item.line) && Number.isInteger(item.page)
    && Array.isArray(item.box) && item.box.length === 4 && item.box.every(fraction)
    && (item.gap === undefined || (Array.isArray(item.gap) && item.gap.length === 5
      && Number.isInteger(item.gap[0]) && item.gap.slice(1).every(fraction)));
}

/** The 0-based source line a page starts at, by its index. */
export function pageLine(pages, index) {
  return pages?.[index] ?? 0;
}

/** The longest a pane waits after typing stops, however long its pages take. */
export const MOST_DELAY = 4000;

/**
 * The preview of one pane. `ask(request)` waits for typing to stop, `now(request)`
 * does not. One request is in flight at a time: the server lays a note out to the
 * end even when its asker gave up, so cancelling only queued the next behind it.
 * A request made meanwhile waits its turn, and only the newest of those is asked.
 * A note whose pages took long to draw waits as long after typing stops, up to
 * `MOST_DELAY`, so a long report is not laid out again at every pause.
 *
 * `onresult({ data, pages, warnings, pictures })` is called with each answer, the
 * older one first while a newer is drawn, `onerror(message)` when one failed, and
 * `onbusy(flag)` while any is being drawn or waits for its turn.
 */
export function createPreview({
  fetch: fetchPdf = fetchPreview,
  draw = drawDiagrams,
  delay = PREVIEW_DELAY,
  onresult = () => {},
  onerror = () => {},
  onbusy = () => {},
  now: clock = () => Date.now(),
} = {}) {
  let timer = null;
  let controller = null;
  /** The newest request made while another was in flight. */
  let queued = null;
  /** The requests in flight and queued, done when both are. */
  let flight = null;
  /** Moved on by `stop`, which leaves nothing of what was asked before it. */
  let ticket = 0;
  /** How long the last pages took, in milliseconds. */
  let took = 0;
  /** The keys this pane was asked for, newest last: the diagrams it sends. */
  let wanted = [];

  const sent = () => Object.fromEntries(wanted.filter((key) => drawn.has(key)).map((key) => [key, drawn.get(key)]));
  const want = (key) => {
    wanted = [...wanted.filter((item) => item !== key), key].slice(-SENT_DIAGRAMS);
  };

  async function once(request, current) {
    const mine = new AbortController();
    controller = mine;
    const started = clock();
    try {
      let answer = await fetchPdf({ ...request, diagrams: sent() }, mine.signal);
      if (answer.diagrams.length) {
        const missing = answer.diagrams.filter((item) => !drawn.has(item.key) && !failed.has(item.key));
        const pngs = missing.length ? await draw(missing) : {};
        if (current !== ticket) return;
        for (const [key, png] of Object.entries(pngs)) keepDiagram(key, png);
        for (const item of missing) if (!pngs[item.key]) failed.add(item.key);
        if (failed.size > KEPT_DIAGRAMS) failed.delete(failed.values().next().value);
        // asked again once, with every diagram there is now a picture of
        const ready = answer.diagrams.filter((item) => drawn.has(item.key));
        for (const item of ready) want(item.key);
        if (ready.length) answer = await fetchPdf({ ...request, diagrams: sent() }, mine.signal);
      }
      if (current !== ticket) return;
      took = clock() - started;
      onresult(answer);
    } catch (error) {
      if (current !== ticket || error?.name === 'AbortError') return;
      onerror(String(error?.message || error || 'The page could not be drawn').split('\n')[0]);
    } finally {
      if (controller === mine) controller = null;
    }
  }

  function run(request) {
    clearTimeout(timer);
    timer = null;
    if (flight) {
      queued = request;
      return flight;
    }
    onbusy(true);
    flight = (async () => {
      let next = request;
      let current = ticket;
      while (next) {
        current = ticket;
        queued = null;
        await once(next, current);
        next = queued;
      }
      flight = null;
      if (current === ticket) onbusy(false);
    })();
    return flight;
  }

  return {
    ask(request) {
      clearTimeout(timer);
      timer = setTimeout(() => void run(request), Math.max(delay, Math.min(took, MOST_DELAY)));
    },
    now: (request) => run(request),
    /** Nothing more: the waiting request is dropped and the one in flight cancelled. */
    stop() {
      clearTimeout(timer);
      timer = null;
      queued = null;
      ticket += 1;
      controller?.abort();
      controller = null;
    },
  };
}
