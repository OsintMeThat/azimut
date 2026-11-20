// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { noteExtensions, setNoteCase } from '../liveMarkdown.js';
import { CARET_MS, HOVER_MS, LEAVE_MS, byLine, cardModel, caretCitation, citationAt, linkWords, longDay, shownCard } from './citationCard.js';
import { citedTimes } from './linkField.js';
import { setFocused } from './state.js';

/**
 * The citation card: what the case knows of a chip's item or a written link's page, its
 * actions, its three states (a case item, a page the case lacks, an item gone), read
 * through the editor's handlers alone, on hover or with the cursor resting in it.
 */

const POST = 'https://x.com/MMY1444/status/2122054923298996698';
const PAGE = 'https://www.aljazeera.com/news/2026/9/10/houthis-seize-mocha';
const BBC = 'https://www.bbc.com/news/articles/cw8rzd6lp0xpo';
const COPY = `https://web.archive.org/web/20261112093012/${BBC}`;
const SHA = 'e1e32f4fcf40a0bcde7d2a638076d1a2995b8c96ccb0b53f198838f246cee09b';

const ENTITIES = [
  { id: 'v1', type: 'media', label: 'Ground tour, video 1', attrs: { path: 'media/tour.mp4', kind: 'video', source_url: POST, sha256: SHA } },
  { id: 'p53', type: 'proof', label: 'YEMEN Proof 53', attrs: { path: 'proofs/YEMEN Proof 53.png', thumb: 'media/.thumbs/p53-g1.jpg' } },
  { id: 'b1', type: 'bookmark', label: 'Yemen: government forces pull back', attrs: { url: BBC, archive_url: COPY } },
  { id: 'q1', type: 'place', label: 'Quay north', attrs: {} },
];

/** What the server says of each item, as `/sources/item` answers. */
const KNOWN = {
  v1: {
    known: { id: 'v1', type: 'media', label: 'Ground tour, video 1', noun: 'Video', address: POST, author: 'Yemeni Military Media', published: '2026-11-15',
      archive: '', archived_at: '', seen: '2026-11-16', arrival: 'collected', sha256: SHA, thumb: 'media/.thumbs/v1-g1.jpg' },
    reference: `Ground tour, video 1 · Video · x.com · by Yemeni Military Media · posted 15 November 2026 · collected 16 November 2026. ${POST} SHA-256 ${SHA}`,
  },
  p53: {
    known: { id: 'p53', type: 'proof', label: 'YEMEN Proof 53', noun: 'Proof', address: '', author: '', published: '', archive: '', archived_at: '',
      seen: '2026-11-17', arrival: 'made', sha256: '', thumb: 'media/.thumbs/p53-g1.jpg' },
    reference: 'YEMEN Proof 53 · Proof · made 17 November 2026.',
  },
  b1: {
    known: { id: 'b1', type: 'bookmark', label: 'Yemen: government forces pull back', noun: 'Web page', address: BBC, author: '', published: '2026-10-05',
      archive: COPY, archived_at: '2026-11-12', seen: '2026-11-17', arrival: 'collected', sha256: '', thumb: '' },
    reference: `Yemen: government forces pull back · Web page · bbc.com · posted 5 October 2026 · collected 17 November 2026. ${BBC} Archive: ${COPY}`,
  },
  q1: { known: { id: 'q1', type: 'place', label: 'Quay north', noun: 'Place', address: '', author: '', published: '', archive: '', archived_at: '', seen: '', arrival: 'collected', sha256: '', thumb: '' }, reference: '' },
};

let view;
let handlers;
let fetched;

function editor(text, { mode = 'drawn', at = 0 } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc: text, selection: EditorSelection.cursor(at), extensions: noteExtensions({ handlers, mode }) }) });
  // happy-dom answers focus() with a selection of its own, which a browser does not; the editor is made focused by its state
  view.focus = vi.fn();
  view.dispatch({ effects: [setNoteCase.of({ caseId: 'c1', entities: ENTITIES })] });
  return view;
}

const card = () => view.dom.querySelector('.cm-cite');
const rows = () => [...card().querySelectorAll('dt')].map((dt) => [dt.textContent, dt.nextElementSibling.textContent]);
const actions = () => [...card().querySelectorAll('[data-action]')].map((node) => node.textContent);
const action = (id) => card().querySelector(`[data-action="${id}"]`);

async function settle(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  for (let round = 0; round < 10; round += 1) await Promise.resolve();
}

/** Rest the pointer on the chip of `id`. */
async function hoverChip(id) {
  const chip = view.contentDOM.querySelector(`[data-chip][data-entity-id="${id}"]`);
  chip.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 1, clientY: 1 }));
  return chip;
}

/** Put the cursor, the editor focused, inside the first `words`. */
function caretIn(words, by = 2) {
  view.dispatch({ effects: setFocused.of(true) });
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.toString().indexOf(words) + by) });
}

const proofOpener = { label: 'Open in Geo Proof', open: vi.fn() };

beforeEach(() => {
  vi.useFakeTimers();
  fetched = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('the card fetches nothing'); });
  handlers = {
    source: vi.fn(async (id) => KNOWN[id] ?? { known: null, reference: '' }),
    lookup: vi.fn(async (url, words) => (url === BBC
      ? { url, title: 'bbc.com/news/articles/cw8rzd6lp0xpo', found: [], known: KNOWN.b1.known, reference: KNOWN.b1.reference }
      : { url, title: 'aljazeera.com/news/2026/9/10/houthis-seize-mocha', found: [], known: null, reference: `${words} · Web page · aljazeera.com. ${url}` })),
    open: vi.fn(),
    opener: vi.fn((entity) => (entity.type === 'proof' ? proofOpener : null)),
    bookmark: vi.fn(async () => ({ id: 'b2', label: 'aljazeera.com/news/2026/9/10/houthis-seize-mocha' })),
  };
});

afterEach(() => {
  expect(fetched).not.toHaveBeenCalled();
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('what a citation is', () => {
  const state = EditorState.create({
    doc: 'See [[entity:v1|the video]] and [Al Jazeera, 10 Sep](https://www.aljazeera.com/x) or [row V12](#V12), `[[entity:v1|code]]`.',
    extensions: noteExtensions(),
  });

  it('is a chip or a written link to a web page, read off the text', () => {
    const text = state.doc.toString();
    expect(citationAt(state, text.indexOf('the video'))).toEqual({ kind: 'chip', from: 4, to: 27, id: 'v1', label: 'the video' });
    expect(citationAt(state, text.indexOf('Jazeera'))).toMatchObject({ kind: 'link', url: 'https://www.aljazeera.com/x', words: 'Al Jazeera, 10 Sep' });
    expect(citationAt(state, text.indexOf('row V12'))).toBeNull();
    expect(citationAt(state, text.indexOf('code'))).toBeNull();
    expect(citationAt(state, 1)).toBeNull();
  });

  it('is under the cursor only inside it, not at its edges where writing goes on', () => {
    expect(citationAt(state, 4)).not.toBeNull();
    expect(citationAt(state, 4, { inside: true })).toBeNull();
    expect(citationAt(state, 5, { inside: true })).not.toBeNull();
  });

  it('is counted in the note however its address is written', () => {
    const text = `[a](${BBC}) [b](https://bbc.com/news/articles/cw8rzd6lp0xpo/#top) [[entity:b1|c]] [d](https://bbc.com/other)`;
    expect(citedTimes(text, { id: 'b1' }, BBC)).toBe(3);
  });

  it('is read with the words of every link to its page, in the note\'s order, as the list of sources reads them', () => {
    const text = `[Al Jazeera, 10 Sep](${PAGE}) then [**Houthis seize Mocha**](${PAGE}), [again](${BBC}) and [Al Jazeera, 10 Sep](${PAGE}).`;
    expect(linkWords(text, PAGE)).toEqual(['Al Jazeera, 10 Sep', 'Houthis seize Mocha']);
  });

  it('names who posted it as the academic list leads with it', () => {
    expect(byLine({ author: 'Yemeni Military Media', account: '@MMY1444' })).toEqual({ value: 'Yemeni Military Media (@MMY1444)' });
    expect(byLine({ author: '@MMY1444 on X', account: '@MMY1444' })).toEqual({ value: '@MMY1444 on X' });
    expect(byLine({ author: '', account: '@MMY1444' })).toEqual({ value: '@MMY1444', note: 'from its address' });
    expect(byLine({ author: '', account: '' })).toBeNull();
  });

  it('says its days in words', () => {
    expect(longDay('2026-11-17T09:00:00Z')).toBe('17 November 2026');
    expect(longDay('soon')).toBe('');
  });
});

describe('what the card says', () => {
  const said = (id, more = {}) => ({ target: { kind: 'chip', id }, entity: ENTITIES.find((one) => one.id === id), item: null, cited: 1, ...more });
  const known = (id) => ({ ...said(id), item: { ...KNOWN[id].known, archivedAt: KNOWN[id].known.archived_at, full: true }, reference: KNOWN[id].reference });

  it('of a downloaded post: who, when, seen, not archived, its fingerprint, and where it leads', () => {
    const model = cardModel(known('v1'), { handlers });
    expect([model.state, model.icon, model.kicker, model.title, model.thumb]).toEqual(['item', 'video', 'Video · x.com', 'Ground tour, video 1', 'media/.thumbs/v1-g1.jpg']);
    expect(model.rows.map((row) => [row.label, row.value, row.tone ?? ''])).toEqual([
      ['Posted', '15 November 2026', ''], ['By', 'Yemeni Military Media', ''], ['Seen', '16 November 2026', ''],
      ['Archived', 'Not archived', 'warn'], ['SHA-256', 'e1e32f4f…46cee09b', 'mono'], ['In this note', 'Cited once', ''],
    ]);
    expect(model.rows[4].full).toBe(SHA);
    expect(model.actions.map((one) => [one.id, one.label])).toEqual([['open', 'Open'], ['page', 'Open page'], ['copy', 'Copy reference']]);
    expect(model.actions[1].href).toBe(POST);
  });

  it('of a post the case records no author for: the account its address names, never "Not recorded"', () => {
    const item = { ...KNOWN.v1.known, author: '', account: '@MMY1444', archivedAt: '', full: true };
    const model = cardModel({ ...said('v1'), item, reference: '' }, { handlers });
    expect(model.rows.find((row) => row.label === 'By')).toMatchObject({ value: '@MMY1444', note: 'from its address' });
    expect(model.rows.find((row) => row.label === 'By').tone).toBeUndefined();
  });

  it('of a bookmark the case archived: its copy\'s day and host, linked, and the copy among the actions', () => {
    const model = cardModel({ ...known('b1'), cited: 3 }, { handlers });
    expect(model.rows.find((row) => row.label === 'Archived')).toMatchObject({ value: '12 November 2026', note: 'web.archive.org', tone: 'ok', href: COPY });
    expect(model.rows.find((row) => row.label === 'By')).toMatchObject({ value: 'Not recorded', tone: 'muted' });
    expect(model.rows.at(-1).value).toBe('Cited 3 times');
    expect(model.actions.map((one) => one.id)).toEqual(['open', 'page', 'archive', 'copy']);
  });

  it('of a proof: the day it was made and its picture, opened in its own tool', () => {
    const model = cardModel(known('p53'), { handlers });
    expect(model.rows.map((row) => row.label)).toEqual(['Made', 'In this note']);
    expect(model.thumb).toBe('media/.thumbs/p53-g1.jpg');
    expect(model.actions.map((one) => one.label)).toEqual(['Open in Geo Proof', 'Copy reference']);
  });

  it('in the extension\'s panel, where no case is around the note: its page and its copy, never an Open that leads nowhere', () => {
    const panel = { ...handlers, opener: null, inCase: false };
    expect(cardModel(known('v1'), { handlers: panel }).actions.map((one) => one.id)).toEqual(['page', 'copy']);
    expect(cardModel(known('p53'), { handlers: panel }).actions.map((one) => one.id)).toEqual(['copy']);
  });

  it('of what the list of sources leaves out: nothing to copy', () => {
    const model = cardModel(known('q1'), { handlers });
    expect(model.rows.map((row) => row.label)).toEqual(['In this note']);
    expect(model.actions.map((one) => one.id)).toEqual(['open']);
  });

  it('of a record read without a server: never "not recorded" for what was not asked', () => {
    const model = cardModel({ ...said('b1'), item: { ...KNOWN.b1.known, author: '', published: '', full: false } }, { handlers });
    expect(model.rows.map((row) => row.label)).not.toContain('Posted');
    expect(model.rows.map((row) => row.label)).not.toContain('By');
  });

  it('of a page the case lacks: not seen, not archived, Bookmark it first, Edit link where the Link field is', () => {
    const target = { kind: 'link', url: PAGE, words: 'Al Jazeera, 10 Sep' };
    const model = cardModel({ target, item: null, title: '', reference: 'r', cited: 2 }, { handlers, canEdit: true });
    expect([model.state, model.kicker, model.title]).toEqual(['page', 'Web page · aljazeera.com', 'Al Jazeera, 10 Sep']);
    expect(model.rows.map((row) => [row.label, row.value, row.tone ?? ''])).toEqual([
      ['Seen', 'Not in the case', 'warn'], ['Archived', 'Not archived', 'warn'], ['In this note', 'Cited 2 times', ''],
    ]);
    expect(model.actions.map((one) => [one.id, Boolean(one.primary)])).toEqual([['bookmark', true], ['page', false], ['copy', false], ['edit', false]]);
    expect(cardModel({ target, item: null, reference: '', cited: 1 }, { handlers: {} }).actions.map((one) => one.id)).toEqual(['page']);
  });

  it('links only to a web address, whatever a record holds', () => {
    const item = { id: 'b3', type: 'bookmark', label: 'Odd', noun: 'Web page', address: 'javascript:alert(1)', archive: 'file:///etc/passwd', full: true };
    const model = cardModel({ ...said('b1'), item, reference: '' }, { handlers });
    expect(model.actions.map((one) => one.id)).toEqual(['open']);
    expect(model.rows.some((row) => row.href)).toBe(false);
  });

  it('of an item gone: one sentence, nothing to do', () => {
    const model = cardModel({ target: { kind: 'chip', id: 'gone', label: 'the old clip' }, missing: true });
    expect([model.state, model.title, model.line, model.rows.length, model.actions.length]).toEqual(['missing', 'the old clip', 'No longer in the case.', 0, 0]);
  });
});

describe('the card on the page', () => {
  it('shows a short rest after the pointer reaches a chip, read off the case alone', async () => {
    editor('The video [[entity:v1|video 1, 15 Nov]] was filmed.');
    await hoverChip('v1');
    await settle(HOVER_MS - 50);
    expect(card()).toBeNull();
    await settle(60);
    expect(handlers.source).toHaveBeenCalledWith('v1');
    expect(card().getAttribute('role')).toBe('dialog');
    expect(card().querySelector('.cm-cite-title').textContent).toBe('Ground tour, video 1');
    expect(card().querySelector('.cm-cite-thumb').getAttribute('src')).toBe('/files/c1/media/.thumbs/v1-g1.jpg');
    expect(rows()[0]).toEqual(['Posted', '15 November 2026']);
    expect(actions()).toEqual(['Open', 'Open page', 'Copy reference']);
    expect(action('page').getAttribute('target')).toBe('_blank');
    expect(action('page').getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('goes once the pointer has left it a moment, and stays while it is over the card', async () => {
    editor('The video [[entity:v1|video 1]] was filmed.');
    await hoverChip('v1');
    await settle(HOVER_MS + 10);
    view.dom.dispatchEvent(new MouseEvent('mouseleave'));
    card().dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await settle(LEAVE_MS + 10);
    expect(card()).not.toBeNull();
    view.dom.dispatchEvent(new MouseEvent('mouseleave'));
    await settle(LEAVE_MS + 10);
    expect(card()).toBeNull();
  });

  it('copies the reference as the list of sources prints it', async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    editor('The video [[entity:v1|video 1]] was filmed.');
    await hoverChip('v1');
    await settle(HOVER_MS + 10);
    action('copy').click();
    await settle();
    expect(write).toHaveBeenCalledWith(KNOWN.v1.reference);
    expect(action('copy').textContent).toBe('Copied');
    expect(card().querySelector('.cm-cite-status').textContent).toBe('Reference copied');
    await settle(1700);
    expect(action('copy').textContent).toBe('Copy reference');
  });

  it('opens the item in its tool, through the opener when one takes it', async () => {
    editor('A [[entity:v1|video]] and [[entity:p53|YEMEN Proof 53]].');
    await hoverChip('v1');
    await settle(HOVER_MS + 10);
    action('open').click();
    expect(handlers.open).toHaveBeenCalledWith(ENTITIES[0]);
    expect(card()).toBeNull();
    await hoverChip('p53');
    await settle(HOVER_MS + 10);
    expect(card().querySelector('.cm-cite-thumb').getAttribute('src')).toBe('/files/c1/media/.thumbs/p53-g1.jpg');
    action('open').click();
    expect(proofOpener.open).toHaveBeenCalled();
  });

  it('says an item gone is gone, and asks nothing more', async () => {
    editor('Once [[entity:gone|the old clip]] was here.');
    await hoverChip('gone');
    await settle(HOVER_MS + 10);
    expect(card().querySelector('.cm-cite-line').textContent).toBe('No longer in the case.');
    expect(handlers.source).not.toHaveBeenCalled();
    expect(card().querySelectorAll('[data-action]').length).toBe(0);
  });

  it('reads a chip in a drawn table off the page', async () => {
    const text = '| Proof |\n| --- |\n| [[entity:p53|YEMEN Proof 53]] |\n\nAfter.';
    editor(text, { at: text.length });
    const ref = view.contentDOM.querySelector('.cm-block-table [data-entity-id="p53"]');
    expect(ref).not.toBeNull();
    ref.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    await settle(HOVER_MS + 10);
    expect(card().querySelector('.cm-cite-title').textContent).toBe('YEMEN Proof 53');
    expect(actions()).toEqual(['Open in Geo Proof', 'Copy reference']);
  });
});

describe('a written link the case lacks', () => {
  it('is bookmarked from its card, which then says the day it was seen; the note is not touched', async () => {
    const text = `Mocha fell ([Al Jazeera, 10 Sep](${PAGE})).`;
    editor(text, { at: text.length });
    caretIn('Al Jazeera');
    await settle(CARET_MS + 10);
    expect(handlers.lookup).toHaveBeenCalledWith(PAGE, ['Al Jazeera, 10 Sep']);
    expect(card().classList.contains('cm-cite-page')).toBe(true);
    expect(rows()).toEqual([['Seen', 'Not in the case'], ['Archived', 'Not archived'], ['In this note', 'Cited once']]);
    expect(actions()).toEqual(['Bookmark it', 'Open page', 'Copy reference', 'Edit link']);

    handlers.lookup.mockImplementation(async (url) => ({
      url, title: '', found: [], reference: 'r',
      known: { id: 'b2', type: 'bookmark', label: 'aljazeera.com/news/2026/9/10/houthis-seize-mocha', noun: 'Web page', address: url, seen: '2026-11-19', arrival: 'collected' },
    }));
    action('bookmark').click();
    await settle();
    expect(handlers.bookmark).toHaveBeenCalledWith(PAGE, 'aljazeera.com/news/2026/9/10/houthis-seize-mocha');
    expect(card().classList.contains('cm-cite-item')).toBe(true);
    expect(rows()).toContainEqual(['Seen', '19 November 2026']);
    expect(card().querySelector('.cm-cite-status').textContent).toBe('Bookmarked');
    expect(view.state.doc.toString()).toBe(text);
  });

  it('opens the Link field from Edit link, on the drawn page only', async () => {
    const text = `Read [the BBC](${BBC}) on it.`;
    editor(text, { at: text.length });
    caretIn('the BBC');
    await settle(CARET_MS + 10);
    expect(actions()).toEqual(['Open', 'Open page', 'Archived copy', 'Copy reference', 'Edit link']);
    action('edit').click();
    await settle();
    expect(card()).toBeNull();
    expect(view.dom.querySelector('.cm-link-field .cm-link-input').value).toBe(BBC);
  });
});

describe('the keyboard', () => {
  it('shows the card the cursor rests in, said to a screen reader; Tab walks into it, Escape gives the keys back', async () => {
    const text = `Read [the BBC](${BBC}) on it.`;
    editor(text, { at: text.length });
    caretIn('the BBC');
    await settle(CARET_MS - 50);
    expect(card()).toBeNull();
    await settle(60);
    expect(shownCard(view.state).by).toBe('caret');
    expect(view.dom.querySelector('.cm-announced')?.textContent).toMatch(/^Yemen: government forces pull back\. Web page · bbc\.com\. Tab for what to do with it/);

    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(action('open'));
    // the arrows walk the actions, one Tab stop
    action('open').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(action('page'));
    expect(action('page').tabIndex).toBe(0);
    expect(action('open').tabIndex).toBe(-1);
    action('page').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card()).toBeNull();
    expect(view.focus).toHaveBeenCalled();
  });

  it('closes on Escape in the note, on typing, and once the cursor leaves the link', async () => {
    const text = `Read [the BBC](${BBC}) on it.`;
    editor(text, { at: text.length });
    caretIn('the BBC');
    await settle(CARET_MS + 10);
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card()).toBeNull();

    caretIn('the BBC', 3);
    await settle(CARET_MS + 10);
    view.dispatch({ changes: { from: view.state.selection.main.head, insert: 'x' }, selection: EditorSelection.cursor(view.state.selection.main.head + 1), userEvent: 'input.type' });
    expect(card()).toBeNull();
    // typing on in it is not resting on it
    await settle(CARET_MS + 10);
    expect(card()).toBeNull();

    caretIn('the BBC', 2);
    await settle(CARET_MS + 10);
    view.dispatch({ selection: EditorSelection.cursor(text.length) });
    expect(card()).toBeNull();
  });

  it('shows a chip’s card with the cursor right next to it, the chip being one piece the cursor steps over', async () => {
    const text = 'See [[entity:p53|YEMEN Proof 53]] then.\n[[entity:q1|Quay north]] stands.';
    editor(text, { at: text.length });
    const chip = text.indexOf('[[entity:p53');
    const end = text.indexOf(']]', chip) + 2;
    // just after the chip
    view.dispatch({ effects: setFocused.of(true) });
    view.dispatch({ selection: EditorSelection.cursor(end) });
    await settle(CARET_MS + 10);
    expect(shownCard(view.state)).toMatchObject({ by: 'caret', target: { kind: 'chip', id: 'p53' } });
    expect(view.dom.querySelector('.cm-announced')?.textContent).toMatch(/^YEMEN Proof 53\..*Tab for what to do with it/);
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(document.activeElement).toBe(action('open'));
    action('open').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(card()).toBeNull();
    // the cursor steps over it to just before it: the same card, kept while it stands by the chip
    view.dispatch({ selection: EditorSelection.cursor(chip) });
    await settle(CARET_MS + 10);
    expect(shownCard(view.state).target.id).toBe('p53');
    view.dispatch({ selection: EditorSelection.cursor(end) });
    expect(shownCard(view.state).target.id).toBe('p53');
    // a word away, it goes
    view.dispatch({ selection: EditorSelection.cursor(end + 3) });
    expect(card()).toBeNull();
    // a chip at the start of a line, the cursor just before it
    view.dispatch({ selection: EditorSelection.cursor(text.indexOf('[[entity:q1')) });
    await settle(CARET_MS + 10);
    expect(shownCard(view.state).target.id).toBe('q1');
  });

  it('reads the chip just behind the cursor first, and leaves the raw Markdown’s edges to writing', () => {
    const text = 'Two [[entity:p53|YEMEN Proof 53]][[entity:q1|Quay north]] side by side.';
    const drawnState = EditorState.create({ doc: text, extensions: noteExtensions() });
    const between = text.indexOf('[[entity:q1');
    expect(caretCitation(drawnState, between)).toMatchObject({ kind: 'chip', id: 'p53' });
    expect(caretCitation(drawnState, text.indexOf(' side') + 3)).toBeNull();
    const raw = EditorState.create({ doc: text, extensions: noteExtensions({ mode: 'markdown' }) });
    expect(caretCitation(raw, between)).toBeNull();
    expect(caretCitation(raw, between + 4)).toMatchObject({ kind: 'chip', id: 'q1' });
  });

  it('works the same in the raw Markdown, Edit link aside', async () => {
    const text = `Read [the BBC](${BBC}) and [[entity:p53|YEMEN Proof 53]].`;
    editor(text, { mode: 'markdown', at: text.length });
    caretIn('the BBC');
    await settle(CARET_MS + 10);
    expect(actions()).toEqual(['Open', 'Open page', 'Archived copy', 'Copy reference']);
    caretIn('entity:p53');
    await settle(CARET_MS + 10);
    expect(card().querySelector('.cm-cite-title').textContent).toBe('YEMEN Proof 53');
  });
});
