import { afterEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api.js', () => ({ api: { post } }));

const { WARNING_KINDS, checkNotes, internalCount, isLeftOut, readCheck, readWarning, warningKind } = await import('./warnings.js');

afterEach(() => vi.clearAllMocks());

describe('a warning', () => {
  it('keeps the kinds the server gives, and reads anything else as other', () => {
    expect(WARNING_KINDS).toEqual(['missing', 'unsourced', 'open-task', 'local-link', 'empty-section', 'setting', 'other', 'internal']);
    for (const kind of WARNING_KINDS) expect(warningKind(kind)).toBe(kind);
    expect(warningKind('shiny')).toBe('other');
    expect(warningKind(undefined)).toBe('other');
  });

  it('keeps a line only when it is a line of the note', () => {
    expect(readWarning({ text: 'A', line: 14, kind: 'unsourced' })).toEqual({ text: 'A', line: 14, kind: 'unsourced' });
    expect(readWarning({ text: 'A', line: -1 }).line).toBeNull();
    expect(readWarning({ text: 'A', line: '3' }).line).toBeNull();
    expect(readWarning({ text: 'A', line: 2.5 }).line).toBeNull();
  });
});

describe('the check before export', () => {
  it('asks for the notes picked, in their order, and keeps those with something to say', async () => {
    post.mockResolvedValue({
      notes: [
        { note: 'n1', title: 'Rooftop', warnings: [{ text: 'Picture "Roof" has no source.', line: 14, kind: 'unsourced' }] },
        { note: 'n2', title: 'Shadows', warnings: [] },
        { note: 'case', title: '', warnings: [{ text: '3 tasks are still open.', line: 2, kind: 'open-task' }] },
      ],
    });
    const { found, internal } = await checkNotes('c1', ['n1', 'n2', 'case']);
    expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/pdf/check', { notes: ['n1', 'n2', 'case'], edition: 'internal' }, { signal: undefined });
    expect(internal).toBe(0);
    expect(found).toEqual([
      { note: 'n1', title: 'Rooftop', warnings: [{ text: 'Picture "Roof" has no source.', line: 14, kind: 'unsourced' }] },
      { note: 'case', title: 'Case notes', warnings: [{ text: '3 tasks are still open.', line: 2, kind: 'open-task' }] },
    ]);
  });

  it('asks for the edition picked, and counts the internal passages of every note', async () => {
    post.mockResolvedValue({
      notes: [
        { note: 'n1', title: 'Lead', internal: 2, warnings: [{ text: '2 internal passages left out.', line: null, kind: 'internal' }] },
        { note: 'n2', title: 'Plain', internal: 0, warnings: [] },
        { note: 'n3', title: 'Odd', internal: 'many', warnings: [] },
      ],
    });
    const { found, internal } = await checkNotes('c1', ['n1', 'n2', 'n3'], { edition: 'public' });
    expect(post.mock.calls[0][1]).toEqual({ notes: ['n1', 'n2', 'n3'], edition: 'public' });
    expect(internal).toBe(2);
    expect(found[0].warnings[0]).toEqual({ text: '2 internal passages left out.', line: null, kind: 'internal' });
    expect(isLeftOut(found[0].warnings[0])).toBe(true);
    expect(isLeftOut({ kind: 'missing' })).toBe(false);
    expect(internalCount(null)).toBe(0);
  });

  it('reads an answer it does not understand as nothing found', () => {
    expect(readCheck(null)).toEqual([]);
    expect(readCheck({ redirects: {} })).toEqual([]);
    expect(readCheck({ notes: [null, { title: 'No id', warnings: [{ text: 'x' }] }, { note: 'n1', warnings: 'x' }] })).toEqual([]);
    expect(readCheck({ notes: [{ note: 'n1', title: 'Lead', warnings: [{ text: '' }, { line: 3 }] }] })).toEqual([]);
  });
});
