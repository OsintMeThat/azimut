/**
 * What the note in the extension's panel puts in, from the facts the extension sends
 * (`panel.js`): the page cited, a passage quoted, a capture shown. Each is an offer
 * for `putInNote`, so it lands like every tool's put: at the cursor or the note's
 * end, lit, with Undo, which sends what was filed only for it to the Trash.
 *
 * Nothing here reaches the network. The page is looked up in the case first, and
 * the item filed for it is cited. When the case holds none, the page is kept as a
 * bookmark, named from its address, or from the title the page gave itself when the
 * address says nothing better.
 */
import { api } from '../api.js';
import { createBookmark } from '../bookmarks.js';
import { entityReference } from '../markdown.js';
import { reloadCase } from '../state.svelte.js';
import { pinnedNote, putInNote, shortTitle } from './putInNote.svelte.js';
import { asPosted, lookupSource, QUOTE_MAX } from './sources.js';
import { picturePut } from './syntax.js';
import { passageLink } from './textFragment.js';

/** How recent a capture the extension filed must be for Undo to trash it with the text. */
export const FRESH_CAPTURE_MS = 10 * 60 * 1000;

/** What the panel shows as a picture: a file of the case. */
const PICTURES = new Set(['capture', 'media']);

/** The page's item in the case: the one already filed for it, else a bookmark kept now. */
export async function pageRecord(caseId, { url, title = '' }, { lookup = lookupSource, make = createBookmark, reload = reloadCase } = {}) {
  const answer = await lookup(caseId, url, { title });
  const held = answer?.found?.[0];
  if (held?.id) return { entity: held, filed: [] };
  const entity = await make(caseId, { title: answer?.title || title || url, url });
  await reload();
  return { entity, filed: [entity.id] };
}

/** A Markdown link's address, its parentheses encoded when one would end the link early. */
function linkAddress(href) {
  let depth = 0;
  for (const mark of href) {
    if (mark === '(') depth += 1;
    else if (mark === ')' && --depth < 0) break;
  }
  return depth === 0 ? href : href.replace(/\(/g, '%28').replace(/\)/g, '%29');
}

/**
 * A passage quoted from a page: its words as a link to the passage itself, then the
 * page's chip. `> [“the words”](https://site/a#:~:text=…) [[entity:…|Title]]`. The
 * words keep their order and spelling, their spacing collapsed, and are cut past
 * `QUOTE_MAX` with a mark.
 */
export function quoteMarkdown({ url, text, record = null }) {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!words) return '';
  const long = words.length > QUOTE_MAX;
  const kept = long ? words.slice(0, QUOTE_MAX).replace(/\s+\S*$/, '') : words;
  const said = `“${asPosted(kept)}${long ? ' \\[…\\]' : ''}”`;
  const link = passageLink(url, text);
  const chip = record?.id ? ` ${entityReference(record)}` : '';
  return `> ${link ? `[${said}](${linkAddress(link)})` : said}${chip}`;
}

/** Whether Undo may trash a capture with the text: one the extension filed a moment ago. */
export function freshCapture(entity, now = Date.now()) {
  const made = Date.parse(entity?.provenance?.at ?? '');
  const age = now - made;
  return entity?.type === 'capture' && entity.provenance?.by === 'ingest' && Number.isFinite(age)
    && age > -60_000 && age <= FRESH_CAPTURE_MS;
}

/** Cite the page: its item's chip, at the cursor. */
export function citeOffer(caseId, { url, title }, deps = {}) {
  return {
    id: 'cite',
    put: async () => {
      const { entity, filed } = await pageRecord(caseId, { url, title }, deps);
      return { text: entityReference(entity), inline: true, filed };
    },
  };
}

/** Quote the words selected on the page, linked to the passage, with the page's chip. */
export function quoteOffer(caseId, { url, title, text }, deps = {}) {
  return {
    id: 'quote',
    put: async () => {
      const { entity, filed } = await pageRecord(caseId, { url, title }, deps);
      return { text: quoteMarkdown({ url, text, record: entity }), filed };
    },
  };
}

/** The capture the extension filed, read back as the case holds it; an Error when it is not there. */
async function filedPicture(caseId, entityId, { get, reload }) {
  let entity = null;
  try {
    entity = (await get(`/api/cases/${caseId}/entities/${entityId}/chain`))?.entity ?? null;
  } catch {
    entity = null;
  }
  if (!entity?.id || !entity.attrs?.path || !PICTURES.has(entity.type)) throw new Error('That capture is not in this case');
  // the note draws a picture from the case's records, which must hold it by now
  await reload();
  return entity;
}

/** Show a capture the extension filed, as a picture whose caption is asked for. */
export function pictureOffer(caseId, { entityId }, { get = api.get, reload = reloadCase, now = Date.now } = {}) {
  return {
    id: 'picture',
    picture: true,
    put: async () => {
      const entity = await filedPicture(caseId, entityId, { get, reload });
      return { text: picturePut(entity), filed: freshCapture(entity, now()) ? [entity.id] : [] };
    },
  };
}

/**
 * A capture the extension filed on its own (the tools' Capture over a map), put in from
 * the toast that says it was filed. It was taken for itself, not for the note, so Undo
 * takes the picture back out and leaves the capture in the case.
 */
export function capturedOffer(caseId, entityId, { get = api.get, reload = reloadCase } = {}) {
  return {
    id: 'picture',
    picture: true,
    put: async () => ({ text: picturePut(await filedPicture(caseId, entityId, { get, reload })), filed: [] }),
  };
}

/** What the app accepts as an entity id from an event. */
const ENTITY_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The action the toast saying the extension filed a capture (`ev`, the server's
 * `capture` event) offers: `Put in “<note>”`, while a note of that case is on the side.
 * None for a capture the notes panel took for its own note, which it puts in itself.
 */
export function captureToastAction(ev, { target = pinnedNote(), put = putInNote, deps = {} } = {}) {
  if (!target?.caseId || target.caseId !== ev?.case_id || ev.for_note || !ENTITY_ID.test(String(ev.entity_id ?? ''))) return null;
  return {
    label: `Put in “${shortTitle(target.title)}”`,
    onClick: () => void put(capturedOffer(ev.case_id, ev.entity_id, deps)),
  };
}

/** The offer a put from the extension makes. */
export function panelOffer(caseId, put, deps = {}) {
  if (put.action === 'cite') return citeOffer(caseId, put, deps);
  if (put.action === 'quote') return quoteOffer(caseId, put, deps);
  if (put.action === 'picture') return pictureOffer(caseId, put, deps);
  return null;
}
