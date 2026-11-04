import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const put = vi.fn();
vi.mock('../api.js', () => ({ api: { get: (...a) => get(...a), put: (...a) => put(...a) } }));

const {
  SAVE_DELAY, adoptSaved, appendToNote, differing, editNote, flush, noteReady, openCopy, openNote, releaseNote,
  resetOpenNotes, takeBack,
} = await import('./noteDoc.svelte.js');

/** A channel carrying each message to every other channel of the same name, as browser tabs do. */
function fakeChannels() {
  const open = new Set();
  return class {
    constructor(name) { this.name = name; this.onmessage = null; open.add(this); }
    postMessage(data) { for (const other of open) if (other !== this && other.name === this.name) other.onmessage?.({ data }); }
    close() { open.delete(this); }
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
  put.mockReset();
  get.mockResolvedValue({ text: '# Old note\n\nWritten long ago.\n' });
  put.mockResolvedValue({ status: 'saved' });
});
afterEach(() => {
  resetOpenNotes();
  vi.useRealTimers();
});

describe('a note open in this tab', () => {
  it('is read from its route and never written for being opened', async () => {
    const doc = openNote('c1', null);
    await noteReady(doc);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY * 3);
    expect(get).toHaveBeenCalledWith('/api/cases/c1/notes');
    expect(doc.text).toBe('# Old note\n\nWritten long ago.\n');
    expect(doc.saved).toBe(true);
    expect(put).not.toHaveBeenCalled();
    await releaseNote(doc);
    expect(put).not.toHaveBeenCalled();
  });

  it('is one copy, however many show it, and goes once the last lets it go', async () => {
    const first = openNote('c1', 'n1');
    const second = openNote('c1', 'n1');
    expect(second).toBe(first);
    await releaseNote(first);
    expect(openCopy('c1', 'n1')).toBe(first);
    await releaseNote(second);
    expect(openCopy('c1', 'n1')).toBeNull();
  });

  it('writes what is typed after a pause, and at once when flushed', async () => {
    const doc = openNote('c1', 'n1');
    await noteReady(doc);
    editNote(doc, 'one');
    editNote(doc, 'one two');
    expect(doc.saved).toBe(false);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY + 10);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith('/api/cases/c1/notes/n1', { text: 'one two' });
    expect(doc.saved).toBe(true);

    editNote(doc, 'one two three');
    await flush(doc);
    expect(put).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1', { text: 'one two three' });
  });

  it('says a write failed and keeps the text', async () => {
    put.mockRejectedValueOnce(new Error('disk full'));
    const doc = openNote('c1', 'n1');
    await noteReady(doc);
    editNote(doc, 'kept');
    await flush(doc);
    expect(doc.saveError).toBe('disk full');
    expect(doc.saved).toBe(false);
    expect(doc.text).toBe('kept');
  });

  it('shows text the server wrote without writing it again', async () => {
    const doc = openNote('c1', 'n1');
    await noteReady(doc);
    const revision = doc.revision;
    adoptSaved(doc, '- [x] ticked');
    expect(doc.text).toBe('- [x] ticked');
    expect(doc.revision).toBe(revision + 1);
    await vi.advanceTimersByTimeAsync(SAVE_DELAY * 2);
    expect(put).not.toHaveBeenCalled();
  });

  it('adds a block at the end of a note nobody has open', async () => {
    get.mockResolvedValue({ text: 'First line' });
    await appendToNote('c1', 'n1', '[[entity:p1|Quay]]');
    expect(put).toHaveBeenCalledWith('/api/cases/c1/notes/n1', { text: 'First line\n\n[[entity:p1|Quay]]\n' });
    expect(openCopy('c1', 'n1')).toBeNull();
  });
});

describe('one note, one tab', () => {
  it('lets the note go read-only when another tab opens it, and takes it back', async () => {
    const Channel = fakeChannels();
    const here = openNote('c1', 'n1', { Channel });
    await noteReady(here);
    editNote(here, 'typed here');
    // another tab: the same note, opened through its own copy of this module
    const { docTabs } = await import('../oneTab.js');
    const other = docTabs('azimut:note-open', { Channel });
    other.hold('c1', 'n1');
    await vi.advanceTimersByTimeAsync(0);
    expect(put).toHaveBeenCalledWith('/api/cases/c1/notes/n1', { text: 'typed here' });
    expect(here.elsewhere).toBe(true);
    editNote(here, 'not taken');
    expect(here.text).toBe('typed here');

    get.mockResolvedValue({ text: 'written there' });
    await takeBack(here);
    expect(here.elsewhere).toBe(false);
    expect(here.text).toBe('written there');
    other.close();
  });
});

describe('two editors on one note', () => {
  it('replace only the stretch that differs', () => {
    expect(differing('same', 'same')).toBeNull();
    expect(differing('The mast is red.', 'The mast is dark red.')).toEqual({ from: 12, to: 12, insert: 'dark ' });
    expect(differing('abc', '')).toEqual({ from: 0, to: 3, insert: '' });
    expect(differing('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' });
  });
});
