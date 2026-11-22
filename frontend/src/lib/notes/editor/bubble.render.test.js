// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { undo, undoDepth } from '@codemirror/commands';

import { noteExtensions, setNoteCase, setNoteMode } from '../liveMarkdown.js';
import { BUBBLE_BUTTONS, bubbleShown, openLinkField } from './bubble.js';
import { setFocused, setSelecting } from './state.js';

/**
 * The selection bubble on the drawn page: each press writes its Markdown as one Undo
 * step; the bar goes on a picked block, on typing, on Escape and while the mouse is
 * still selecting; Ctrl+K opens the Link field, which asks the case and nothing else.
 */

const ENTITIES = [
  { id: 'p1', type: 'place', label: 'Quay north', attrs: {} },
  { id: 'b1', type: 'bookmark', label: 'BBC News, 5 Oct 2026', attrs: { url: 'https://www.bbc.com/news/articles/cw8rzd6lp0xpo', fetched_at: '2026-11-17T09:00:00Z' } },
];

let view;
let handlers;

function editor(text, from, to, { mode = 'drawn', entities = ENTITIES } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc: text, extensions: noteExtensions({ handlers, mode }) }) });
  // happy-dom answers focus() with a selection of its own, which a browser does not; the editor is made focused by its state
  view.focus = vi.fn();
  view.dispatch({ effects: [setNoteCase.of({ caseId: 'c1', entities }), setFocused.of(true)] });
  view.dispatch({ selection: EditorSelection.range(from, to) });
  return view;
}

/** Select `words` (their first occurrence). */
function select(words) {
  const at = view.state.doc.toString().indexOf(words);
  view.dispatch({ selection: EditorSelection.range(at, at + words.length) });
}

const bubble = () => view.dom.querySelector('.cm-bubble');
const press = (id) => bubble().querySelector(`[data-action="${id}"]`).click();
const text = () => view.state.doc.toString();

async function settle() {
  for (let round = 0; round < 10; round += 1) await Promise.resolve();
  await new Promise((done) => setTimeout(done, 0));
}

beforeEach(() => {
  handlers = {};
});

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('the bubble', () => {
  it('stands over words selected, each button saying its key', () => {
    editor('Seen at the quay on day two.', 8, 16);
    expect(bubbleShown(view.state)).toBe(true);
    const titles = [...bubble().querySelectorAll('button')].map((button) => button.title);
    expect(titles).toEqual(['Bold (Ctrl+B)', 'Italic (Ctrl+I)', 'Link (Ctrl+K)', 'Footnote: a comment the reader opens from a small letter',
      'Heading', 'Bulleted list', 'Quote', 'Code (Ctrl+E)',
      'Internal: left out of the public edition', 'Clear bold, italic and code']);
    expect(bubble().querySelector('[role="toolbar"]').getAttribute('aria-label')).toBe('Format the words selected');
  });

  const CASES = [
    ['bold', 'Seen at the quay.', 'the quay', 'Seen at **the quay**.'],
    ['italic', 'Seen at the quay.', 'the quay', 'Seen at *the quay*.'],
    ['code', 'Seen at the quay.', 'the quay', 'Seen at `the quay`.'],
    ['heading', 'Seen at the quay.', 'the quay', '## Seen at the quay.'],
    ['bullet', 'One.\nTwo.', 'One.\nTwo', '- One.\n- Two.'],
    ['quote', 'One.\n\nTwo.', 'One.\n\nTwo', '> One.\n>\n> Two.'],
    ['internal', 'Public.\n\nWho told us.\n\nAfter.', 'told', 'Public.\n\n> [!internal] Who told us.\n\nAfter.'],
    ['clear', 'Seen at **the *quay***.', 'the *quay', 'Seen at the quay.'],
    ['clear', 'Seen at **the *quay***.', 'the', 'Seen at the *quay*.'],
    ['bold', 'Seen at **the quay**.', 'the quay', 'Seen at the quay.'],
  ];

  for (const [action, before, words, written] of CASES) {
    it(`${action} writes its Markdown, and one Undo takes it back (${JSON.stringify(before)})`, () => {
      editor(before, 0, 0);
      select(words);
      const depth = undoDepth(view.state);
      press(action);
      expect(text()).toBe(written);
      expect(undoDepth(view.state)).toBe(depth + 1);
      expect(undo(view)).toBe(true);
      expect(text()).toBe(before);
    });
  }

  it('lights what the words already are', () => {
    editor('## Seen at **the quay**.', 0, 0);
    select('the quay');
    expect(bubble().querySelector('[data-action="bold"]').getAttribute('aria-pressed')).toBe('true');
    expect(bubble().querySelector('[data-action="heading"]').getAttribute('aria-pressed')).toBe('true');
    expect(bubble().querySelector('[data-action="italic"]').getAttribute('aria-pressed')).toBe('false');
  });

  it('two presses in a row are two Undo steps, never one', () => {
    editor('Seen at the quay.', 0, 0);
    select('the quay');
    press('bold');
    press('italic');
    expect(text()).toBe('Seen at ***the quay***.');
    undo(view);
    expect(text()).toBe('Seen at **the quay**.');
  });

  it('goes when a block is picked, when typing replaces the words, and on Escape', () => {
    editor('Words here.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', 0, 5);
    expect(bubbleShown(view.state)).toBe(true);
    // the press on a table picks it: the cursor at its start
    view.dispatch({ selection: EditorSelection.cursor(13) });
    expect(bubbleShown(view.state)).toBe(false);

    select('Words');
    expect(bubbleShown(view.state)).toBe(true);
    view.dispatch(view.state.replaceSelection('W'), { userEvent: 'input.type' });
    expect(bubbleShown(view.state)).toBe(false);

    select('here');
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(bubbleShown(view.state)).toBe(false);
    // a selection made again brings it back
    select('W');
    expect(bubbleShown(view.state)).toBe(true);
  });

  it('waits for the mouse to let go of a selection being drawn', () => {
    editor('Seen at the quay.', 0, 0);
    view.dispatch({ effects: setSelecting.of({ lines: [] }) });
    select('the quay');
    expect(bubbleShown(view.state)).toBe(false);
    view.dispatch({ effects: setSelecting.of(false) });
    expect(bubbleShown(view.state)).toBe(true);
  });

  it('is not there in the Markdown mode, which is left as it was', () => {
    editor('Seen at the quay.', 8, 16, { mode: 'markdown' });
    expect(bubble()).toBeNull();
    setNoteMode(view, 'drawn');
    select('the quay');
    expect(bubble()).not.toBeNull();
  });
});

describe('the Link field', () => {
  const BBC = 'https://www.bbc.com/news/articles/cw8rzd6lp0xpo';
  const field = () => bubble().querySelector('.cm-link-field');
  const input = () => field().querySelector('input');

  async function typeAddress(value) {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    await new Promise((done) => setTimeout(done, 200));
    await settle();
  }

  it('finds a page the case holds, nothing fetched, and cites it as a chip in one Undo step', async () => {
    const fetched = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('nothing may be fetched'); });
    handlers.lookup = vi.fn(async (url) => ({ url, title: 'bbc.com/news/articles/cw8rzd6lp0xpo', found: [ENTITIES[1]] }));
    editor('Seen by the BBC, 5 Oct; then more.', 0, 0);
    select('BBC, 5 Oct');
    expect(openLinkField(view)).toBe(true);
    expect(field()).not.toBeNull();
    await typeAddress(BBC);
    expect(handlers.lookup).toHaveBeenCalledWith(BBC);
    expect(fetched).not.toHaveBeenCalled();
    expect(field().querySelector('.cm-link-head').textContent).toBe('In the case: BBC News, 5 Oct 2026');
    expect(field().querySelector('.cm-link-facts').textContent).toMatch(/^Bookmark · seen 17 Nov/);
    expect(field().querySelector('.cm-link-foot').textContent).toBe('Looked up in the case as you type. Nothing is fetched.');

    const depth = undoDepth(view.state);
    [...field().querySelectorAll('button')].find((button) => button.textContent === 'Cite it').click();
    await settle();
    expect(text()).toBe('Seen by the [[entity:b1|BBC News, 5 Oct 2026]]; then more.');
    expect(undoDepth(view.state)).toBe(depth + 1);
    undo(view);
    expect(text()).toBe('Seen by the BBC, 5 Oct; then more.');
  });

  it('reads the fuller answer: who posted it, when, its copy, how often the note cites it', async () => {
    handlers.lookup = vi.fn(async (url) => ({
      url, title: 'Post by @desk on X', found: [],
      known: { id: 'b1', type: 'bookmark', label: 'Post by @desk on X', noun: 'Bookmark', author: '@desk', published: '2026-09-14',
        archive: 'https://web.archive.org/web/2026/x', archived_at: '2026-11-18', seen: '2026-11-17' },
    }));
    editor('Said on X. Then [[entity:b1|again]].', 0, 0);
    select('Said');
    openLinkField(view);
    await typeAddress('https://x.com/desk/status/1');
    expect(field().querySelector('.cm-link-head').textContent).toBe('In the case: Post by @desk on X');
    expect(field().querySelector('.cm-link-facts').textContent)
      .toMatch(/^Bookmark · by @desk · posted 14 Sep( 2026)? · seen 17 Nov( 2026)? · archived 18 Nov( 2026)? · cited once in this note$/);
  });

  it('keeps a plain link to a page the case does not hold, or files it as a bookmark and cites it', async () => {
    handlers.lookup = vi.fn(async (url) => ({ url, title: 'example.org/report', found: [] }));
    handlers.bookmark = vi.fn(async () => ({ id: 'b9', label: 'example.org/report' }));
    editor('See the report here.', 0, 0);
    select('the report');
    openLinkField(view);
    await typeAddress('example.org/report');
    expect(handlers.lookup).toHaveBeenCalledWith('https://example.org/report');
    expect(field().querySelector('.cm-link-head').textContent).toBe('Not in the case yet');
    const buttons = [...field().querySelectorAll('button')].map((button) => button.textContent);
    expect(buttons).toEqual(['Link', 'Bookmark it']);
    field().querySelector('.cm-link-primary').click();
    await settle();
    expect(text()).toBe('See [the report](https://example.org/report) here.');

    undo(view);
    select('the report');
    openLinkField(view);
    await typeAddress('https://example.org/report');
    [...field().querySelectorAll('button')].find((button) => button.textContent === 'Bookmark it').click();
    await settle();
    expect(handlers.bookmark).toHaveBeenCalledWith('https://example.org/report', 'example.org/report');
    expect(text()).toBe('See [[entity:b9|example.org/report]] here.');
  });

  it('asks who posted a post and when, for an address that names neither, and files them with the bookmark', async () => {
    const post = 'https://www.instagram.com/p/DIC1c6ysX7w/';
    handlers.lookup = vi.fn(async (url) => ({ url, title: 'Instagram post DIC1c6ysX7w', found: [] }));
    handlers.bookmark = vi.fn(async () => ({ id: 'b7', label: 'Instagram post DIC1c6ysX7w' }));
    editor('See the ceremony photo.', 0, 0);
    select('the ceremony photo');
    openLinkField(view);
    await typeAddress(post);
    field().querySelector('.cm-link-author').value = '@gaivire_8';
    field().querySelector('.cm-link-day').value = '2026-01-04';
    [...field().querySelectorAll('button')].find((button) => button.textContent === 'Bookmark it').click();
    await settle();
    expect(handlers.bookmark).toHaveBeenCalledWith(post, 'Instagram post DIC1c6ysX7w', { author: '@gaivire_8', published: '2026-01-04' });
    expect(text()).toBe('See [[entity:b7|Instagram post DIC1c6ysX7w]].');
  });

  it('asks nothing more of a page, whose own copy says its day', async () => {
    handlers.lookup = vi.fn(async (url) => ({ url, title: 'example.org/report', found: [] }));
    handlers.bookmark = vi.fn(async () => ({ id: 'b9', label: 'example.org/report' }));
    editor('See the report here.', 0, 0);
    select('the report');
    openLinkField(view);
    await typeAddress('https://example.org/report');
    expect(field().querySelector('.cm-link-who')).toBeNull();
  });

  it('writes who posted a bookmarked post and when on its bookmark, from the field', async () => {
    const post = 'https://www.instagram.com/p/DIC1c6ysX7w/';
    const known = { id: 'b7', type: 'bookmark', label: 'Instagram post', noun: 'Bookmark', address: post, author: '', published: '' };
    handlers.lookup = vi.fn(async (url) => ({ url, title: 'Instagram post', known }));
    handlers.describe = vi.fn(async () => ({ id: 'b7' }));
    editor('See the ceremony photo.', 0, 0);
    select('the ceremony photo');
    openLinkField(view);
    await typeAddress(post);
    expect(field().querySelector('.cm-link-head').textContent).toBe('In the case: Instagram post');
    field().querySelector('.cm-link-author').value = '@gaivire_8';
    field().querySelector('.cm-link-day').value = '2026-01-04';
    known.author = '@gaivire_8';
    known.published = '2026-01-04';
    [...field().querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
    await settle();
    expect(handlers.describe).toHaveBeenCalledWith('b7', { author: '@gaivire_8', published: '2026-01-04' });
    // read again: said in the facts, the fields gone
    expect(field().querySelector('.cm-link-facts').textContent).toMatch(/by @gaivire_8 · posted 4 Jan/);
    expect(field().querySelector('.cm-link-who')).toBeNull();
  });

  it('answers from the case\'s own records when no server is asked', async () => {
    editor('Seen by the BBC.', 0, 0);
    select('the BBC');
    openLinkField(view);
    await typeAddress('https://bbc.com/news/articles/cw8rzd6lp0xpo/');
    expect(field().querySelector('.cm-link-head').textContent).toBe('In the case: BBC News, 5 Oct 2026');
  });

  it('finds case items by name, so a citation needs no syntax', async () => {
    editor('We stood at the quay.', 0, 0);
    select('the quay');
    openLinkField(view);
    await typeAddress('quay');
    const items = [...field().querySelectorAll('.cm-link-item')];
    expect(items.map((item) => item.querySelector('.cm-link-item-name').textContent)).toEqual(['Quay north']);
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(text()).toBe('We stood at [[entity:p1|Quay north]].');
  });

  it('edits a written link where the cursor stands, and takes it off', async () => {
    handlers.lookup = vi.fn(async (url) => ({ url, title: '', found: [] }));
    editor('Seen by [the BBC](https://bbc.com) today.', 12, 12);
    expect(openLinkField(view)).toBe(true);
    expect(input().value).toBe('https://bbc.com');
    field().querySelector('.cm-link-remove').click();
    await settle();
    expect(text()).toBe('Seen by the BBC today.');
  });

  it('closes on Escape, the words still selected; and leaves Ctrl+K to Go to on an empty line', async () => {
    editor('Seen at the quay.\n\n', 0, 0);
    select('quay');
    openLinkField(view);
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(field()).toBeNull();
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('quay');
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length) });
    expect(openLinkField(view)).toBe(false);
  });

  describe('Link to a map', () => {
    const MAP = { style: 'article', web: 'map' };
    const WITH_MAPS = [
      ...ENTITIES,
      { id: 'm2', type: 'note', label: 'Strikes', attrs: { look: MAP } },
      { id: 'm1', type: 'note', label: 'Road map', attrs: { look: MAP } },
      { id: 'n1', type: 'note', label: 'Road notes', attrs: {} },
    ];
    const names = () => [...field().querySelectorAll('.cm-link-item')].map((item) => item.querySelector('.cm-link-item-name').textContent);

    it('lists the case\'s web maps before anything is typed, and links the words to one in one Undo step', async () => {
      editor('See the road for where they went.', 0, 0, { entities: WITH_MAPS });
      select('the road');
      openLinkField(view);
      await settle();
      expect(field().querySelector('.cm-link-caption').textContent).toBe('Link to a map');
      expect(names()).toEqual(['Road map', 'Strikes']);
      const [road] = field().querySelectorAll('.cm-link-item');
      expect(road.querySelector('.cm-link-item-kind').textContent).toBe('map');
      expect(road.title).toBe('Link these words to the map');
      const depth = undoDepth(view.state);
      road.click();
      await settle();
      // the words stay the link's, which a site's page opens as the map's own
      expect(text()).toBe('See [[entity:m1|the road]] for where they went.');
      expect(undoDepth(view.state)).toBe(depth + 1);
      view.dispatch({ selection: EditorSelection.cursor(text().length) });
      const chip = view.dom.querySelector('.cm-chip-map');
      expect(chip.textContent).toBe('the road');
      expect(chip.title).toBe('Link to the map Road map. Click to open');
      expect(chip.querySelector('.cm-chip-mark svg')).not.toBeNull();
    });

    it('finds a map by name too and links it, the words kept, where any other note is cited', async () => {
      editor('See the road for where they went.', 0, 0, { entities: WITH_MAPS });
      select('the road');
      openLinkField(view);
      await typeAddress('road');
      expect(names()).toEqual(['Road map', 'Road notes']);
      const kinds = [...field().querySelectorAll('.cm-link-item-kind')].map((kind) => kind.textContent);
      expect(kinds).toEqual(['map', 'note']);
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
      expect(text()).toBe('See [[entity:m1|the road]] for where they went.');
      select('they');
      openLinkField(view);
      await typeAddress('road notes');
      field().querySelector('.cm-link-item').click();
      await settle();
      expect(text()).toBe('See [[entity:m1|the road]] for where [[entity:n1|Road notes]] went.');
      // a mention of a note that is no map stays a chip named as its note
      view.dispatch({ selection: EditorSelection.cursor(0) });
      expect([...view.dom.querySelectorAll('.cm-chip')].map((chip) => chip.classList.contains('cm-chip-map'))).toEqual([true, false]);
    });

    it('offers no map in a case that has none', async () => {
      editor('See the road.', 0, 0);
      select('the road');
      openLinkField(view);
      await settle();
      expect(field().querySelector('.cm-link-caption')).toBeNull();
      expect(field().querySelectorAll('.cm-link-item')).toHaveLength(0);
    });
  });

  it('holds Bold, Italic, Link, Footnote, Heading, a list, Quote, Code, Internal and Clear, in that order', () => {
    expect(BUBBLE_BUTTONS.filter(Boolean).map((item) => item.id)).toEqual(
      ['bold', 'italic', 'link', 'footnote', 'heading', 'bullet', 'quote', 'code', 'internal', 'clear']);
  });
});
