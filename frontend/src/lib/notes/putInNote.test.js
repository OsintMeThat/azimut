// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * One press puts what a tool shows in the pinned note: it lands where the note was
 * being written, says where it went, and Undo takes it back with what was filed for it.
 */

const { get, put, post, del } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('../api.js', () => ({ api: { get, put, post, del, patch: vi.fn() } }));
const { reloadCase } = vi.hoisted(() => ({ reloadCase: vi.fn(async () => {}) }));
vi.mock('../state.svelte.js', async (actual) => ({ ...(await actual()), reloadCase }));

const { uiState } = await import('../state.svelte.js');
const { pinNote, pinnedNote, putInNote, shortTitle, withoutText } = await import('./putInNote.svelte.js');
const { resetOpenNotes } = await import('./noteDoc.svelte.js');

/** An editor as the panel hands it over, writing into a string. */
function fakeEditor(initial = 'Draft.') {
  const editor = {
    text: initial,
    gone: false,
    spots: new Map(),
    captioned: [],
    alive: () => !editor.gone,
    spot: () => { editor.spots.set(1, editor.text.length); return 1; },
    release: vi.fn((id) => editor.spots.delete(id)),
    place: (id, text) => {
      const at = editor.spots.get(id);
      const written = `\n\n${text}\n`;
      editor.text = `${editor.text.slice(0, at)}${written}${editor.text.slice(at)}`;
      return { id: 9, text: written, at };
    },
    caption: vi.fn(async () => true),
    takeBack: (landed) => {
      const now = editor.text.slice(landed.at, landed.at + landed.text.length);
      if (now !== landed.text) return false;
      editor.text = `${editor.text.slice(0, landed.at)}${editor.text.slice(landed.at + landed.text.length)}`;
      return true;
    },
  };
  return editor;
}

let unpin = () => {};
function pin(editor, title = 'Port strike') {
  unpin = pinNote({ caseId: 'c1', noteId: 'n1', title, editor });
}

const lastToast = () => uiState.toasts.at(-1);
const offer = (result, more = {}) => ({ id: 'view', label: 'This view', put: vi.fn(async () => result), ...more });

beforeEach(() => {
  uiState.toasts.splice(0);
  del.mockResolvedValue({ deleted: ['e1'], trash: 't1' });
  post.mockResolvedValue({ deleted: ['e1', 'e2'], trash: 't1' });
});

afterEach(() => {
  unpin();
  resetOpenNotes();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the pinned note', () => {
  it('is the one the panel shows, and none once it closes', () => {
    expect(pinnedNote()).toBeNull();
    pin(fakeEditor());
    expect(pinnedNote()).toEqual({ caseId: 'c1', noteId: 'n1', title: 'Port strike' });
    unpin();
    expect(pinnedNote()).toBeNull();
  });

  it('is named short enough for a menu row', () => {
    expect(shortTitle('Port strike')).toBe('Port strike');
    expect(shortTitle('Strike on the northern quay, second night')).toBe('Strike on the northern…');
    expect(shortTitle('')).toBe('Note');
  });

  it('puts nothing anywhere when no note is pinned', async () => {
    const one = offer({ text: 'x' });
    expect(await putInNote(one)).toBeNull();
    expect(one.put).not.toHaveBeenCalled();
  });
});

describe('a put', () => {
  it('lands in the note, names it, and opens a picture’s caption', async () => {
    const editor = fakeEditor();
    pin(editor);
    const landed = await putInNote(offer({ text: '[[media:cap1|Roof]]', filed: ['cap1'] }, { picture: true }));
    expect(landed).toEqual({ text: '[[media:cap1|Roof]]', filed: ['cap1'] });
    expect(editor.text).toBe('Draft.\n\n[[media:cap1|Roof]]\n');
    expect(editor.caption).toHaveBeenCalledOnce();
    expect(lastToast().message).toBe('Put in “Port strike”');
    expect(lastToast().action.label).toBe('Undo');
  });

  it('opens no caption for words', async () => {
    const editor = fakeEditor();
    pin(editor);
    await putInNote(offer({ text: '48.12345, 37.12345' }));
    expect(editor.caption).not.toHaveBeenCalled();
  });

  it('shows a refusal and inserts nothing', async () => {
    const editor = fakeEditor();
    pin(editor);
    const refused = await putInNote({ id: 'view', label: 'This view', put: async () => { throw new Error('No imagery here yet'); } });
    expect(refused).toBeNull();
    expect(editor.text).toBe('Draft.');
    expect(editor.release).toHaveBeenCalledWith(1);
    expect(lastToast()).toMatchObject({ message: 'No imagery here yet', kind: 'danger' });
  });

  it('says it is working when it takes a while, and Cancel stops it with nothing left behind', async () => {
    vi.useFakeTimers();
    const editor = fakeEditor();
    pin(editor);
    let seen;
    const slow = { id: 'pair', label: 'This pair', put: ({ signal }) => new Promise((resolve) => {
      seen = signal;
      signal.addEventListener('abort', () => resolve({ text: '[[media:k1|Pair]]', filed: ['k1'] }));
    }) };
    const running = putInNote(slow);
    await vi.advanceTimersByTimeAsync(450);
    const busy = lastToast();
    expect(busy.message).toBe('Putting it in “Port strike”…');
    busy.action.onClick();
    expect(seen.aborted).toBe(true);
    expect(await running).toBeNull();
    expect(editor.text).toBe('Draft.');
    expect(uiState.toasts.find((one) => one.id === busy.id)).toBeUndefined();
    // what it filed for the note it never reached goes to the Trash
    expect(del).toHaveBeenCalledWith('/api/cases/c1/entities/k1');
  });

  it('says nothing busy for a quick one', async () => {
    vi.useFakeTimers();
    pin(fakeEditor());
    await putInNote(offer({ text: 'x' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(uiState.toasts.some((one) => one.message.startsWith('Putting it'))).toBe(false);
  });
});

describe('Undo', () => {
  it('takes the text back and sends what was filed for it to the Trash, as one group', async () => {
    const editor = fakeEditor();
    pin(editor);
    await putInNote(offer({ text: '[[media:cap1|Roof]]', filed: ['cap1', 'side1'] }));
    await lastToast().action.onClick();
    expect(editor.text).toBe('Draft.');
    expect(post).toHaveBeenCalledWith('/api/cases/c1/entities/delete', { ids: ['cap1', 'side1'] });
    expect(reloadCase).toHaveBeenCalled();
    expect(lastToast().message).toBe('Taken back. What was filed for it is in the Trash');
  });

  it('trashes nothing that was reused rather than filed', async () => {
    const editor = fakeEditor();
    pin(editor);
    await putInNote(offer({ text: '[[media:cap1|Roof]]' }));
    await lastToast().action.onClick();
    expect(editor.text).toBe('Draft.');
    expect(post).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(lastToast().message).toBe('Taken back');
  });

  it('leaves a put the analyst has changed since, file and all', async () => {
    const editor = fakeEditor();
    pin(editor);
    await putInNote(offer({ text: 'Tool words', filed: ['cap1'] }));
    editor.text = editor.text.replace('Tool words', 'Analyst words');
    await lastToast().action.onClick();
    expect(editor.text).toContain('Analyst words');
    expect(del).not.toHaveBeenCalled();
    expect(lastToast().kind).toBe('warn');
  });
});

describe('a panel that went away meanwhile', () => {
  it('still gets it, at the end of the note it was asked for', async () => {
    const editor = fakeEditor();
    pin(editor);
    get.mockResolvedValue({ text: 'Saved draft.' });
    put.mockResolvedValue({ status: 'saved' });
    let finish;
    const pending = putInNote({ id: 'view', label: 'This view', put: () => new Promise((resolve) => { finish = resolve; }) });
    editor.gone = true;
    unpin();
    finish({ text: 'Late table' });
    expect(await pending).toEqual({ text: 'Late table', filed: [] });
    expect(put).toHaveBeenCalledWith('/api/cases/c1/notes/n1', { text: 'Saved draft.\n\nLate table\n' });
    // and Undo still finds it there
    get.mockResolvedValue({ text: 'Saved draft.\n\nLate table\n' });
    await lastToast().action.onClick();
    expect(put).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1', { text: 'Saved draft.' });
  });
});

describe('a note’s text without a put', () => {
  it('is taken from its one copy only', () => {
    expect(withoutText('A\n\nT\nB', '\n\nT\n')).toBe('AB');
    expect(withoutText('T T', 'T')).toBeNull();
    expect(withoutText('A', 'T')).toBeNull();
  });
});
