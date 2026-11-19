import { afterEach, describe, expect, it, vi } from 'vitest';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api.js', () => ({ api: { post } }));

const {
  WARNING_KINDS, checkNotes, internalCount, isLeftOut, isNoAddress, linkHost, linksSummary, readCheck, readHtmlCheck,
  readWarning, warningKind,
} = await import('./warnings.js');

afterEach(() => vi.clearAllMocks());

describe('a warning', () => {
  it('keeps the kinds the server gives, and reads anything else as other', () => {
    expect(WARNING_KINDS).toEqual([
      'missing', 'unsourced', 'open-task', 'local-link', 'empty-section', 'setting', 'other', 'internal', 'count', 'address',
      'unarchived', 'unseen', 'stale',
    ]);
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

describe('a line that counts links', () => {
  const LINKS = [
    { text: 'Al-Khabar al-Yemeni, 16 Nov', url: 'https://alkhabaralyemeni.net/2026/11/16/a', line: 40 },
    { text: 'YemenExtra, 10 Oct', url: 'https://www.yemenextra.net/x', line: 12 },
    { text: '', url: 'https://mereja.com/b', line: -1 },
    { text: 'Liveuamap, 27 Oct', url: 'https://yemen.liveuamap.com/en/2026/27-october', line: 51 },
    { text: 'BBC, 5 Oct', url: 'https://www.bbc.com/news/articles/c1', line: 7 },
  ];

  it('keeps the links behind it, each with its words, its address and its line', () => {
    const read = readWarning({ text: '5 outside links have no archived copy.', line: 40, kind: 'unarchived', items: [...LINKS, null, { text: '' }] });
    expect(read.kind).toBe('unarchived');
    expect(read.items).toHaveLength(5);
    expect(read.items[2]).toEqual({ text: 'https://mereja.com/b', url: 'https://mereja.com/b', line: null });
    expect(readWarning({ text: 'x', kind: 'unseen', items: [] })).toEqual({ text: 'x', line: null, kind: 'unseen' });
    expect(readWarning({ text: 'x', kind: 'unseen', items: 'many' })).not.toHaveProperty('items');
  });

  it('folds them to the first three by their words and how many more', () => {
    const read = readWarning({ text: 'x', kind: 'unarchived', items: LINKS }).items;
    expect(linksSummary(read)).toBe('“Al-Khabar al-Yemeni, 16 Nov” · “YemenExtra, 10 Oct” · “https://mereja.com/b” and 2 more');
    expect(linksSummary(read.slice(0, 2))).toBe('“Al-Khabar al-Yemeni, 16 Nov” · “YemenExtra, 10 Oct”');
    expect(linksSummary(null)).toBe('');
  });

  it('names where each link goes by its site', () => {
    expect(linkHost('https://www.bbc.com/news/articles/c1')).toBe('bbc.com');
    expect(linkHost('https://yemen.liveuamap.com/en')).toBe('yemen.liveuamap.com');
    expect(linkHost('not an address')).toBe('');
  });

  it('comes through the check with the rest of its note', async () => {
    post.mockResolvedValue({ notes: [{ note: 'n1', title: 'Front', warnings: [
      { text: '5 outside links have no archived copy.', line: 40, kind: 'unarchived', items: LINKS },
      { text: '1 task is still open.', line: 3, kind: 'open-task' },
    ] }] });
    const { found } = await checkNotes('c1', ['n1']);
    expect(found[0].warnings.map((warning) => [warning.kind, warning.items?.length ?? 0])).toEqual([['unarchived', 5], ['open-task', 0]]);
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

  it('checks the HTML pages when asked, and reads their weight, links, points of view and earlier editions', async () => {
    post.mockResolvedValue({
      notes: [
        {
          note: 'n1', title: 'Port', internal: 1, weight: 4_000_000, earlier: 2,
          warnings: [{ text: 'A count with no "at least" or range: "60 vehicles".', line: 9, kind: 'count' }],
          links: [{ text: 'Strike clip, 4 min', line: 12 }, { text: '' }],
          pov: [{ text: 'Filmer, 33.51381, 36.27652', line: 20 }],
        },
        { note: 'case', title: '', weight: 1_500_000.4, earlier: 'x', links: 'none', pov: [{ text: 'Roof', line: -2 }] },
      ],
    });
    const answer = await checkNotes('c1', ['n1', 'case'], { edition: 'public', format: 'html' });
    expect(post.mock.calls[0][1]).toEqual({ notes: ['n1', 'case'], edition: 'public', format: 'html' });
    expect(answer.weight).toBe(5_500_000);
    expect(answer.earlier).toBe(2);
    expect(answer.links).toEqual([{ note: 'n1', title: 'Port', text: 'Strike clip, 4 min', line: 12 }]);
    expect(answer.pov).toEqual([
      { note: 'n1', title: 'Port', text: 'Filmer, 33.51381, 36.27652', line: 20 },
      { note: 'case', title: 'Case notes', text: 'Roof', line: null },
    ]);
    expect(answer.found[0].warnings[0].kind).toBe('count');
  });

  it('checks a web folder in the public edition whatever is asked, and tells its missing address apart', async () => {
    const NO_ADDRESS = { text: 'No address given: X shows the link without its picture card.', line: null, kind: 'address' };
    post.mockResolvedValue({ notes: [{ note: 'n1', title: 'Port', internal: 1, weight: 2_000_000, earlier: 0, warnings: [NO_ADDRESS], links: [], pov: [] }] });
    const answer = await checkNotes('c1', ['n1'], { edition: 'internal', format: 'web' });
    expect(post.mock.calls[0][1]).toEqual({ notes: ['n1'], edition: 'public', format: 'web' });
    expect(answer.weight).toBe(2_000_000);
    const [said] = answer.found[0].warnings;
    expect(said.kind).toBe('address');
    expect(isNoAddress(said)).toBe(true);
    expect(isNoAddress({ kind: 'internal' })).toBe(false);
  });

  it('leaves the PDF check as it was asked before HTML existed', async () => {
    post.mockResolvedValue({ notes: [{ note: 'n1', title: 'A', warnings: [], weight: 9 }] });
    const answer = await checkNotes('c1', ['n1'], { format: 'pdf' });
    expect(post.mock.calls[0][1]).toEqual({ notes: ['n1'], edition: 'internal' });
    expect(answer).toEqual({ found: [], internal: 0 });
    expect(readHtmlCheck(null)).toEqual({ weight: 0, links: [], pov: [], earlier: 0, live: false });
  });
});
