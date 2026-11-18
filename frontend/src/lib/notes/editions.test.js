import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../api.js', () => ({ api: { get, post } }));

const {
  CHECK_SAID, checkEdition, editionDay, editionOf, editionOfAll, keepEdition, listEditions, readEdition, reloadEditions, showEdition,
} = await import('./editions.svelte.js');
const { readListed } = await import('./editions.svelte.js');

/** A storage that keeps what it is given, like a browser's. */
function memory() {
  const kept = new Map();
  return { getItem: (key) => kept.get(key) ?? null, setItem: (key, value) => kept.set(key, String(value)), kept };
}

const RECORD = {
  at: '2026-03-12T09:30:00Z', edition: 'public', file: 'Lead - public - 2026-03-12.pdf', folder: 'exports', pages: 3,
  pdf_sha256: 'a'.repeat(64), text_sha256: 'b'.repeat(64),
};

beforeEach(() => reloadEditions(memory()));
afterEach(() => vi.clearAllMocks());

describe('the edition a note prints in', () => {
  it('is Internal the first time, and what was kept after, note by note and case by case', () => {
    const storage = memory();
    expect(editionOf('c1', 'n1')).toBe('internal');
    keepEdition('c1', ['n1'], 'public', storage);
    expect(editionOf('c1', 'n1')).toBe('public');
    expect(editionOf('c1', 'n2')).toBe('internal');
    expect(editionOf('c2', 'n1')).toBe('internal');
    // the case notes, named either way
    keepEdition('c1', ['case'], 'public', storage);
    expect(editionOf('c1', null)).toBe('public');
    // kept for the browser: read back from what it stored
    reloadEditions(storage);
    expect(editionOf('c1', 'n1')).toBe('public');
    keepEdition('c1', ['n1'], 'internal', storage);
    reloadEditions(storage);
    expect(editionOf('c1', 'n1')).toBe('internal');
    expect(JSON.parse(storage.kept.get('azimut:note-editions'))).toEqual({ 'c1/case': 'public' });
  });

  it('for several notes, is Public only when every one of them is', () => {
    keepEdition('c1', ['n1', 'n2'], 'public', memory());
    expect(editionOfAll('c1', ['n1', 'n2'])).toBe('public');
    expect(editionOfAll('c1', ['n1', 'n3'])).toBe('internal');
    expect(editionOfAll('c1', [])).toBe('internal');
  });

  it('reads a storage it cannot parse as nothing kept', () => {
    reloadEditions({ getItem: () => '[1, 2]' });
    expect(editionOf('c1', 'n1')).toBe('internal');
    reloadEditions({ getItem: () => 'not json' });
    expect(editionOf('c1', 'n1')).toBe('internal');
  });
});

describe('the record of editions', () => {
  it('lists a note\'s editions, and drops one that is not what an export writes', async () => {
    get.mockResolvedValue({ editions: [RECORD, { ...RECORD, edition: 'draft' }, { ...RECORD, pages: 'x' }, null] });
    expect(await listEditions('c1', 'n1')).toEqual([{ ...RECORD, format: 'pdf' }]);
    expect(get).toHaveBeenCalledWith('/api/cases/c1/notes/n1/editions');
    expect(readEdition({ ...RECORD, pdf_sha256: 'short' }).pdf_sha256).toBe('');
  });

  it('lists an HTML page beside the PDFs, with no pages to count and its fingerprint under either name', () => {
    const page = { at: RECORD.at, edition: 'public', format: 'html', file: 'Lead - public - 2026-03-12.html', folder: 'exports', sha256: 'c'.repeat(64), text_sha256: 'b'.repeat(64) };
    expect(readEdition(page)).toEqual({ ...page, sha256: undefined, pages: 0, pdf_sha256: 'c'.repeat(64) });
    expect(readEdition({ ...page, sha256: undefined, pdf_sha256: 'd'.repeat(64) }).pdf_sha256).toBe('d'.repeat(64));
    expect(readEdition({ ...page, format: 'docx' })).toBeNull();
    expect(readEdition({ ...page, file: '' })).toBeNull();
  });

  it('lists a WordPress draft by its site and edit link, each a web address', async () => {
    const draft = { at: RECORD.at, edition: 'public', format: 'wordpress', site: 'https://desk.example.org', post: 21,
      edit: 'https://desk.example.org/wp-admin/post.php?post=21&action=edit', preview: 'https://desk.example.org/?p=21&preview=true',
      text_sha256: 'b'.repeat(64), media: { '0123456789abcdef': 4 } };
    expect(readListed(draft)).toEqual({
      at: RECORD.at, edition: 'public', format: 'wordpress', file: '', folder: '', pages: 0, pdf_sha256: '',
      text_sha256: 'b'.repeat(64), site: draft.site, post: 21, edit: draft.edit, preview: draft.preview,
    });
    expect(readListed({ ...draft, edit: 'javascript:alert(1)' })).toBeNull();
    expect(readListed({ ...draft, post: '21' })).toBeNull();
    expect(readListed({ ...draft, edition: 'internal' })).toBeNull();
    expect(readListed({ ...draft, preview: 'javascript:x' }).preview).toBe('');
    expect(readListed(RECORD)).toEqual(readEdition(RECORD));
    get.mockResolvedValue({ editions: [draft, RECORD, { ...draft, site: 'ftp://x' }] });
    expect((await listEditions('c1', 'n1')).map((edition) => edition.format)).toEqual(['wordpress', 'pdf']);
  });

  it('checks or shows one by when it was written and its file', async () => {
    post.mockResolvedValue({ state: 'changed' });
    expect(await checkEdition('c1', null, RECORD)).toBe('changed');
    expect(post).toHaveBeenCalledWith('/api/cases/c1/notes/case/editions/check', { at: RECORD.at, file: RECORD.file, folder: 'exports' });
    post.mockResolvedValue({ state: 'odd' });
    expect(await checkEdition('c1', 'n1', RECORD)).toBe('missing');
    await showEdition('c1', 'n1', RECORD);
    expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/editions/reveal', { at: RECORD.at, file: RECORD.file, folder: 'exports' });
    expect(Object.values(CHECK_SAID)).toEqual(['Unchanged since it was written', 'This file is not the one Azimut wrote', 'File missing']);
  });

  it('says the day an edition was written, and nothing for a date it cannot read', () => {
    expect(editionDay('2026-03-12T09:30:00Z')).toMatch(/^1[23] Mar 2026, \d\d:\d\d$/);
    expect(editionDay('yesterday')).toBe('');
  });
});
