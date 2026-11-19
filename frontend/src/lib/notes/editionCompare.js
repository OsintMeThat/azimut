/**
 * What changed between two public editions of a note, or one and the note now, as the
 * Editions dialog shows it (`engine/notediff.py` answers `editions/compare`).
 *
 * The texts are the ones the note kept when each public edition was exported, by their
 * SHA-256: an edition's text is offered once, however many formats printed it. The
 * answer is a sentence per figure that changed (a chart, a table, a picture, a map) and
 * the words that changed, paragraph by paragraph. **Write the correction from this**
 * turns it into the What changed line of the next export (`draftCorrection`), which the
 * analyst edits before anything is written. Nothing here reaches the network or a file.
 */
import { api } from '../api.js';
import { MAX_CORRECTION } from './editions.svelte.js';

/** What a comparison names in place of an edition: the note as it would print now. */
export const NOW = 'now';

const HEX = /^[0-9a-f]{64}$/;
const FORMAT_WORDS = { pdf: 'PDF', html: 'HTML', web: 'Web', github: 'GitHub', wordpress: 'WordPress' };
const OPS = new Set(['=', '+', '-']);
const STATES = new Set(['changed', 'added', 'removed']);
const KINDS = new Set(['chart', 'table', 'picture', 'map', 'infographic', 'diagram', 'link']);

/** `19 Nov, 14:03`, the year said only when it is not this one. */
export function shortDay(at, now = new Date()) {
  const when = new Date(at);
  if (Number.isNaN(when.getTime())) return '';
  const year = when.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' };
  return when.toLocaleString('en-GB', { day: 'numeric', month: 'short', ...year, hour: '2-digit', minute: '2-digit' });
}

/**
 * The public texts a note kept, newest first, one per text: `{ sha, at, formats, number,
 * label }`. `at` is the newest edition that printed it, `formats` every format that did,
 * and `number` its place among the public texts the record holds, the first published 1,
 * as the Editions and corrections annex counts them: `Edition 2 · 19 Nov, 14:03 · HTML, PDF`.
 */
export function textChoices(editions, kept, now = new Date()) {
  const wanted = new Set((kept ?? []).filter((sha) => HEX.test(sha ?? '')));
  const published = [];
  const found = new Map();
  for (const edition of editions ?? []) {
    const sha = edition?.text_sha256;
    if (edition?.edition !== 'public' || !HEX.test(sha ?? '')) continue;
    if (!published.includes(sha)) published.push(sha);
    if (!wanted.has(sha)) continue;
    const held = found.get(sha);
    const format = FORMAT_WORDS[edition.format] ?? 'PDF';
    if (held) {
      if (!held.formats.includes(format)) held.formats.push(format);
      continue;
    }
    found.set(sha, { sha, at: edition.at, formats: [format] });
  }
  return [...found.values()].map((choice) => {
    const number = published.length - published.indexOf(choice.sha);
    return { ...choice, number, label: `Edition ${number} · ${shortDay(choice.at, now)} · ${choice.formats.join(', ')}` };
  });
}

/** The pair the dialog opens on: the newest kept text against the note now. */
export function firstPair(choices) {
  return { before: choices[0]?.sha ?? '', after: NOW };
}

/** Ask the server what changed from `before` (a kept text) to `after` (another, or `now`). */
export async function compareEditions(caseId, noteId, before, after) {
  const answer = await api.post(`/api/cases/${caseId}/notes/${noteId || 'case'}/editions/compare`, { before, after });
  return readComparison(answer);
}

/** A comparison as the server answers it, every part checked; null when it is none. */
export function readComparison(answer) {
  if (!answer || typeof answer !== 'object') return null;
  const sentences = (Array.isArray(answer.sentences) ? answer.sentences : [])
    .filter((item) => item && typeof item.said === 'string' && item.said)
    .map((item) => ({
      kind: KINDS.has(item.kind) ? item.kind : 'other',
      said: item.said,
      figure: typeof item.figure === 'string' ? item.figure : '',
      short: typeof item.short === 'string' ? item.short : '',
    }));
  const paragraphs = (Array.isArray(answer.paragraphs) ? answer.paragraphs : [])
    .filter((item) => item && STATES.has(item.state) && Array.isArray(item.parts))
    .map((item) => ({
      state: item.state,
      under: typeof item.under === 'string' ? item.under : '',
      heading: item.heading === true,
      what: typeof item.what === 'string' ? item.what : '',
      parts: item.parts
        .filter((part) => Array.isArray(part) && OPS.has(part[0]) && typeof part[1] === 'string')
        .map(([op, text]) => ({ op, text })),
    }));
  const count = (value) => (Number.isInteger(value) && value > 0 ? value : 0);
  return {
    same: answer.same === true,
    sentences,
    paragraphs,
    unchanged: count(answer.unchanged),
    more: count(answer.more),
  };
}

/** Where a changed paragraph stands, said over it. */
export function paragraphPlace(paragraph) {
  if (paragraph.what) return paragraph.what;
  const where = paragraph.under ? `Under “${paragraph.under}”` : 'At the start';
  if (paragraph.state === 'added') return `${where} · new ${paragraph.heading ? 'heading' : 'paragraph'}`;
  if (paragraph.state === 'removed') return `${where} · ${paragraph.heading ? 'heading' : 'paragraph'} taken out`;
  return paragraph.heading ? `${where} · heading` : where;
}

function listed(parts) {
  if (parts.length <= 2) return parts.join(' and ');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** One line on the words, naming at most two sections: `Text revised in “Summary” and “Method”.` */
export function wordsLine(paragraphs) {
  const prose = (paragraphs ?? []).filter((paragraph) => !paragraph.what);
  if (!prose.length) return '';
  const places = [...new Set(prose.map((paragraph) => paragraph.under).filter(Boolean))];
  if (!places.length) return 'Text revised.';
  const named = places.slice(0, 2).map((place) => `“${place.length > 40 ? `${place.slice(0, 39).trimEnd()}…` : place}”`);
  const others = places.length - named.length;
  return `Text revised in ${listed(others ? [...named, `${others} other section${others === 1 ? '' : 's'}`] : named)}.`;
}

/**
 * The What changed line a comparison drafts: one sentence per figure in reading order,
 * its first and in the words a reader needs (`short`), then one line on the words, as
 * many as fit in `limit` characters; what does not fit is said as "Other smaller
 * changes." when that does. Empty when nothing changed.
 */
export function draftCorrection(comparison, limit = MAX_CORRECTION) {
  if (!comparison || comparison.same) return '';
  const seen = new Set();
  const figures = comparison.sentences.filter((sentence) => {
    if (!sentence.figure) return true;
    if (seen.has(sentence.figure)) return false;
    seen.add(sentence.figure);
    return true;
  });
  const pieces = [...figures.map((sentence) => sentence.short || sentence.said), wordsLine(comparison.paragraphs)]
    .filter(Boolean);
  const tail = 'Other smaller changes.';
  let line = '';
  let left = 0;
  for (const piece of pieces) {
    const next = line ? `${line} ${piece}` : piece;
    if (next.length <= limit) line = next;
    else left += 1;
  }
  if (left) {
    while (line && `${line} ${tail}`.length > limit) {
      const cut = line.lastIndexOf('. ');
      line = cut > 0 ? line.slice(0, cut + 1) : '';
    }
    line = line ? `${line} ${tail}` : tail;
  }
  return line.slice(0, limit);
}
