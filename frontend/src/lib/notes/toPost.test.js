import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * To Post from the Notebook: the route's pieces handed to Post as they came, and
 * what stayed out said once, in one sentence.
 */

const { post, toast, startPost } = vi.hoisted(() => ({ post: vi.fn(), toast: vi.fn(), startPost: vi.fn() }));
vi.mock('../api.js', () => ({ api: { post } }));
vi.mock('../state.svelte.js', () => ({ toast }));
vi.mock('../../tools/post/start.js', () => ({ startPost }));

const { leftOutSaid, noteToPost } = await import('./toPost.js');

afterEach(() => vi.clearAllMocks());

const PIECES = [
  { kind: 'text', text: 'Findings', heading: true },
  { kind: 'text', text: 'Smoke over the quay.' },
  { kind: 'media', path: 'media/Quay.png', type: 'image', id: 'm1' },
  { kind: 'proof', name: 'Strike geolocated', id: 'p1' },
  { kind: 'source', url: 'https://example.org/notice', label: 'Notice' },
];
const NONE = { internal: 0, tables: 0, diagrams: 0, other: 0 };

describe('what stayed out', () => {
  it('is one sentence, each kind once, in the order the server counts them', () => {
    expect(leftOutSaid({ internal: 2, tables: 1, diagrams: 0, other: 0 })).toBe('2 internal passages and 1 table stay out');
    expect(leftOutSaid({ internal: 1, tables: 0, diagrams: 0, other: 0 })).toBe('1 internal passage stays out');
    expect(leftOutSaid({ internal: 0, tables: 0, diagrams: 3, other: 0 })).toBe('3 diagrams stay out');
    expect(leftOutSaid({ internal: 1, tables: 2, diagrams: 1, other: 4 }))
      .toBe('1 internal passage, 2 tables, 1 diagram and 4 other parts stay out');
    expect(leftOutSaid({ other: 1, tables: 1 })).toBe('1 table and 1 other part stay out');
  });

  it('says nothing when nothing stayed out, or when the answer holds no count', () => {
    expect(leftOutSaid(NONE)).toBe('');
    expect(leftOutSaid(undefined)).toBe('');
    expect(leftOutSaid({ internal: -2, tables: 'x', diagrams: null })).toBe('');
  });
});

describe('a note sent to Post', () => {
  it('asks for the whole note, then opens Post on a Free post with the pieces as they came', async () => {
    post.mockResolvedValue({ title: 'Port strike', pieces: PIECES, left: NONE });
    expect(await noteToPost('case-a', 'n1', '# Findings\n\nSmoke over the quay.')).toBe(true);
    expect(post).toHaveBeenCalledWith('/api/cases/case-a/notes/n1/pieces',
      { text: '# Findings\n\nSmoke over the quay.', selection: null });
    expect(startPost).toHaveBeenCalledTimes(1);
    expect(startPost).toHaveBeenCalledWith('free', [], { title: 'Port strike' }, PIECES);
    // nothing stayed out: nothing is said
    expect(toast).not.toHaveBeenCalled();
  });

  it('sends the selection as the editor counts it, and the case notes by their own name', async () => {
    post.mockResolvedValue({ title: 'Case notes', pieces: PIECES.slice(1, 2), left: NONE });
    await noteToPost('case-a', 'case', 'Before. Smoke over the quay.', { from: 8, to: 28 });
    expect(post).toHaveBeenCalledWith('/api/cases/case-a/notes/case/pieces',
      { text: 'Before. Smoke over the quay.', selection: { start: 8, end: 28 } });
    // a cursor with nothing selected is the whole note
    await noteToPost('case-a', 'case', 'Words.', { from: 3, to: 3 });
    expect(post).toHaveBeenLastCalledWith('/api/cases/case-a/notes/case/pieces', { text: 'Words.', selection: null });
  });

  it('says once what stayed out, after Post is open', async () => {
    post.mockResolvedValue({ title: 'Port strike', pieces: PIECES, left: { internal: 2, tables: 1, diagrams: 0, other: 0 } });
    await noteToPost('case-a', 'n1', 'text');
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('2 internal passages and 1 table stay out', 'info', 6000);
    expect(startPost.mock.invocationCallOrder[0]).toBeLessThan(toast.mock.invocationCallOrder[0]);
  });

  it('keeps Post shut on an empty answer, and says why', async () => {
    post.mockResolvedValue({ title: 'Port strike', pieces: [], left: { internal: 1, tables: 0, diagrams: 0, other: 0 } });
    expect(await noteToPost('case-a', 'n1', '> [!internal] Secret.')).toBe(false);
    expect(startPost).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Nothing to post: 1 internal passage stays out', 'warn', 6000);

    toast.mockClear();
    post.mockResolvedValue({});
    expect(await noteToPost('case-a', 'n1', 'x')).toBe(false);
    expect(startPost).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Nothing to post', 'warn', 6000);
  });

  it('lets a refusal reach the button that asked', async () => {
    post.mockRejectedValue(new Error('the note is too large to send to Post'));
    await expect(noteToPost('case-a', 'n1', 'x')).rejects.toThrow('too large');
    expect(startPost).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
